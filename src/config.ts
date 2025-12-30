import type { AppConfig } from "./types.ts";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: AppConfig = {
  host: "0.0.0.0",
  port: 8080,
  apiKeys: [],
  dataDir: "./data",
  authDir: "./data/accounts",
  requestTimeout: 300,
  maxRetries: 3,
  debug: false,
};

// ==================== OAuth配置 ====================

/**
 * Antigravity OAuth配置
 */
export const ANTIGRAVITY_OAUTH = {
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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",
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
  ],
  callbackPort: 51121,
} as const;

/**
 * Codex OAuth配置
 */
export const CODEX_OAUTH = {
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  redirectUri: "http://localhost:1455/auth/callback",
  scopes: ["openid", "email", "profile", "offline_access"],
  callbackPort: 1455,
} as const;

// ==================== API端点配置 ====================

/**
 * Antigravity API端点
 */
export const ANTIGRAVITY_API = {
  baseUrls: [
    "https://daily-cloudcode-pa.googleapis.com",
    "https://daily-cloudcode-pa.sandbox.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ],
  paths: {
    loadCodeAssist: "/v1internal:loadCodeAssist",
    generateContent: "/v1internal:generateContent",
    streamGenerateContent: "/v1internal:streamGenerateContent",
    fetchAvailableModels: "/v1internal:fetchAvailableModels",
    countTokens: "/v1internal:countTokens",
  },
  userAgent: "antigravity/1.104.0 darwin/arm64",
} as const;

/**
 * Codex API端点
 */
export const CODEX_API = {
  baseUrl: "https://api.openai.com",
  paths: {
    completions: "/v1/completions",
    chatCompletions: "/v1/chat/completions",
    responses: "/v1/responses",
    models: "/v1/models",
  },
} as const;

// ==================== 配置管理类 ====================

let _config: AppConfig | null = null;

/**
 * 加载配置
 */
export async function loadConfig(configPath?: string): Promise<AppConfig> {
  let config = { ...DEFAULT_CONFIG };

  // 从环境变量加载
  const envHost = Deno.env.get("HOST");
  const envPort = Deno.env.get("PORT");
  const envApiKeys = Deno.env.get("API_KEYS");
  const envDataDir = Deno.env.get("DATA_DIR");
  const envDebug = Deno.env.get("DEBUG");
  const envProxyUrl = Deno.env.get("PROXY_URL");
  const envManagementKey = Deno.env.get("MANAGEMENT_SECRET_KEY");

  if (envHost) config.host = envHost;
  if (envPort) config.port = parseInt(envPort, 10);
  if (envApiKeys) config.apiKeys = envApiKeys.split(",").map((k) => k.trim());
  if (envDataDir) {
    config.dataDir = envDataDir;
    config.authDir = join(envDataDir, "accounts");
  }
  if (envDebug === "true" || envDebug === "1") config.debug = true;
  if (envProxyUrl) {
    config.upstreamProxy = {
      enabled: true,
      url: envProxyUrl,
    };
  }
  if (envManagementKey) {
    config.remoteManagement = {
      enabled: true,
      secretKey: envManagementKey,
    };
  }

  // 从配置文件加载（如果存在）
  if (configPath) {
    try {
      const configText = await Deno.readTextFile(configPath);
      const fileConfig = JSON.parse(configText);
      config = { ...config, ...fileConfig };
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.error(`配置文件加载失败: ${error}`);
      }
    }
  }

  // 确保目录存在
  await ensureDir(config.dataDir);
  await ensureDir(config.authDir);

  _config = config;
  return config;
}

/**
 * 获取当前配置
 */
export function getConfig(): AppConfig {
  if (!_config) {
    throw new Error("配置未初始化，请先调用 loadConfig()");
  }
  return _config;
}

/**
 * 保存配置
 */
export async function saveConfig(config: AppConfig, configPath: string): Promise<void> {
  await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2));
  _config = config;
}

/**
 * 模型名称映射（上游 -> 别名）- Antigravity
 */
