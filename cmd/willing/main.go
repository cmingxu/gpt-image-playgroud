package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"willing/internal/admin"
	"willing/internal/agent"
	"willing/internal/config"
	"willing/internal/db"
)

func main() {
	cfg := config.LoadFromEnv()

	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	adminAddr := fs.String("admin-addr", cfg.AdminAddr, "admin listen address")
	dbDriver := fs.String("db-driver", cfg.DBDriver, "db driver (sqlite or pgx)")
	dbDSN := fs.String("db-dsn", cfg.DBDSN, "db dsn/connection string")
	fs.Parse(os.Args[1:])

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var store *db.Store
	if strings.TrimSpace(*dbDriver) != "" && strings.ToLower(strings.TrimSpace(*dbDriver)) != "none" {
		s, err := db.Open(ctx, db.OpenConfig{Driver: *dbDriver, DSN: *dbDSN})
		if err != nil {
			log.Fatalf("db open: %v", err)
		}
		store = s
		defer store.Close()
	}

	var agentSvc *agent.Service
	if cfg.SiliconFlowAPIKey != "" {
		svc, err := agent.New(ctx, agent.Config{
			SiliconFlowAPIKey:  cfg.SiliconFlowAPIKey,
			SiliconFlowBaseURL: cfg.SiliconFlowBaseURL,
			SiliconFlowModel:   cfg.SiliconFlowModel,
			ImageAPIEndpoint:   cfg.ImageAPIEndpoint,
			ImageAPIKey:        cfg.ImageAPIKey,
		})
		if err != nil {
			log.Printf("agent init warning: %v", err)
		} else {
			agentSvc = svc
			log.Println("agent service initialized")
		}
	} else {
		log.Println("agent not configured (SILICONFLOW_API_KEY not set)")
	}

	adminHandler := admin.New(admin.Config{
		DB:               store,
		Agent:            agentSvc,
		ImageAPIEndpoint: cfg.ImageAPIEndpoint,
		ImageAPIKey:      cfg.ImageAPIKey,
	})

	adminSrv := &http.Server{
		Addr:              *adminAddr,
		Handler:           adminHandler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() { errCh <- adminSrv.ListenAndServe() }()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-sigCh:
		log.Printf("signal: %s", sig)
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("server error: %v", err)
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	_ = adminSrv.Shutdown(shutdownCtx)
}
