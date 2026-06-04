# GPT Image Playgroud

基于 GPT Image 2 模型的图像生成工具，支持文生图和图生图两种模式。Go 后端 + React 前端，左右分栏布局，参数配置与图片预览同屏呈现。

## 功能

- **文生图 (t2i)**：根据提示词生成图像
- **图生图 (i2i)**：基于参考图进行图像变换
- **异步任务轮询**：自动创建任务并轮询状态直至完成（渐进式退避策略）
- **参数配置**：宽高比、分辨率、NSFW 检测等完整参数
- **图片预览**：左栏配置参数，右栏实时展示生成结果
- **一键下载**：支持下载生成图片或新窗口打开

## 快速开始

### 前置要求

- Go 1.25+
- Node.js 18+

### 开发模式

```bash
# 终端 1：启动 Go 后端（端口 8081）
ADMIN_ADDR=:8081 make dev

# 终端 2：启动前端开发服务器（Vite HMR，端口 5173）
cd web && npm install && npm run dev
```

浏览器访问 `http://localhost:5173`，API 请求自动代理到后端。

### 生产构建

```bash
make build
# 构建产物：bin/app（单二进制文件，含嵌入前端资源）

# 运行
./bin/app
# 默认监听 :8080，访问 http://localhost:8080
```

### 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `ADMIN_ADDR` | 服务监听地址 | `:8080` |
| `DB_DRIVER` | 数据库驱动（sqlite / pgx） | `sqlite` |
| `DB_DSN` | 数据库连接串 | `var/db/app.sqlite` |

## API 接口

### POST /api/image/generate

创建图像生成任务并轮询至完成。

**请求体：**

```json
{
  "apiEndpoint": "https://mm-accelerate.leonecloud.com",
  "apiKey": "fc_xxx",
  "prompt": "生成一张风景照",
  "genType": "t2i",
  "aspectRatio": "16:9",
  "resolution": "1K",
  "nsfwChecker": true,
  "imageUrls": []
}
```

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `apiEndpoint` | string | 是 | API 基础地址 |
| `apiKey` | string | 是 | 认证 Token |
| `prompt` | string | 是 | 提示词，最长 20,000 字符 |
| `genType` | string | 否 | 生成类型：`t2i`（文生图）/ `i2i`（图生图），默认 `t2i` |
| `aspectRatio` | string | 否 | 宽高比：`auto` / `1:1` / `16:9` / `9:16` / `4:3` / `3:4` / `3:2` / `2:3` / `5:4` / `4:5` / `21:9`，默认 `auto` |
| `resolution` | string | 否 | 分辨率：`1K` / `2K` / `4K`，默认 `1K` |
| `nsfwChecker` | boolean | 否 | 是否开启 NSFW 检测，默认 `true` |
| `imageUrls` | string[] | 否 | 参考图链接列表（i2i 模式使用） |

**成功响应：**

```json
{
  "taskId": "task_20260423103000_abc12345",
  "status": "success",
  "result": [
    "https://fc-gw-sh.oss-accelerate.aliyuncs.com/images/output_001.png"
  ]
}
```

## 项目结构

```
├── cmd/willing/main.go       # 应用入口
├── internal/
│   ├── admin/admin.go        # HTTP 路由 & 图像生成代理
│   ├── config/config.go      # 环境变量配置
│   ├── db/db.go              # 数据库层（GORM）
│   └── models/               # 数据模型
├── web/                      # React 前端 (TypeScript + Vite)
│   └── src/
│       ├── App.tsx           # 根组件
│       ├── pages/
│       │   └── ImageGenerator.tsx  # 图像生成页面
│       └── components/ui/    # UI 组件库
├── webui/                    # 前端构建产物嵌入层
├── Makefile
└── README.md
```

## 技术栈

- **后端**：Go + Gin + GORM
- **前端**：React 19 + TypeScript + Vite
- **样式**：Tailwind CSS + Radix UI + Lucide Icons
- **部署**：单二进制文件，内嵌前端资源

## 轮询策略

后端在创建任务后自动轮询，采用渐进式退避：

| 已等待时间 | 轮询间隔 |
|---|---|
| 0–30 秒 | 3 秒 |
| 30 秒 – 2 分钟 | 5 秒 |
| 2 分钟以上 | 10 秒 |

最长等待 5 分钟超时。
