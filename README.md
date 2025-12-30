# Antigravity Deno API

一个基于 Deno 的 Web API 代理服务，支持 Antigravity 和 Codex 账号管理与 API 转发。

## 功能特性

- 🔐 **OAuth 授权管理**：支持 Antigravity (Google) 和 Codex (OpenAI) OAuth 登录
- 🔄 **Token 轮换**：自动 Token 轮换和刷新机制
- 🌐 **OpenAI 兼容 API**：提供标准的 `/v1/chat/completions` 接口
- 📡 **流式响应**：支持 SSE 流式输出
- 🛠️ **管理端 API**：账号管理、状态查询等
- 🤖 **多平台支持**：同时支持 Antigravity (Gemini) 和 Codex (OpenAI) 模型

## 快速开始

### 环境要求

- [Deno](https://deno.land/) v1.40+

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd antigravity-deno

# 安装依赖（可选，Deno 会自动安装）
deno cache src/main.ts
```

### 运行

```bash
# 开发模式（热重载）
deno task dev

# 生产模式
deno task start
```

### 配置

通过环境变量配置：

```bash
# 服务器配置
export HOST=0.0.0.0
export PORT=8080

# API 密钥（多个用逗号分隔）
export API_KEYS=sk-key1,sk-key2

# 数据目录
export DATA_DIR=./data

# 调试模式
export DEBUG=true

# 管理密钥（可选）
export MANAGEMENT_SECRET_KEY=your-secret-key

# 上游代理（可选）
export PROXY_URL=http://proxy:8080
```

或使用配置文件：

```bash
deno task start --config=./config.json
```

## API 端点

### OpenAI 兼容 API

#### 聊天完成

```bash
# 使用 Antigravity (Gemini) 模型
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key" \
  -d '{
    "model": "gemini-3-pro-preview",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": false
  }'

# 使用 Codex (OpenAI) 模型
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key" \
  -d '{
    "model": "gpt-5.2-codex",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": false
  }'

# 使用带有 reasoning effort 的 Codex 模型
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key" \
  -d '{
    "model": "gpt-5.2(high)",
    "messages": [
      {"role": "user", "content": "Solve this complex problem..."}
    ]
  }'
```

#### 模型列表

```bash
curl http://localhost:8080/v1/models \
  -H "Authorization: Bearer sk-your-api-key"
```

### 管理端 API

#### 查看状态

```bash
curl http://localhost:8080/manage/status \
  -H "X-Management-Key: your-secret-key"
```

#### 获取账号列表

```bash
curl http://localhost:8080/manage/accounts \
  -H "X-Management-Key: your-secret-key"
```

#### 获取 Antigravity 登录 URL

```bash
curl http://localhost:8080/manage/auth/antigravity/login \
  -H "X-Management-Key: your-secret-key"
```

#### Antigravity OAuth 回调

```bash
curl "http://localhost:8080/manage/auth/antigravity/callback?code=auth_code&state=state" \
  -H "X-Management-Key: your-secret-key"
```

#### 获取 Codex 登录 URL

```bash
curl http://localhost:8080/manage/auth/codex/login \
  -H "X-Management-Key: your-secret-key"
```

#### Codex OAuth 回调

```bash
curl -X POST http://localhost:8080/manage/auth/codex/callback \
  -H "Content-Type: application/json" \
  -H "X-Management-Key: your-secret-key" \
  -d '{
    "code": "auth_code",
    "codeVerifier": "pkce_code_verifier"
  }'
```

#### 刷新所有 Token

```bash
curl -X POST http://localhost:8080/manage/refresh-tokens \
  -H "X-Management-Key: your-secret-key"
```

## 支持的模型

系统根据请求的模型名称自动路由到相应的后端（Antigravity 或 Codex）。

### Antigravity 模型 (Gemini)

| 模型 ID | 描述 | Thinking 支持 |
|---------|------|---------------|
| gemini-2.5-flash | Gemini 2.5 Flash | Budget: 0-24576 |
| gemini-2.5-flash-lite | Gemini 2.5 Flash Lite | Budget: 0-24576 |
| gemini-2.5-pro | Gemini 2.5 Pro | Budget: 128-32768 |
| gemini-2.5-computer-use-preview-10-2025 | Computer Use Preview | - |
| gemini-3-pro-preview | Gemini 3 Pro Preview | Levels: low, high |
| gemini-3-pro-image-preview | Gemini 3 Pro Image Preview | Levels: low, high |
| gemini-3-flash-preview | Gemini 3 Flash Preview | Levels: minimal, low, medium, high |
| gemini-claude-sonnet-4-5 | Claude 4.5 Sonnet (via Gemini) | - |
| gemini-claude-sonnet-4-5-thinking | Claude 4.5 Sonnet Thinking | Budget: 1024-200000 |
| gemini-claude-opus-4-5-thinking | Claude 4.5 Opus Thinking | Budget: 1024-200000 |

### Codex 模型 (OpenAI)

| 模型 ID | 描述 | Reasoning Levels |
|---------|------|------------------|
| gpt-5 | GPT 5 | minimal, low, medium, high |
| gpt-5-codex | GPT 5 Codex | low, medium, high |
| gpt-5-codex-mini | GPT 5 Codex Mini | low, medium, high |
| gpt-5.1 | GPT 5.1 | none, low, medium, high |
| gpt-5.1-codex | GPT 5.1 Codex | low, medium, high |
| gpt-5.1-codex-mini | GPT 5.1 Codex Mini | low, medium, high |
| gpt-5.1-codex-max | GPT 5.1 Codex Max | low, medium, high, xhigh |
| gpt-5.2 | GPT 5.2 | none, low, medium, high, xhigh |
| gpt-5.2-codex | GPT 5.2 Codex | low, medium, high, xhigh |

#### Codex Reasoning Effort

Codex 模型支持通过后缀指定 reasoning effort：

```
gpt-5.2(high)      # 高推理能力
gpt-5.2-codex(xhigh)  # 最高推理能力
gpt-5.1(low)       # 低推理开销
```

## 项目结构

```
src/
├── main.ts              # 主入口文件
├── types.ts             # 类型定义
├── config.ts            # 配置管理（含模型定义）
├── auth/                # 认证模块
│   ├── antigravity.ts   # Antigravity OAuth
│   ├── codex.ts         # Codex OAuth
│   ├── store.ts         # 账号存储
│   ├── token_manager.ts # Token 管理器
│   └── index.ts         # 模块导出
├── proxy/               # 代理模块
│   ├── handler.ts       # Antigravity 请求处理器
│   ├── codex_handler.ts # Codex 请求处理器
│   ├── translator.ts    # 协议转换（OpenAI <-> Gemini）
│   ├── upstream.ts      # 上游客户端
│   └── index.ts         # 模块导出
├── routes/              # 路由模块
│   ├── api.ts           # OpenAI API 路由（自动路由到 Antigravity/Codex）
│   ├── management.ts    # 管理端路由
│   └── index.ts         # 模块导出
└── utils/               # 工具模块
    ├── crypto.ts        # 加密工具（PKCE、UUID）
    ├── http.ts          # HTTP 工具
    └── index.ts         # 模块导出
