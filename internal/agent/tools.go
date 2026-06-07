package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
)

// ImageGenService wraps the GPT Image API for tool use.
type ImageGenService struct {
	APIEndpoint string
	APIKey      string
	HTTPClient  *http.Client
}

func NewImageGenService(endpoint, apiKey string) *ImageGenService {
	return &ImageGenService{
		APIEndpoint: strings.TrimRight(endpoint, "/"),
		APIKey:      apiKey,
		HTTPClient:  &http.Client{Timeout: 5 * time.Minute},
	}
}

// TextToImageTool generates images from a text prompt.
type TextToImageTool struct {
	svc *ImageGenService
}

var _ tool.InvokableTool = (*TextToImageTool)(nil)

func NewTextToImageTool(svc *ImageGenService) *TextToImageTool {
	return &TextToImageTool{svc: svc}
}

func (t *TextToImageTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "text_to_image",
		Desc: "根据文本描述生成图像。当用户要求创建、生成、画一张图片时使用此工具",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"prompt": {
				Type:     "string",
				Desc:     "图像生成的提示词描述，中文或英文",
				Required: true,
			},
		}),
	}, nil
}

func (t *TextToImageTool) InvokableRun(ctx context.Context, argumentsInJSON string, opts ...tool.Option) (string, error) {
	var args struct {
		Prompt string `json:"prompt"`
	}
	if err := json.Unmarshal([]byte(argumentsInJSON), &args); err != nil {
		return "", fmt.Errorf("parse args: %w", err)
	}

	urls, err := t.svc.callGPTImage(ctx, args.Prompt, nil, "", "")
	if err != nil {
		return "", err
	}

	result, _ := json.Marshal(map[string]interface{}{
		"success":   true,
		"imageUrls": urls,
		"message":   fmt.Sprintf("已生成 %d 张图片", len(urls)),
	})
	return string(result), nil
}

// ImageToImageTool edits existing images based on a text prompt.
type ImageToImageTool struct {
	svc *ImageGenService
}

var _ tool.InvokableTool = (*ImageToImageTool)(nil)

func NewImageToImageTool(svc *ImageGenService) *ImageToImageTool {
	return &ImageToImageTool{svc: svc}
}

func (t *ImageToImageTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "image_to_image",
		Desc: "基于参考图像和文本描述生成新图像。当用户要求修改、编辑、变换已有图片，或基于参考图生成新图时使用此工具",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"prompt": {
				Type:     "string",
				Desc:     "描述想要的修改或生成效果的提示词",
				Required: true,
			},
			"imageUrls": {
				Type:     "array",
				Desc:     "参考图像的URL列表，用户提供的图片链接",
				Required: true,
			},
		}),
	}, nil
}

func (t *ImageToImageTool) InvokableRun(ctx context.Context, argumentsInJSON string, opts ...tool.Option) (string, error) {
	var args struct {
		Prompt    string   `json:"prompt"`
		ImageURLs []string `json:"imageUrls"`
	}
	if err := json.Unmarshal([]byte(argumentsInJSON), &args); err != nil {
		return "", fmt.Errorf("parse args: %w", err)
	}

	urls, err := t.svc.callGPTImage(ctx, args.Prompt, args.ImageURLs, "", "")
	if err != nil {
		return "", err
	}

	result, _ := json.Marshal(map[string]interface{}{
		"success":   true,
		"imageUrls": urls,
		"message":   fmt.Sprintf("已基于参考图生成 %d 张新图片", len(urls)),
	})
	return string(result), nil
}

// callGPTImage calls the GPT Image API, creates a task, and polls until completion.
func (s *ImageGenService) callGPTImage(ctx context.Context, prompt string, imageURLs []string, resolution, aspectRatio string) ([]string, error) {
	createURL := s.APIEndpoint + "/api/v2/open/aigc/gpt-image"

	genType := "t2i"
	if len(imageURLs) > 0 {
		genType = "i2i"
	}
	if resolution == "" {
		resolution = "1K"
	}
	if aspectRatio == "" {
		aspectRatio = "auto"
	}

	createBody := map[string]any{
		"prompt":      prompt,
		"genType":     genType,
		"resolution":  resolution,
		"aspectRatio": aspectRatio,
	}
	// Separate HTTP URLs from base64 data URLs per API spec
	var httpURLs []string
	var base64Files []string
	if len(imageURLs) > 0 {
		for _, u := range imageURLs {
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
		return nil, fmt.Errorf("marshal: %w", err)
	}

	log.Printf("[image] create task | genType=%s | prompt=%q | httpURLs=%d | base64Files=%d | endpoint=%s",
		genType, truncatePrompt(prompt, 150), len(httpURLs), len(base64Files), createURL)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, createURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.APIKey)

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		log.Printf("[image] create task error | err=%v", err)
		return nil, fmt.Errorf("create task: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	var createResp struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			TaskID string `json:"taskId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &createResp); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}
	if createResp.Code != 0 {
		log.Printf("[image] create task failed | code=%d | msg=%s", createResp.Code, createResp.Msg)
		return nil, fmt.Errorf("create task failed: %s", createResp.Msg)
	}

	taskID := createResp.Data.TaskID
	if taskID == "" {
		return nil, fmt.Errorf("no task ID returned")
	}

	log.Printf("[image] task created | taskId=%s | genType=%s", taskID, genType)

	// Poll for completion
	statusURL := s.APIEndpoint + "/api/v2/open/aigc/" + taskID
	pollClient := &http.Client{Timeout: 15 * time.Second}
	start := time.Now()
	maxDuration := 5 * time.Minute
	pollCount := 0

	for {
		if time.Since(start) > maxDuration {
			log.Printf("[image] task timeout | taskId=%s | elapsed=%v", taskID, time.Since(start))
			return nil, fmt.Errorf("task timed out")
		}

		var interval time.Duration
		elapsed := time.Since(start)
		switch {
		case elapsed < 30*time.Second:
			interval = 3 * time.Second
		case elapsed < 2*time.Minute:
			interval = 5 * time.Second
		default:
			interval = 10 * time.Second
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}

		pollCount++
		statusReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, statusURL, nil)
		statusReq.Header.Set("Authorization", "Bearer "+s.APIKey)
		statusResp, err := pollClient.Do(statusReq)
		if err != nil {
			log.Printf("[image] poll error | taskId=%s | poll=%d | err=%v", taskID, pollCount, err)
			continue
		}
		statusBody, _ := io.ReadAll(statusResp.Body)
		statusResp.Body.Close()

		var statusData struct {
			Data struct {
				Status   string   `json:"status"`
				Result   []string `json:"result"`
				ErrorMsg string   `json:"errorMsg"`
			} `json:"data"`
		}
		json.Unmarshal(statusBody, &statusData)

		switch statusData.Data.Status {
		case "success":
			log.Printf("[image] task success | taskId=%s | resultCount=%d | elapsed=%v | polls=%d",
				taskID, len(statusData.Data.Result), time.Since(start).Round(time.Second), pollCount)
			return statusData.Data.Result, nil
		case "failed":
			log.Printf("[image] task failed | taskId=%s | error=%s | elapsed=%v",
				taskID, statusData.Data.ErrorMsg, time.Since(start).Round(time.Second))
			return nil, fmt.Errorf("generation failed: %s", statusData.Data.ErrorMsg)
		}
	}
}

func truncatePrompt(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}
