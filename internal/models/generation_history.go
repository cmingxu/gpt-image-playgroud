package models

import "time"

type GenerationHistory struct {
	ID           int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	TaskID       string    `gorm:"not null;index" json:"taskId"`
	GenType      string    `gorm:"not null" json:"genType"`
	Status       string    `gorm:"not null" json:"status"`
	Prompt       string    `gorm:"not null;type:text" json:"prompt"`
	ResultURLs   string    `gorm:"type:text" json:"resultUrls"`
	InputURLs    string    `gorm:"type:text" json:"inputUrls"`
	ErrorMsg     string    `gorm:"type:text" json:"errorMsg"`
	CreatedAtUTC time.Time `json:"createdAtUtc"`
}

func (GenerationHistory) TableName() string {
	return "generation_history"
}