export const MODEL_ALIASES: Record<string, string> = {
  "rev19-uic3-1p": "gemini-2.5-computer-use-preview-10-2025",
  "gemini-3-pro-image": "gemini-3-pro-image-preview",
  "gemini-3-pro-high": "gemini-3-pro-preview",
  "gemini-3-flash": "gemini-3-flash-preview",
  "claude-sonnet-4-5": "gemini-claude-sonnet-4-5",
  "claude-sonnet-4-5-thinking": "gemini-claude-sonnet-4-5-thinking",
  "claude-opus-4-5-thinking": "gemini-claude-opus-4-5-thinking",
};

/**
 * 模型名称反向映射（别名 -> 上游）- Antigravity
 */
export const MODEL_NAMES: Record<string, string> = {
  "gemini-2.5-computer-use-preview-10-2025": "rev19-uic3-1p",
  "gemini-3-pro-image-preview": "gemini-3-pro-image",
  "gemini-3-pro-preview": "gemini-3-pro-high",
  "gemini-3-flash-preview": "gemini-3-flash",
  "gemini-claude-sonnet-4-5": "claude-sonnet-4-5",
  "gemini-claude-sonnet-4-5-thinking": "claude-sonnet-4-5-thinking",
  "gemini-claude-opus-4-5-thinking": "claude-opus-4-5-thinking",
};

// ==================== Codex 模型定义 ====================

/**
 * Codex (OpenAI) 支持的模型列表
 */
export interface CodexModel {
  id: string;
  displayName: string;
  description: string;
  contextLength: number;
  maxCompletionTokens: number;
  thinkingLevels?: string[];
}

/**
 * Codex 模型定义
 */
export const CODEX_MODELS: CodexModel[] = [
  {
    id: "gpt-5",
    displayName: "GPT 5",
    description: "Stable version of GPT 5, The best model for coding and agentic tasks across domains.",
    contextLength: 400000,
    maxCompletionTokens: 128000,
    thinkingLevels: ["minimal", "low", "medium", "high"],
  },
  {
    id: "gpt-5-codex",
    displayName: "GPT 5 Codex",
    description: "Stable version of GPT 5 Codex, The best model for coding and agentic tasks across domains.",
    contextLength: 400000,
    maxCompletionTokens: 128000,
    thinkingLevels: ["low", "medium", "high"],
  },
  {
    id: "gpt-5-codex-mini",
    displayName: "GPT 5 Codex Mini",
    description: "Stable version of GPT 5 Codex Mini: cheaper, faster, but less capable version of GPT 5 Codex.",
    contextLength: 400000,
    maxCompletionTokens: 128000,
    thinkingLevels: ["low", "medium", "high"],
  },
  {
    id: "gpt-5.1",
    displayName: "GPT 5.1",
    description: "Stable version of GPT 5.1, The best model for coding and agentic tasks across domains.",
    contextLength: 400000,
    maxCompletionTokens: 128000,
    thinkingLevels: ["none", "low", "medium", "high"],
  },
  {
    id: "gpt-5.1-codex",
    displayName: "GPT 5.1 Codex",
    description: "Stable version of GPT 5.1 Codex, The best model for coding and agentic tasks across domains.",
    contextLength: 400000,
    maxCompletionTokens: 128000,
    thinkingLevels: ["low", "medium", "high"],
  },
  {
    id: "gpt-5.1-codex-mini",
    displayName: "GPT 5.1 Codex Mini",
    description: "Stable version of GPT 5.1 Codex Mini: cheaper, faster, but less capable version of GPT 5.1 Codex.",
    contextLength: 400000,
    maxCompletionTokens: 128000,
    thinkingLevels: ["low", "medium", "high"],
  },
  {
    id: "gpt-5.1-codex-max",
    displayName: "GPT 5.1 Codex Max",
    description: "Stable version of GPT 5.1 Codex Max",
    contextLength: 400000,
    maxCompletionTokens: 128000,
    thinkingLevels: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "gpt-5.2",
    displayName: "GPT 5.2",
    description: "Stable version of GPT 5.2",
    contextLength: 400000,
    maxCompletionTokens: 128000,
    thinkingLevels: ["none", "low", "medium", "high", "xhigh"],
  },
  {
    id: "gpt-5.2-codex",
    displayName: "GPT 5.2 Codex",
    description: "Stable version of GPT 5.2 Codex, The best model for coding and agentic tasks across domains.",
    contextLength: 400000,
    maxCompletionTokens: 128000,
    thinkingLevels: ["low", "medium", "high", "xhigh"],
  },
];

