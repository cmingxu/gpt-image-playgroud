package admin

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"willing/internal/agent"
	"willing/internal/db"
	"willing/webui"
)

type Config struct {
	DB               *db.Store
	Agent            *agent.Service
	ImageAPIEndpoint string // fallback when request doesn't specify
	ImageAPIKey      string // fallback when request doesn't specify
}

func New(cfg Config) http.Handler {
	r := gin.New()
	r.Use(gin.Recovery())

	// COOP/COEP headers for SharedArrayBuffer
	r.Use(func(c *gin.Context) {
		c.Header("Cross-Origin-Opener-Policy", "same-origin")
		c.Header("Cross-Origin-Embedder-Policy", "credentialless")
		c.Next()
	})

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
			if cfg.ImageAPIEndpoint != "" {
				req.APIEndpoint = cfg.ImageAPIEndpoint
			} else {
				c.JSON(http.StatusBadRequest, gin.H{"error": "apiEndpoint is required"})
				return
			}
		}
		if req.APIKey == "" {
			if cfg.ImageAPIKey != "" {
				req.APIKey = cfg.ImageAPIKey
			} else {
				c.JSON(http.StatusBadRequest, gin.H{"error": "apiKey is required"})
				return
			}
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

		createBody := map[string]any{
			"prompt":      req.Prompt,
			"genType":     req.GenType,
			"aspectRatio": req.AspectRatio,
			"resolution":  req.Resolution,
		}
		if req.NSFWChecker != nil {
			createBody["nsfwChecker"] = *req.NSFWChecker
		}
		if len(req.ImageURLs) > 0 {
			var httpURLs []string
			var base64Files []string
			for _, u := range req.ImageURLs {
				if strings.HasPrefix(u, "data:") {
					if idx := strings.Index(u, ";base64,"); idx >= 0 {
						base64Files = append(base64Files, u[idx+len(";base64,"):])
					}
				} else {
					httpURLs = append(httpURLs, u)
				}
			}
			if len(httpURLs) > 0 {
				createBody["imageUrls"] = httpURLs
			}
			if len(base64Files) > 0 {
				if len(base64Files) == 1 {
					createBody["base64File"] = base64Files[0]
				} else {
					createBody["base64FileList"] = base64Files
				}
			}
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
				if cfg.DB != nil {
					cfg.DB.SaveHistory(c.Request.Context(), db.SaveHistoryParams{
						TaskID:    taskID,
						GenType:   req.GenType,
						Status:    "timeout",
						Prompt:    req.Prompt,
						InputURLs: req.ImageURLs,
						ErrorMsg:  "task timed out after 5 minutes",
					})
				}
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
				if cfg.DB != nil {
					cfg.DB.SaveHistory(c.Request.Context(), db.SaveHistoryParams{
						TaskID:    taskID,
						GenType:   req.GenType,
						Status:    "cancelled",
						Prompt:    req.Prompt,
						InputURLs: req.ImageURLs,
						ErrorMsg:  "request cancelled",
					})
				}
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
				if cfg.DB != nil {
					cfg.DB.SaveHistory(c.Request.Context(), db.SaveHistoryParams{
						TaskID:     taskID,
						GenType:    req.GenType,
						Status:     "success",
						Prompt:     req.Prompt,
						ResultURLs: statusData.Data.Result,
						InputURLs:  req.ImageURLs,
					})
				}
				c.JSON(http.StatusOK, gin.H{
					"taskId": taskID,
					"status": "success",
					"result": statusData.Data.Result,
				})
				return
			case "failed":
				if cfg.DB != nil {
					cfg.DB.SaveHistory(c.Request.Context(), db.SaveHistoryParams{
						TaskID:    taskID,
						GenType:   req.GenType,
						Status:    "failed",
						Prompt:    req.Prompt,
						InputURLs: req.ImageURLs,
						ErrorMsg:  statusData.Data.ErrorMsg,
					})
				}
				c.JSON(http.StatusOK, gin.H{
					"taskId":   taskID,
					"status":   "failed",
					"errorMsg": statusData.Data.ErrorMsg,
				})
				return
			}
		}
	})

	api.POST("/image/upload", func(c *gin.Context) {
		const maxBodySize = 16*10*1024*1024 + 1024*1024
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodySize)

		if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
			if strings.Contains(err.Error(), "request body too large") {
				c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "上传数据过大"})
				return
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": "无法解析上传数据"})
			return
		}

		files := c.Request.MultipartForm.File["files"]
		if len(files) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未选择任何文件"})
			return
		}
		if len(files) > 16 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "最多上传 16 张图片"})
			return
		}

		allowedTypes := map[string]bool{
			"image/jpeg": true, "image/png": true,
			"image/webp": true, "image/gif": true, "image/bmp": true,
		}

		const maxFileSize int64 = 10 * 1024 * 1024
		var urls []string

		for _, fh := range files {
			if fh.Size > maxFileSize {
				c.JSON(http.StatusBadRequest, gin.H{
					"error": fmt.Sprintf("文件 %q 超过大小限制 (最大 10MB)", fh.Filename),
				})
				return
			}

			f, err := fh.Open()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": fmt.Sprintf("无法打开文件 %q", fh.Filename),
				})
				return
			}

			buf := make([]byte, 512)
			n, err := f.Read(buf)
			if err != nil && err != io.EOF {
				f.Close()
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": fmt.Sprintf("无法读取文件 %q", fh.Filename),
				})
				return
			}
			detectedType := http.DetectContentType(buf[:n])

			if !allowedTypes[detectedType] {
				f.Close()
				c.JSON(http.StatusBadRequest, gin.H{
					"error": fmt.Sprintf("不支持的文件类型 %q (文件: %s)", detectedType, fh.Filename),
				})
				return
			}

			if _, err := f.Seek(0, io.SeekStart); err != nil {
				f.Close()
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": fmt.Sprintf("无法读取文件 %q", fh.Filename),
				})
				return
			}
			fileBytes, err := io.ReadAll(f)
			f.Close()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{
					"error": fmt.Sprintf("无法读取文件 %q", fh.Filename),
				})
				return
			}

			encoded := base64.StdEncoding.EncodeToString(fileBytes)
			dataURL := fmt.Sprintf("data:%s;base64,%s", detectedType, encoded)
			urls = append(urls, dataURL)
		}

		c.JSON(http.StatusOK, gin.H{"urls": urls})
	})

	// Persist images to disk, return permanent URLs for localStorage snapshots.
	// Splits storage: metadata → localStorage, pixel data → server disk.
	api.POST("/images", func(c *gin.Context) {
		var req struct {
			Images map[string]string `json:"images"` // assetId → base64 data (without data: prefix)
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if len(req.Images) == 0 {
			c.JSON(http.StatusOK, gin.H{"urls": map[string]string{}})
			return
		}

		dir := "var/images"
		if err := os.MkdirAll(dir, 0755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法创建图片目录"})
			return
		}

		urls := make(map[string]string, len(req.Images))
		for assetID, b64 := range req.Images {
			data, err := base64.StdEncoding.DecodeString(b64)
			if err != nil {
				continue
			}
			hash := fmt.Sprintf("%x", sha256.Sum256(data))[:16]
			filename := hash + ".png"
			filePath := filepath.Join(dir, filename)
			if _, err := os.Stat(filePath); os.IsNotExist(err) {
				if err := os.WriteFile(filePath, data, 0644); err != nil {
					continue
				}
			}
			urls[assetID] = "/api/images/" + filename
		}

		c.JSON(http.StatusOK, gin.H{"urls": urls})
	})

	// Serve persisted images
	api.GET("/images/:filename", func(c *gin.Context) {
		filename := c.Param("filename")
		// Prevent directory traversal
		filename = filepath.Base(filename)
		filePath := filepath.Join("var/images", filename)
		c.File(filePath)
	})

	// Session registration — auto-creates guest users
	api.POST("/session", func(c *gin.Context) {
		var req struct {
			GuestID string `json:"guestId"`
			IsNew   bool   `json:"isNew"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.GuestID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "guestId is required"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "guestId": req.GuestID, "isNew": req.IsNew})
	})

	// Save canvas snapshot + chat log for session
	api.POST("/session/snapshot", func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusOK, gin.H{"ok": true})
			return
		}
		var req struct {
			SessionID string `json:"sessionId"`
			Canvas    string `json:"canvas"`
			ChatLog   string `json:"chatLog"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.SessionID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sessionId is required"})
			return
		}
		if err := cfg.DB.SaveCanvasSnapshot(c.Request.Context(), req.SessionID, req.Canvas, req.ChatLog); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	// Load canvas snapshot + chat log for session
	api.GET("/session/snapshot", func(c *gin.Context) {
		sessionID := c.Query("sessionId")
		if sessionID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "sessionId query param is required"})
			return
		}
		if cfg.DB == nil {
			c.JSON(http.StatusOK, gin.H{"canvas": "", "chatLog": "[]"})
			return
		}
		snap, err := cfg.DB.GetCanvasSnapshot(c.Request.Context(), sessionID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if snap == nil {
			c.JSON(http.StatusOK, gin.H{"canvas": "", "chatLog": "[]"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"canvas": snap.Canvas, "chatLog": snap.ChatLog, "updatedAt": snap.UpdatedAt})
	})

	// Task polling endpoint
	api.GET("/task/:taskId", func(c *gin.Context) {
		if cfg.Agent == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "agent not configured"})
			return
		}
		taskID := c.Param("taskId")
		task := cfg.Agent.GetTask(taskID)
		if task == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "task not found"})
			return
		}
		c.JSON(http.StatusOK, task)
	})

	// Agent chat endpoint
	api.POST("/chat", func(c *gin.Context) {
		if cfg.Agent == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "agent not configured"})
			return
		}

		var req struct {
			SessionID   string   `json:"sessionId"`
			Message     string   `json:"message"`
			InputImages []string `json:"inputImages"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.Message == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "message is required"})
			return
		}
		if req.SessionID == "" {
			req.SessionID = "default"
		}

		log.Printf("[chat] request | session=%s | msg=%q | inputImages=%d", req.SessionID, req.Message, len(req.InputImages))

		resp, err := cfg.Agent.Chat(c.Request.Context(), req.SessionID, req.Message, req.InputImages)
		if err != nil {
			log.Printf("[chat] error | session=%s | err=%v", req.SessionID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		log.Printf("[chat] response | session=%s | taskId=%s | toolName=%s", req.SessionID, resp.TaskID, resp.ToolName)
		c.JSON(http.StatusOK, gin.H{
			"thinking":  resp.Thinking,
			"message":   resp.Message,
			"imageUrls": resp.ImageURLs,
			"taskId":    resp.TaskID,
			"toolName":  resp.ToolName,
			"toolArgs":  resp.ToolArgs,
			"choices":   resp.Choices,
		})
	})

	// History endpoints
	api.GET("/history", func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusOK, gin.H{"items": []any{}, "total": 0})
			return
		}
		limit := 50
		offset := 0
		if v, err := strconv.Atoi(c.DefaultQuery("limit", "50")); err == nil && v > 0 && v <= 200 {
			limit = v
		}
		if v, err := strconv.Atoi(c.DefaultQuery("offset", "0")); err == nil && v >= 0 {
			offset = v
		}
		items, total, err := cfg.DB.ListHistory(c.Request.Context(), limit, offset)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		type historyItem struct {
			ID           int64    `json:"id"`
			TaskID       string   `json:"taskId"`
			GenType      string   `json:"genType"`
			Status       string   `json:"status"`
			Prompt       string   `json:"prompt"`
			ResultURLs   []string `json:"resultUrls"`
			InputURLs    []string `json:"inputUrls"`
			ErrorMsg     string   `json:"errorMsg"`
			CreatedAtUTC string   `json:"createdAtUtc"`
		}
		result := make([]historyItem, 0, len(items))
		for _, it := range items {
			var urls []string
			if it.ResultURLs != "" {
				json.Unmarshal([]byte(it.ResultURLs), &urls)
			}
			if urls == nil {
				urls = []string{}
			}
			var inputs []string
			if it.InputURLs != "" {
				json.Unmarshal([]byte(it.InputURLs), &inputs)
			}
			if inputs == nil {
				inputs = []string{}
			}
			result = append(result, historyItem{
				ID:           it.ID,
				TaskID:       it.TaskID,
				GenType:      it.GenType,
				Status:       it.Status,
				Prompt:       it.Prompt,
				ResultURLs:   urls,
				InputURLs:    inputs,
				ErrorMsg:     it.ErrorMsg,
				CreatedAtUTC: it.CreatedAtUTC.Format(time.RFC3339),
			})
		}
		c.JSON(http.StatusOK, gin.H{"items": result, "total": total})
	})

	api.GET("/history/:id", func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		item, err := cfg.DB.GetHistory(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		var urls []string
		if item.ResultURLs != "" {
			json.Unmarshal([]byte(item.ResultURLs), &urls)
		}
		if urls == nil {
			urls = []string{}
		}
		var inputs []string
		if item.InputURLs != "" {
			json.Unmarshal([]byte(item.InputURLs), &inputs)
		}
		if inputs == nil {
			inputs = []string{}
		}
		c.JSON(http.StatusOK, gin.H{
			"id":           item.ID,
			"taskId":       item.TaskID,
			"genType":      item.GenType,
			"status":       item.Status,
			"prompt":       item.Prompt,
			"resultUrls":   urls,
			"inputUrls":    inputs,
			"errorMsg":     item.ErrorMsg,
			"createdAtUtc": item.CreatedAtUTC.Format(time.RFC3339),
		})
	})

	api.DELETE("/history/:id", func(c *gin.Context) {
		if cfg.DB == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
			return
		}
		if err := cfg.DB.DeleteHistory(c.Request.Context(), id); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	webui.Register(r)

	return r
}