```

### 模型路由逻辑

系统根据模型名称自动路由：

- **Codex 模型**：以 `gpt-5` 开头的模型 → 路由到 OpenAI Codex API
- **Antigravity 模型**：以 `gemini-` 开头或包含 `claude` 的模型 → 路由到 Antigravity API
- **未知模型**：默认路由到 Antigravity

## 开发

```bash
# 类型检查
deno task check

# 代码格式化
deno task fmt

# 代码检查
deno task lint

# 运行测试
deno task test
```

## 平台部署

### Deno Deploy

1. 在 [Deno Deploy](https://deno.com/deploy) 创建新项目
2. 连接 GitHub 仓库或使用 `deployctl` 部署
3. 在项目设置中添加环境变量：

| 环境变量 | 必需 | 说明 |
|---------|------|------|
| `PORT` | 否 | 端口（Deno Deploy 自动设置） |
| `API_KEYS` | 否 | API 密钥，多个用逗号分隔 |
| `MANAGEMENT_SECRET_KEY` | 是 | 管理端密钥 |
| `DEBUG` | 否 | 调试模式 (true/false) |

**注意**: Deno Deploy 不支持文件系统写入，账号数据需要使用外部存储（如 Deno KV）。

### Railway

1. 在 [Railway](https://railway.app) 创建新项目
2. 连接 GitHub 仓库
3. 在 Variables 中添加环境变量：

```
HOST=0.0.0.0
PORT=8080
API_KEYS=sk-your-key
MANAGEMENT_SECRET_KEY=your-secret
DATA_DIR=/app/data
DEBUG=false
```

### Render

1. 在 [Render](https://render.com) 创建新 Web Service
2. 选择 Deno 环境
3. 设置构建命令：`deno cache src/main.ts`
4. 设置启动命令：`deno run --allow-net --allow-read --allow-write --allow-env src/main.ts`
5. 在 Environment 中添加环境变量

### Fly.io

1. 安装 flyctl
2. 创建 `fly.toml`：

```toml
app = "antigravity-api"
primary_region = "hkg"

[build]
  builder = "paketobuildpacks/builder:base"

[env]
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_start_machines = true
  auto_stop_machines = true
  min_machines_running = 0

[[services]]
  http_checks = []
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    port = 80
    handlers = ["http"]

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
```

3. 创建 Dockerfile：

```dockerfile
FROM denoland/deno:1.40.0

WORKDIR /app
COPY . .

RUN deno cache src/main.ts

EXPOSE 8080

CMD ["run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "src/main.ts"]
```

4. 部署并设置 secrets：

```bash
flyctl launch
flyctl secrets set API_KEYS=sk-your-key
flyctl secrets set MANAGEMENT_SECRET_KEY=your-secret
```

### Docker 部署

1. 创建 Dockerfile（如上所示）
2. 构建并运行：

```bash
docker build -t antigravity-api .
docker run -d \
  -p 8080:8080 \
  -e API_KEYS=sk-your-key \
  -e MANAGEMENT_SECRET_KEY=your-secret \
  -v ./data:/app/data \
  antigravity-api
```

### Docker Compose

```yaml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      - HOST=0.0.0.0
      - PORT=8080
      - API_KEYS=sk-your-key
      - MANAGEMENT_SECRET_KEY=your-secret
      - DEBUG=false
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

## 环境变量说明

| 变量名 | 默认值 | 说明 |
|-------|--------|------|
| `HOST` | `0.0.0.0` | 服务器监听地址 |
| `PORT` | `8080` | 服务器监听端口 |
| `API_KEYS` | - | API 密钥，多个用逗号分隔 |
| `DATA_DIR` | `./data` | 数据存储目录 |
| `MANAGEMENT_SECRET_KEY` | - | 管理端访问密钥 |
| `PROXY_URL` | - | 上游代理地址 |
| `DEBUG` | `false` | 调试模式 |

## 参考项目

本项目参考了以下开源项目：

- [Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) - 本地反代理实现
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) - 远程部署多平台中转

## 许可证

MIT License