package admin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"willing/internal/db"
	"willing/webui"
)

type Config struct {
	DB *db.Store
}

func New(cfg Config) http.Handler {
	r := gin.New()
	r.Use(gin.Recovery())

	r.GET("/api/health", func(c *gin.Context) {
		status := gin.H{
			"ok":   true,
			"time": time.Now().UTC().Format(time.RFC3339Nano),
		}
		if cfg.DB != nil {
			if err := cfg.DB.Ping(c.Request.Context()); err != nil {
				status["db_ok"] = false
				status["db_error"] = err.Error()
				c.JSON(http.StatusServiceUnavailable, status)
				return
			}
			status["db_ok"] = true
		} else {
			status["db_ok"] = nil
		}
		c.JSON(http.StatusOK, status)
	})

	api := r.Group("/api")

	api.GET("/system-config", func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusOK, gin.H{"items": gin.H{}})
			return
		}
		sc, err := cfg.DB.GetSystemConfig(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"items": map[string]string{
				"warn_text": sc.WarnText,
			},
		})
	})

	type setConfigRequest struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}

	api.PUT("/system-config", func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "db not configured"})
			return
		}
		var req setConfigRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var upd db.SystemConfigUpdate
		switch strings.ToLower(strings.TrimSpace(req.Key)) {
		case "warn_text":
			upd.WarnText = &req.Value
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "unknown key"})
			return
		}

		if _, err := cfg.DB.UpdateSystemConfig(c.Request.Context(), upd); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	api.POST("/image/generate", func(c *gin.Context) {
		var req struct {
			APIEndpoint string   `json:"apiEndpoint"`
			APIKey      string   `json:"apiKey"`
			Prompt      string   `json:"prompt"`
			GenType     string   `json:"genType"`
			AspectRatio string   `json:"aspectRatio"`
			Resolution  string   `json:"resolution"`
			NSFWChecker *bool    `json:"nsfwChecker"`
			ImageURLs   []string `json:"imageUrls"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if req.APIEndpoint == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "apiEndpoint is required"})
			return
		}
		if req.APIKey == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "apiKey is required"})
			return
		}
		if req.Prompt == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "prompt is required"})
			return
		}

		if req.GenType == "" {
			req.GenType = "t2i"
		}
		if req.AspectRatio == "" {
			req.AspectRatio = "auto"
		}
		if req.Resolution == "" {
			req.Resolution = "1K"
		}

		baseURL := strings.TrimRight(req.APIEndpoint, "/")
		createURL := baseURL + "/api/v2/open/aigc/gpt-image"

		createBody := map[string]interface{}{
			"prompt":      req.Prompt,
			"genType":     req.GenType,
			"aspectRatio": req.AspectRatio,
			"resolution":  req.Resolution,
		}
		if req.NSFWChecker != nil {
			createBody["nsfwChecker"] = *req.NSFWChecker
		}
		if len(req.ImageURLs) > 0 {
			createBody["imageUrls"] = req.ImageURLs
		}

		bodyBytes, err := json.Marshal(createBody)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("marshal request: %v", err)})
			return
		}

		client := &http.Client{Timeout: 30 * time.Second}

		httpReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, createURL, bytes.NewReader(bodyBytes))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("create request: %v", err)})
			return
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+req.APIKey)

		resp, err := client.Do(httpReq)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("create task failed: %v", err)})
			return
		}
		defer resp.Body.Close()

		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("read response: %v", err)})
			return
		}

		var createResp struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
			Data struct {
				TaskID    string `json:"taskId"`
				Status    string `json:"status"`
				CreatedAt string `json:"createdAt"`
			} `json:"data"`
		}
		if err := json.Unmarshal(respBody, &createResp); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("parse response: %v", err)})
			return
		}
		if createResp.Code != 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": createResp.Msg})
			return
		}

		taskID := createResp.Data.TaskID
		if taskID == "" {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no taskId returned"})
			return
		}

		// Poll for task completion with progressive backoff
		statusURL := baseURL + "/api/v2/open/aigc/" + taskID
		pollClient := &http.Client{Timeout: 15 * time.Second}
		startTime := time.Now()
		maxDuration := 5 * time.Minute

		for {
			elapsed := time.Since(startTime)
			if elapsed > maxDuration {
				c.JSON(http.StatusGatewayTimeout, gin.H{"error": "task timed out after 5 minutes", "taskId": taskID})
				return
			}

			var interval time.Duration
			switch {
			case elapsed < 30*time.Second:
				interval = 3 * time.Second
			case elapsed < 2*time.Minute:
				interval = 5 * time.Second
			default:
				interval = 10 * time.Second
			}

			select {
			case <-c.Request.Context().Done():
				c.JSON(http.StatusRequestTimeout, gin.H{"error": "request cancelled", "taskId": taskID})
				return
			case <-time.After(interval):
			}

			statusReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, statusURL, nil)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("create status request: %v", err)})
				return
			}
			statusReq.Header.Set("Authorization", "Bearer "+req.APIKey)

			statusResp, err := pollClient.Do(statusReq)
			if err != nil {
				// Retry on transient network errors
				continue
			}
			statusBody, err := io.ReadAll(statusResp.Body)
			statusResp.Body.Close()
			if err != nil {
				continue
			}

			var statusData struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
				Data struct {
					TaskID    string   `json:"taskId"`
					Status    string   `json:"status"`
					Result    []string `json:"result"`
					ErrorMsg  string   `json:"errorMsg"`
					CreatedAt string   `json:"createdAt"`
					UpdatedAt string   `json:"updatedAt"`
				} `json:"data"`
			}
			if err := json.Unmarshal(statusBody, &statusData); err != nil {
				continue
			}

			switch statusData.Data.Status {
			case "success":
				c.JSON(http.StatusOK, gin.H{
					"taskId": taskID,
					"status": "success",
					"result": statusData.Data.Result,
				})
				return
			case "failed":
				c.JSON(http.StatusOK, gin.H{
					"taskId":   taskID,
					"status":   "failed",
					"errorMsg": statusData.Data.ErrorMsg,
				})
				return
			}
		}
	})

	webui.Register(r)

	return r
}
