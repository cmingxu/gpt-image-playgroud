package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/cloudwego/eino/schema"

	openai "github.com/cloudwego/eino-ext/components/model/openai"
)

// Config holds configuration for the image editing agent.
type Config struct {
	SiliconFlowAPIKey  string
	SiliconFlowBaseURL string
	SiliconFlowModel   string
	ImageAPIEndpoint   string
	ImageAPIKey        string
}

// TaskStatus represents an async image generation task.
type TaskStatus struct {
	TaskID    string   `json:"taskId"`
	Status    string   `json:"status"` // "running", "success", "failed"
	Message   string   `json:"message"`
	ImageURLs []string `json:"imageUrls,omitempty"`
	Error     string   `json:"error,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// TaskStore holds running/completed tasks.
type TaskStore struct {
	mu    sync.RWMutex
	tasks map[string]*TaskStatus
}

func newTaskStore() *TaskStore {
	return &TaskStore{tasks: make(map[string]*TaskStatus)}
}

func (ts *TaskStore) Create(message string) *TaskStatus {
	t := &TaskStatus{
		TaskID:    fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Status:    "running",
		Message:   message,
		CreatedAt: time.Now(),
	}
	ts.mu.Lock()
	ts.tasks[t.TaskID] = t
	ts.mu.Unlock()
	return t
}

func (ts *TaskStore) Get(taskID string) *TaskStatus {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.tasks[taskID]
}

func (ts *TaskStore) Complete(taskID string, imageURLs []string, message string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if t, ok := ts.tasks[taskID]; ok {
		t.Status = "success"
		t.ImageURLs = imageURLs
		t.Message = message
	}
}

func (ts *TaskStore) Fail(taskID string, errMsg string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if t, ok := ts.tasks[taskID]; ok {
		t.Status = "failed"
		t.Error = errMsg
	}
}

// Service is the multi-round image editing agent service.
type Service struct {
	chatModel *openai.ChatModel
	imgSvc    *ImageGenService
	sessions  map[string][]*schema.Message
	mu        sync.Mutex
	taskStore *TaskStore
}

// ChoiceOption represents a selectable parameter prompt from the agent.
type ChoiceOption struct {
	Key     string   `json:"key"`     // e.g. "resolution"
	Label   string   `json:"label"`   // e.g. "分辨率"
	Options []string `json:"options"` // e.g. ["1K","2K","4K"]
}

// ChatResponse wraps the agent's response.
type ChatResponse struct {
	Thinking  string          `json:"thinking,omitempty"`  // LLM text before tool call
	Message   string          `json:"message"`
	ImageURLs []string        `json:"imageUrls,omitempty"`
	TaskID    string          `json:"taskId,omitempty"`
	ToolName  string          `json:"toolName,omitempty"`  // e.g. "text_to_image"
	ToolArgs  string          `json:"toolArgs,omitempty"`  // JSON string of tool arguments
	Choices   []*ChoiceOption `json:"choices,omitempty"`   // Interactive choice prompts
}

// New creates a new agent service.
func New(ctx context.Context, cfg Config) (*Service, error) {
	model := cfg.SiliconFlowModel
	if model == "" {
		model = "deepseek-ai/DeepSeek-V3"
	}

	chatModel, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
		BaseURL: cfg.SiliconFlowBaseURL,
		APIKey:  cfg.SiliconFlowAPIKey,
		Model:   model,
	})
	if err != nil {
		return nil, fmt.Errorf("create chat model: %w", err)
	}

	return &Service{
		chatModel: chatModel,
		imgSvc:    NewImageGenService(cfg.ImageAPIEndpoint, cfg.ImageAPIKey),
		sessions:  make(map[string][]*schema.Message),
		taskStore: newTaskStore(),
	}, nil
}

// GetTask returns the status of an async task.
func (s *Service) GetTask(taskID string) *TaskStatus {
	return s.taskStore.Get(taskID)
}

// systemPrompt defines the agent's behavior.
const systemPrompt = `你是AI图像助手，可以生成和编辑图片。请用中文回复。

## 铁律：一次完成，绝不拆步

用户的任何请求都必须在一个工具调用中完成。即使涉及多张参考图，也一次性将所有图片传给 image_to_image，由图像模型自己理解和合成。绝不要拆成"先处理A再处理B"的步骤。

## 参数规则

- 用户未指定 resolution 或 aspectRatio 时，列出 CHOOSE 选项让用户选择，不要用默认值。
默认值仅供参考：resolution="1K", aspectRatio="auto"
- 有参考图 → image_to_image（包含所有参考图，imageUrls用"url1","url2"...占位）
- 无参考图 → text_to_image

## 回复格式

用户未指定参数时（先追问，等用户选择后再一次完成）：
CHOOSE:resolution|1K,2K,4K
CHOOSE:aspectRatio|auto,1:1,16:9,9:16,4:3
请选择分辨率和比例。

用户已指定参数时（一次调用工具完成）：
先写1-2句中文思考，换行写 TOOL:工具名|{JSON参数}
TOOL行后不写任何内容。

## 示例

用户："生成一只赛博朋克猫"（未指定参数 → 追问）
回复：
CHOOSE:resolution|1K,2K,4K
CHOOSE:aspectRatio|auto,1:1,16:9,9:16,4:3
请选择分辨率和比例，我会为你生成图片。

用户（选择后）："2K，16:9"
回复：好的，赛博朋克猫，2K高清16:9。
TOOL:text_to_image|{"prompt":"A cyberpunk cat with neon lights, mechanical augmentations, dark moody background, rain-slicked streets, purple and blue neon glow, highly detailed, cinematic lighting","resolution":"2K","aspectRatio":"16:9"}

用户：[用户上传了 2 张参考图片] "把第一张的logo放到第二张的物品上"（未指定参数 → 追问）
回复：
CHOOSE:resolution|1K,2K,4K
CHOOSE:aspectRatio|auto,1:1,16:9,9:16,4:3
请选择分辨率和比例。

用户（选择后）："1K，auto"
回复：好的，把第一张图的logo合成到第二张图的物品上。
TOOL:image_to_image|{"prompt":"Extract the logo from the first reference image and composite it onto the item in the second reference image, blend naturally with proper perspective, lighting and shadows, photorealistic","resolution":"1K","aspectRatio":"auto","imageUrls":["url1","url2"]}

用户："把这张图变成油画，4K"（已指定参数 → 直接调用）
回复：好的，古典油画风格，4K超清。
TOOL:image_to_image|{"prompt":"Transform into classical oil painting style, rich impasto brushstrokes, warm lighting, old masters technique, detailed texture","resolution":"4K","aspectRatio":"auto","imageUrls":["url1"]}
`

// Chat handles a single conversation turn with the agent.
// When a tool call is detected, the image generation is started asynchronously
// and a task ID is returned immediately so the frontend can poll for results.
func (s *Service) Chat(ctx context.Context, sessionID, userMessage string, inputImages []string) (*ChatResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	log.Printf("[agent] chat start | session=%s | msg=%q | inputImages=%d", sessionID, userMessage, len(inputImages))

	// Get or create session history
	history := s.sessions[sessionID]
	if history == nil {
		log.Printf("[agent] new session=%s", sessionID)
		// First message: add system prompt
		history = []*schema.Message{
			{Role: schema.System, Content: systemPrompt},
		}
	}

	// Build user message — never include raw base64 data in LLM context
	content := userMessage
	if len(inputImages) > 0 {
		// Only tell the LLM count and type, not the raw base64 data
		isDataURL := strings.HasPrefix(inputImages[0], "data:")
		if isDataURL {
			content += fmt.Sprintf("\n[用户上传了 %d 张参考图片]", len(inputImages))
		} else {
			content += fmt.Sprintf("\n[参考图片: %s]", strings.Join(inputImages, ", "))
		}
	}

	history = append(history, &schema.Message{Role: schema.User, Content: content})

	// Trim history to prevent token overflow (keep system + last 6 user/assistant pairs)
	history = trimHistory(history)

	// Run the agent loop (max 3 tool calls per turn)
	maxIter := 3
	for i := 0; i < maxIter; i++ {
		log.Printf("[agent] LLM call | session=%s | iter=%d | historyLen=%d", sessionID, i, len(history))
		resp, err := s.chatModel.Generate(ctx, history)
		if err != nil {
			log.Printf("[agent] LLM error | session=%s | err=%v", sessionID, err)
			return nil, fmt.Errorf("model generate: %w", err)
		}

		log.Printf("[agent] LLM response | session=%s | content=%q", sessionID, truncate(resp.Content, 300))
		history = append(history, resp)

		// Parse CHOOSE markers — interactive choice prompts
		choices, cleanText := parseChoices(resp.Content)
		if len(choices) > 0 {
			log.Printf("[agent] choices detected | session=%s | count=%d", sessionID, len(choices))
			s.sessions[sessionID] = history
			return &ChatResponse{
				Thinking: cleanText,
				Message:  cleanText,
				Choices:  choices,
			}, nil
		}

		// Check if the response contains a tool call
		toolName, toolArgs, thinking, isTool := parseToolCall(resp.Content)
		if !isTool {
			log.Printf("[agent] no tool call | session=%s | final response", sessionID)
			// No tool call — this is the final response
			s.sessions[sessionID] = history
			return &ChatResponse{
				Thinking: thinking,
				Message:  thinking,
			}, nil
		}

		log.Printf("[agent] tool call detected | session=%s | tool=%s | args=%s | thinking=%q",
			sessionID, toolName, truncate(toolArgs, 200), truncate(thinking, 100))

		// Create an async task for the tool execution
		task := s.taskStore.Create(fmt.Sprintf("正在调用 %s …", toolName))
		s.sessions[sessionID] = history

		// Execute tool asynchronously
		go s.executeToolAsync(task.TaskID, sessionID, toolName, toolArgs, inputImages)

		log.Printf("[agent] async task started | session=%s | taskId=%s | tool=%s", sessionID, task.TaskID, toolName)
		return &ChatResponse{
			Thinking: thinking,
			Message:  fmt.Sprintf("正在调用 %s …", toolName),
			TaskID:   task.TaskID,
			ToolName: toolName,
			ToolArgs: toolArgs,
		}, nil
	}

	s.sessions[sessionID] = history
	return &ChatResponse{
		Message: "操作完成",
	}, nil
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

// trimHistory keeps the system prompt + last N user/assistant exchange pairs.
// This prevents unbounded history growth that exceeds token limits.
func trimHistory(history []*schema.Message) []*schema.Message {
	const maxPairs = 6 // keep at most 6 user/assistant exchanges

	if len(history) <= 1 {
		return history
	}

	systemMsg := history[0] // always keep system prompt

	// Collect user+assistant messages after system prompt
	messages := history[1:]
	if len(messages) <= maxPairs*2 {
		return history
	}

	// Keep only the last N pairs
	keep := maxPairs * 2
	trimmed := messages[len(messages)-keep:]

	newHistory := make([]*schema.Message, 0, 1+len(trimmed))
	newHistory = append(newHistory, systemMsg)
	newHistory = append(newHistory, trimmed...)

	return newHistory
}

// executeToolAsync runs a tool in the background and updates session + task store.
func (s *Service) executeToolAsync(taskID, sessionID, toolName, toolArgs string, inputImages []string) {
	log.Printf("[agent] tool start | taskId=%s | tool=%s | args=%s | inputImages=%d", taskID, toolName, truncate(toolArgs, 200), len(inputImages))
	ctx := context.Background()

	resultText, imageURLs, err := s.executeTool(ctx, toolName, toolArgs, inputImages)
	if err != nil {
		log.Printf("[agent] tool failed | taskId=%s | tool=%s | err=%v", taskID, toolName, err)
		s.taskStore.Fail(taskID, err.Error())
		return
	}

	log.Printf("[agent] tool success | taskId=%s | tool=%s | resultCount=%d | urls=%v",
		taskID, toolName, len(imageURLs), imageURLs)

	// Update task store with results
	msg := fmt.Sprintf("已生成 %d 张图片", len(imageURLs))
	s.taskStore.Complete(taskID, imageURLs, msg)

	// Update session history with the tool result
	s.mu.Lock()
	defer s.mu.Unlock()

	history := s.sessions[sessionID]
	if history == nil {
		return
	}

	history = append(history, &schema.Message{
		Role:    schema.Tool,
		Content: resultText,
	})

	// Ask model to summarize and add to history
	history = append(history, &schema.Message{
		Role:    schema.User,
		Content: "请用中文简要描述刚才生成的结果",
	})

	summary, err := s.chatModel.Generate(ctx, history)
	if err == nil {
		log.Printf("[agent] summary | session=%s | content=%q", sessionID, truncate(summary.Content, 200))
		history = append(history, summary)
	}

	s.sessions[sessionID] = history
}

// Valid option sets — used to validate/sanitize LLM output
var validOptions = map[string][]string{
	"resolution":  {"1K", "2K", "4K"},
	"aspectRatio": {"auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"},
}

var labelMap = map[string]string{
	"resolution":  "分辨率",
	"aspectRatio": "比例",
}

// parseChoices extracts CHOOSE markers from the response.
// Format: CHOOSE:key|opt1,opt2,opt3
// Tolerant: handles extra whitespace, strips non-matching options, logs problems.
func parseChoices(content string) ([]*ChoiceOption, string) {
	lines := strings.Split(content, "\n")
	var choices []*ChoiceOption
	var cleanLines []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "CHOOSE:") {
			cleanLines = append(cleanLines, line)
			continue
		}

		rest := trimmed[len("CHOOSE:"):]
		// Split on | (preferred) or : (fallback for LLM mistakes)
		sep := "|"
		if !strings.Contains(rest, "|") && strings.Contains(rest, ":") {
			sep = ":"
			log.Printf("[choices] LLM used colon instead of pipe, falling back: %s", trimmed)
		}

		parts := strings.SplitN(rest, sep, 3)
		if len(parts) < 2 {
			log.Printf("[choices] malformed CHOOSE line (missing separator): %s", trimmed)
			cleanLines = append(cleanLines, line)
			continue
		}

		key := strings.TrimSpace(parts[0])

		// Validate key against known keys
		if _, ok := validOptions[key]; !ok {
			log.Printf("[choices] unknown key %q in CHOOSE line: %s", key, trimmed)
			cleanLines = append(cleanLines, line)
			continue
		}

		// Parse options string (last part)
		optsStr := strings.TrimSpace(parts[len(parts)-1])
		// Remove any trailing punctuation
		optsStr = strings.TrimRight(optsStr, ".。,，;；")

		rawOpts := strings.Split(optsStr, ",")
		var options []string
		validSet := validOptions[key]

		for _, o := range rawOpts {
			o = strings.TrimSpace(o)
			if o == "" {
				continue
			}
			// Only accept options from the valid set
			for _, valid := range validSet {
				if o == valid {
					options = append(options, o)
					break
				}
			}
		}

		if len(options) == 0 {
			log.Printf("[choices] no valid options found in CHOOSE line: %s (raw=%q)", trimmed, rawOpts)
			cleanLines = append(cleanLines, line)
			continue
		}

		label := labelMap[key]
		if label == "" {
			label = key
		}

		log.Printf("[choices] parsed | key=%s | label=%s | options=%v", key, label, options)
		choices = append(choices, &ChoiceOption{
			Key:     key,
			Label:   label,
			Options: options,
		})
	}

	return choices, strings.TrimSpace(strings.Join(cleanLines, "\n"))
}

// parseToolCall extracts a tool call from the model response.
// Format: TOOL:tool_name|{"key":"value",...}
// Returns the tool name, JSON args, thinking text (everything before TOOL:), and whether a tool was found.
func parseToolCall(content string) (name string, args string, thinking string, ok bool) {
	idx := strings.Index(content, "TOOL:")
	if idx < 0 {
		return "", "", strings.TrimSpace(content), false
	}

	// Everything before TOOL: is the thinking text
	thinking = strings.TrimSpace(content[:idx])

	rest := content[idx+len("TOOL:"):]
	parts := strings.SplitN(rest, "|", 2)
	if len(parts) != 2 {
		return "", "", thinking, false
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), thinking, true
}

// executeTool executes a named tool with JSON arguments.
// inputImages are the real images from the frontend; used to replace LLM
// placeholders since data URLs are hidden from the LLM context.
func (s *Service) executeTool(ctx context.Context, name, argsJSON string, inputImages []string) (result string, imageURLs []string, err error) {
	switch name {
	case "text_to_image":
		var args struct {
			Prompt      string `json:"prompt"`
			Resolution  string `json:"resolution"`
			AspectRatio string `json:"aspectRatio"`
		}
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", nil, fmt.Errorf("parse args: %w", err)
		}
		// Auto-upgrade to i2i when user attached images but LLM called t2i
		imageURLs := inputImages
		urls, err := s.imgSvc.callGPTImage(ctx, args.Prompt, imageURLs, args.Resolution, args.AspectRatio)
		if err != nil {
			return "", nil, err
		}
		result, _ := json.Marshal(map[string]any{
			"success": true, "imageUrls": urls,
			"message": fmt.Sprintf("Generated %d images", len(urls)),
		})
		return string(result), urls, nil

	case "image_to_image":
		var args struct {
			Prompt      string   `json:"prompt"`
			ImageURLs   []string `json:"imageUrls"`
			Resolution  string   `json:"resolution"`
			AspectRatio string   `json:"aspectRatio"`
		}
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", nil, fmt.Errorf("parse args: %w", err)
		}
		// Use real inputImages from the frontend — the LLM only sees
		// "[用户上传了 N 张图片]" so its imageUrls are placeholders.
		realURLs := inputImages
		if len(realURLs) == 0 {
			// Fallback: user mentioned URLs in message text (visible to LLM)
			realURLs = args.ImageURLs
		}
		urls, err := s.imgSvc.callGPTImage(ctx, args.Prompt, realURLs, args.Resolution, args.AspectRatio)
		if err != nil {
			return "", nil, err
		}
		result, _ := json.Marshal(map[string]any{
			"success": true, "imageUrls": urls,
			"message": fmt.Sprintf("Edited %d images", len(urls)),
		})
		return string(result), urls, nil

	default:
		return fmt.Sprintf("Unknown tool: %s", name), nil, nil
	}
}
