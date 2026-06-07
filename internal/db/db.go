package db

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"willing/internal/models"
)

// Note: models import is only used for SystemConfig in Migrate.

type Store struct {
	db     *gorm.DB
	driver string
}

type OpenConfig struct {
	Driver string
	DSN    string
}

func Open(ctx context.Context, cfg OpenConfig) (*Store, error) {
	driver := strings.ToLower(strings.TrimSpace(cfg.Driver))
	if driver == "" {
		driver = "sqlite"
	}

	dsn := strings.TrimSpace(cfg.DSN)
	if dsn == "" {
		if driver == "sqlite" {
			dsn = "var/db/app.sqlite"
		} else {
			return nil, errors.New("dsn is required")
		}
	}

	if driver == "sqlite" {
		if err := ensureSQLiteDir(dsn); err != nil {
			return nil, err
		}
	}

	var dialector gorm.Dialector
	switch driver {
	case "sqlite":
		dialector = sqlite.Open(dsn)
	case "postgres", "pgx":
		dialector = postgres.Open(dsn)
	default:
		return nil, errors.New("unsupported db driver")
	}

	gdb, err := gorm.Open(dialector, &gorm.Config{})
	if err != nil {
		return nil, err
	}

	s := &Store{db: gdb, driver: driver}
	if err := s.Migrate(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.PingContext(ctx)
}

func (s *Store) Migrate(ctx context.Context) error {
	if err := s.db.WithContext(ctx).AutoMigrate(&models.SystemConfig{}, &models.GenerationHistory{}, &models.CanvasSnapshot{}); err != nil {
		return err
	}

	_, err := s.GetSystemConfig(ctx)
	return err
}

func (s *Store) GetSystemConfig(ctx context.Context) (models.SystemConfig, error) {
	var cfg models.SystemConfig
	err := s.db.WithContext(ctx).First(&cfg, 1).Error
	if err == nil {
		return cfg, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.SystemConfig{}, err
	}

	cfg = models.DefaultSystemConfig()
	if err := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoNothing: true,
	}).Create(&cfg).Error; err != nil {
		return models.SystemConfig{}, err
	}

	if err := s.db.WithContext(ctx).First(&cfg, 1).Error; err != nil {
		return models.SystemConfig{}, err
	}
	return cfg, nil
}

type SystemConfigUpdate struct {
	WarnText *string
}

func (s *Store) UpdateSystemConfig(ctx context.Context, u SystemConfigUpdate) (models.SystemConfig, error) {
	cfg, err := s.GetSystemConfig(ctx)
	if err != nil {
		return models.SystemConfig{}, err
	}

	if u.WarnText != nil {
		cfg.WarnText = strings.TrimSpace(*u.WarnText)
	}

	cfg.UpdatedAtUTC = time.Now().UTC()
	if err := s.db.WithContext(ctx).Save(&cfg).Error; err != nil {
		return models.SystemConfig{}, err
	}
	return cfg, nil
}

type SaveHistoryParams struct {
	TaskID     string
	GenType    string
	Status     string
	Prompt     string
	ResultURLs []string
	InputURLs  []string
	ErrorMsg   string
}

func (s *Store) SaveHistory(ctx context.Context, params SaveHistoryParams) (models.GenerationHistory, error) {
	urlsJSON, err := json.Marshal(params.ResultURLs)
	if err != nil {
		return models.GenerationHistory{}, err
	}
	inputJSON, err := json.Marshal(params.InputURLs)
	if err != nil {
		return models.GenerationHistory{}, err
	}

	record := models.GenerationHistory{
		TaskID:       params.TaskID,
		GenType:      params.GenType,
		Status:       params.Status,
		Prompt:       params.Prompt,
		ResultURLs:   string(urlsJSON),
		InputURLs:    string(inputJSON),
		ErrorMsg:     params.ErrorMsg,
		CreatedAtUTC: time.Now().UTC(),
	}

	if err := s.db.WithContext(ctx).Create(&record).Error; err != nil {
		return models.GenerationHistory{}, err
	}
	return record, nil
}

func (s *Store) ListHistory(ctx context.Context, limit, offset int) ([]models.GenerationHistory, int64, error) {
	var items []models.GenerationHistory
	var total int64

	if err := s.db.WithContext(ctx).Model(&models.GenerationHistory{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := s.db.WithContext(ctx).
		Order("created_at_utc DESC").
		Limit(limit).
		Offset(offset).
		Find(&items).Error; err != nil {
		return nil, 0, err
	}

	return items, total, nil
}

func (s *Store) GetHistory(ctx context.Context, id int64) (models.GenerationHistory, error) {
	var record models.GenerationHistory
	if err := s.db.WithContext(ctx).First(&record, id).Error; err != nil {
		return models.GenerationHistory{}, err
	}
	return record, nil
}

func (s *Store) DeleteHistory(ctx context.Context, id int64) error {
	return s.db.WithContext(ctx).Delete(&models.GenerationHistory{}, id).Error
}

func ensureSQLiteDir(dsn string) error {
	path := strings.TrimSpace(dsn)
	if strings.HasPrefix(path, "file:") {
		path = strings.TrimPrefix(path, "file:")
	}
	if i := strings.IndexByte(path, '?'); i >= 0 {
		path = path[:i]
	}
	path = strings.TrimSpace(path)
	if path == "" || path == ":memory:" {
		return nil
	}

	dir := filepath.Dir(path)
	if dir == "." || dir == "/" {
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return nil
}

// SaveCanvasSnapshot upserts the canvas state and chat log for a session.
func (s *Store) SaveCanvasSnapshot(ctx context.Context, sessionID, canvasJSON, chatJSON string) error {
	snap := models.CanvasSnapshot{
		SessionID: sessionID,
		Canvas:    canvasJSON,
		ChatLog:   chatJSON,
		UpdatedAt: time.Now(),
	}
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "session_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"canvas", "chat_log", "updated_at"}),
	}).Create(&snap).Error
}

// GetCanvasSnapshot returns the saved canvas state and chat log for a session.
func (s *Store) GetCanvasSnapshot(ctx context.Context, sessionID string) (*models.CanvasSnapshot, error) {
	var snap models.CanvasSnapshot
	err := s.db.WithContext(ctx).Where("session_id = ?", sessionID).First(&snap).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &snap, nil
}
