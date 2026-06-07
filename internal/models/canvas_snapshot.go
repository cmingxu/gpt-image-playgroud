package models

import "time"

// CanvasSnapshot stores the serialized canvas state and chat messages for a session.
type CanvasSnapshot struct {
	ID        int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	SessionID string    `gorm:"not null;uniqueIndex" json:"sessionId"`
	Canvas    string    `gorm:"type:longtext" json:"canvas"` // serialized tldraw snapshot
	ChatLog   string    `gorm:"type:longtext" json:"chatLog"` // JSON array of chat messages
	UpdatedAt time.Time `json:"updatedAt"`
}

func (CanvasSnapshot) TableName() string {
	return "canvas_snapshots"
}