/**
 * Antigravity (Gemini) 支持的模型列表
 */
export interface AntigravityModel {
  id: string;
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  thinkingBudgetMin?: number;
  thinkingBudgetMax?: number;
  thinkingLevels?: string[];
}

/**
 * Antigravity 模型定义
 */
export const ANTIGRAVITY_MODELS: AntigravityModel[] = [
  {
    id: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    description: "Stable version of Gemini 2.5 Flash",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinkingBudgetMin: 0,
    thinkingBudgetMax: 24576,
  },
  {
    id: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash Lite",
    description: "Our smallest and most cost effective model",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinkingBudgetMin: 0,
    thinkingBudgetMax: 24576,
  },
  {
    id: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    description: "Stable release of Gemini 2.5 Pro",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinkingBudgetMin: 128,
    thinkingBudgetMax: 32768,
  },
  {
    id: "gemini-2.5-computer-use-preview-10-2025",
    displayName: "Gemini 2.5 Computer Use Preview",
    description: "Computer use preview model",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    id: "gemini-3-pro-preview",
    displayName: "Gemini 3 Pro Preview",
    description: "Most intelligent model with SOTA reasoning and multimodal understanding",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinkingLevels: ["low", "high"],
  },
  {
    id: "gemini-3-pro-image-preview",
    displayName: "Gemini 3 Pro Image Preview",
    description: "Gemini 3 Pro Image Preview",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinkingLevels: ["low", "high"],
  },
  {
    id: "gemini-3-flash-preview",
    displayName: "Gemini 3 Flash Preview",
    description: "Most intelligent model built for speed",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    thinkingLevels: ["minimal", "low", "medium", "high"],
  },
  {
    id: "gemini-claude-sonnet-4-5",
    displayName: "Claude 4.5 Sonnet (via Gemini)",
    description: "Claude 4.5 Sonnet accessed via Antigravity",
  },
  {
    id: "gemini-claude-sonnet-4-5-thinking",
    displayName: "Claude 4.5 Sonnet Thinking (via Gemini)",
    description: "Claude 4.5 Sonnet with extended thinking",
    thinkingBudgetMin: 1024,
    thinkingBudgetMax: 200000,
  },
  {
    id: "gemini-claude-opus-4-5-thinking",
    displayName: "Claude 4.5 Opus Thinking (via Gemini)",
    description: "Claude 4.5 Opus with extended thinking",
    thinkingBudgetMin: 1024,
    thinkingBudgetMax: 200000,
  },
];

/**
 * 检查模型是否为 Codex 模型
 */
export function isCodexModel(modelId: string): boolean {
  // 提取基础模型名（去除 thinking level 后缀如 "(high)"）
  const baseModel = modelId.replace(/\([^)]+\)$/, "").trim();
  return CODEX_MODELS.some((m) => m.id === baseModel || baseModel.startsWith("gpt-5"));
}

/**
 * 检查模型是否为 Antigravity 模型
 */
export function isAntigravityModel(modelId: string): boolean {
  const baseModel = modelId.replace(/\([^)]+\)$/, "").trim();
  return (
    ANTIGRAVITY_MODELS.some((m) => m.id === baseModel) ||
    baseModel.startsWith("gemini-") ||
    baseModel.includes("claude")
  );
}

/**
 * 获取模型别名
 */
export function getModelAlias(modelName: string): string {
  return MODEL_ALIASES[modelName] || modelName;
}

/**
 * 获取上游模型名称
 */
export function getUpstreamModelName(alias: string): string {
  return MODEL_NAMES[alias] || alias;
}

/**
 * 获取所有支持的模型列表（OpenAI 格式）
 */
export function getAllModels(): Array<{
  id: string;
  object: string;
  created: number;
  owned_by: string;
}> {
  const models: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }> = [];

  // 添加 Antigravity 模型
  for (const model of ANTIGRAVITY_MODELS) {
    models.push({
      id: model.id,
      object: "model",
      created: 1700000000,
      owned_by: "google",
    });
  }

  // 添加 Codex 模型
  for (const model of CODEX_MODELS) {
    models.push({
      id: model.id,
      object: "model",
      created: 1700000000,
      owned_by: "openai",
    });
  }

  return models;
}