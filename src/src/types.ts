// ==================== 认证相关类型 ====================

/**
 * OAuth Token响应
 */
export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
}

/**
 * 用户信息
 */
export interface UserInfo {
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Antigravity账号数据
 */
export interface AntigravityAccount {
  id: string;
  email: string;
  name?: string;
  token: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expiry_timestamp: number;
    project_id?: string;
  };
  quota?: QuotaData;
  created_at: string;
  updated_at: string;
}

/**
 * 模型配额信息
 */
export interface ModelQuota {
  name: string;
  percentage: number;
  reset_time: string;
}

/**
 * 配额数据结构
 */
export interface QuotaData {
  models: ModelQuota[];
  last_updated: number;
  is_forbidden: boolean;
  subscription_tier?: string;
}

/**
 * Codex账号数据
 */
export interface CodexAccount {
  id: string;
  email: string;
  token: {
    id_token: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expiry_timestamp: number;
    account_id?: string;
  };
  created_at: string;
  updated_at: string;
}

/**
 * PKCE代码对
 */
export interface PKCECodes {
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * OAuth回调结果
 */
export interface OAuthCallbackResult {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

// ==================== 代理相关类型 ====================

/**
 * 代理请求上下文
 */
export interface ProxyContext {
  model: string;
  stream: boolean;
  originalPayload: unknown;
  translatedPayload: unknown;
}

/**
 * 上游响应
 */
export interface UpstreamResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

/**
 * 模型信息（详细）
 */
export interface ModelInfo {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  object: string;
  created: number;
  owned_by: string;
  type: string;
  maxCompletionTokens?: number;
  thinking?: {
    min: number;
    max: number;
    default: number;
  };
}

/**
 * OpenAI模型格式
 */
export interface Model {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  permission: unknown[];
  root: string;
  parent: string | null;
}

// ==================== 配置相关类型 ====================

/**
 * 应用配置
 */
export interface AppConfig {
  // 服务器配置
  host: string;
  port: number;
  
  // API密钥配置
  apiKeys: string[];
  
  // 数据目录
  dataDir: string;
  authDir: string;
  
  // 代理配置
  upstreamProxy?: {
    enabled: boolean;
    url: string;
  };
  
  // 请求配置
  requestTimeout: number;
  maxRetries: number;
  
  // 远程管理
  remoteManagement?: {
    enabled: boolean;
    secretKey?: string;
  };
  
  // 调试模式
  debug: boolean;
}

/**
 * 账号存储
 */
export interface AccountStore {
  antigravity: Map<string, AntigravityAccount>;
  codex: Map<string, CodexAccount>;
}

// ==================== API相关类型 ====================

/**
 * OpenAI兼容的聊天完成请求
 */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  n?: number;
  user?: string;
  tools?: Tool[];
  tool_choice?: string | { type: "function"; function: { name: string } };
}

/**
 * 工具定义
 */
export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * 聊天消息
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string | ContentPart[] | null;
  reasoning_content?: string | null;
  name?: string;
  function_call?: FunctionCall;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/**
 * 内容部分（支持多模态）
 */
export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
}

/**
 * 函数调用
 */
export interface FunctionCall {
  name: string;
  arguments: string;
}

/**
 * 工具调用
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: FunctionCall;
}

/**
 * OpenAI兼容的聊天完成响应
 */
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: UsageInfo;
}

/**
 * 聊天完成选项
 */
export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: "stop" | "length" | "function_call" | "tool_calls" | "content_filter" | null;
}

/**
 * 使用统计
 */
export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * 流式聊天完成响应
 */
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

/**
 * 流式聊天完成选项
 */
export interface ChatCompletionChunkChoice {
  index: number;
  delta: Partial<ChatMessage>;
  finish_reason: "stop" | "length" | "function_call" | "tool_calls" | "content_filter" | null;
}

// ==================== Gemini API相关类型 ====================

/**
 * Gemini内容
 */
export interface GeminiContent {
  role: "user" | "model" | "function";
  parts: GeminiPart[];
}

/**
 * Gemini部分
 */
export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

/**
 * Antigravity请求
 */
export interface AntigravityRequest {
  model: string;
  project: string;
  requestId: string;
  userAgent: string;
  request: {
    contents: GeminiContent[];
    sessionId?: string;
    generationConfig?: {
      temperature?: number;
      maxOutputTokens?: number;
      topP?: number;
      thinkingConfig?: {
        thinkingBudget?: number;
        thinkingLevel?: string;
      };
    };
    safetySettings?: Array<{
      category: string;
      threshold: string;
    }>;
    tools?: Array<{
      functionDeclarations?: Array<{
        name: string;
        description: string;
        parameters?: Record<string, unknown>;
        parametersJsonSchema?: Record<string, unknown>;
      }>;
    }>;
    toolConfig?: {
      functionCallingConfig?: {
        mode: string;
        allowedFunctionNames?: string[];
      };
    };
  };
}

/**
 * Antigravity响应
 */
export interface AntigravityResponse {
  response: {
    candidates: Array<{
      content: GeminiContent;
      finishReason: string;
    }>;
    usageMetadata?: {
      promptTokenCount: number;
      candidatesTokenCount: number;
      totalTokenCount: number;
    };
    modelVersion?: string;
    responseId?: string;
  };
  traceId?: string;
}