import { Hono } from "hono";
import type { ChatCompletionRequest, Model } from "../types.ts";
import { TokenManager } from "../auth/token_manager.ts";
import { AntigravityProxyHandler } from "../proxy/handler.ts";
import { CodexProxyHandler } from "../proxy/codex_handler.ts";
import {
  getConfig,
  MODEL_ALIASES,
  getModelAlias,
  isCodexModel,
  isAntigravityModel,
  getAllModels,
  CODEX_MODELS,
  ANTIGRAVITY_MODELS,
} from "../config.ts";
import { errorResponse, jsonResponse, log } from "../utils/http.ts";
import { fetchQuota } from "../auth/quota.ts";

/**
 * 创建API路由
 */
export function createApiRoutes(tokenManager: TokenManager): Hono {
  const app = new Hono();
  const antigravityHandler = new AntigravityProxyHandler(tokenManager);
  const codexHandler = new CodexProxyHandler(tokenManager);

  // ==================== OpenAI兼容API ====================

  /**
   * 聊天完成接口
   * 根据模型自动路由到 Antigravity 或 Codex
   */
  app.post("/v1/chat/completions", async (c) => {
    try {
      // API Key验证
      const authHeader = c.req.header("Authorization");
      if (!validateApiKey(authHeader)) {
        return errorResponse(401, "Invalid API key");
      }

      const body = await c.req.json() as ChatCompletionRequest;
      const model = body.model;
      
      log("info", `Chat completion request: model=${model}, stream=${body.stream}`);

      // 根据模型选择处理器
      let response: Response;
      
      if (isCodexModel(model)) {
        log("info", `Routing to Codex handler for model: ${model}`);
        response = await codexHandler.handleChatCompletion(body);
      } else if (isAntigravityModel(model)) {
        log("info", `Routing to Antigravity handler for model: ${model}`);
        response = await antigravityHandler.handleChatCompletion(body);
      } else {
        // 默认使用 Antigravity
        log("info", `Unknown model ${model}, defaulting to Antigravity handler`);
        response = await antigravityHandler.handleChatCompletion(body);
      }
      
      // 复制response headers
      for (const [key, value] of response.headers.entries()) {
        c.header(key, value);
      }
      
      return response;
    } catch (error) {
      log("error", `Chat completion error: ${error}`);
      return errorResponse(500, `Internal server error: ${error}`);
    }
  });

  /**
   * 模型列表接口
   */
  app.get("/v1/models", async (c) => {
    try {
      const authHeader = c.req.header("Authorization");
      if (!validateApiKey(authHeader)) {
        return errorResponse(401, "Invalid API key");
      }

      // 获取所有支持的模型
      const allModels = getAllModels();
      
      // 转换为 OpenAI 格式
      const models: Model[] = allModels.map((m) => ({
        id: m.id,
        object: "model",
        created: m.created,
        owned_by: m.owned_by,
        permission: [],
        root: m.id,
        parent: null,
      }));

      return jsonResponse({
        object: "list",
        data: models,
      });
    } catch (error) {
      log("error", `Models list error: ${error}`);
      return errorResponse(500, `Internal server error: ${error}`);
    }
  });

  /**
   * 单个模型信息
   */
  app.get("/v1/models/:model", async (c) => {
    try {
      const authHeader = c.req.header("Authorization");
      if (!validateApiKey(authHeader)) {
        return errorResponse(401, "Invalid API key");
      }

      const modelId = c.req.param("model");
      
      // 在所有模型中查找
      const codexModel = CODEX_MODELS.find((m) => m.id === modelId);
      const antigravityModel = ANTIGRAVITY_MODELS.find((m) => m.id === modelId);
      
      // 也检查别名
      const aliasMatch = Object.keys(MODEL_ALIASES).find(
        (k) => MODEL_ALIASES[k] === modelId || k === modelId
      );

      if (!codexModel && !antigravityModel && !aliasMatch) {
        return errorResponse(404, `Model ${modelId} not found`);
      }

      let model: Model;
      
      if (codexModel) {
        model = {
          id: codexModel.id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "openai",
          permission: [],
          root: codexModel.id,
          parent: null,
        };
      } else if (antigravityModel) {
        model = {
          id: antigravityModel.id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "google",
          permission: [],
          root: antigravityModel.id,
          parent: null,
        };
      } else {
        model = {
          id: getModelAlias(aliasMatch!),
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "antigravity",
          permission: [],
          root: aliasMatch!,
          parent: null,
        };
      }

      return jsonResponse(model);
    } catch (error) {
      log("error", `Model info error: ${error}`);
      return errorResponse(500, `Internal server error: ${error}`);
    }
  });

  // ==================== 配额管理 API ====================

  /**
   * 获取单个账号配额
   */
  app.post("/api/antigravity/quota/:id", async (c) => {
    const id = c.req.param("id");
    const storage = tokenManager.getAccountStorage();
    const account = storage.getAntigravityAccount(id);
    
    if (!account) {
      return errorResponse(404, "Account not found");
    }

    try {
      const { quota, projectId } = await fetchQuota(account.token.access_token, account.email);
      
      // 更新账号信息
      account.quota = quota;
      if (projectId) {
        account.token.project_id = projectId;
      }
      await storage.saveAntigravityAccount(account);

      return jsonResponse({
        success: true,
        data: quota
      });
    } catch (error) {
      log("error", `Failed to fetch quota for ${account.email}: ${error}`);
      return errorResponse(500, `Failed to fetch quota: ${error}`);
    }
  });

  /**
   * 批量获取所有账号配额
   */
  app.get("/api/antigravity/quota/all", async (c) => {
    const storage = tokenManager.getAccountStorage();
    const accounts = storage.getAllAntigravityAccounts();
    
    // 限制并发数量，避免触发速率限制
    const CONCURRENCY = 5;
    const results: Record<string, any> = {};
    
    log("info", `Batch fetching quota for ${accounts.length} accounts`);

    for (let i = 0; i < accounts.length; i += CONCURRENCY) {
      const chunk = accounts.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (account) => {
        try {
          const { quota, projectId } = await fetchQuota(account.token.access_token, account.email);
          account.quota = quota;
          if (projectId) {
            account.token.project_id = projectId;
          }
          await storage.saveAntigravityAccount(account);
          results[account.id] = { success: true, data: quota };
        } catch (error) {
          log("warn", `Failed to fetch quota for ${account.email}: ${error}`);
          results[account.id] = { success: false, error: String(error) };
        }
      }));
    }

    return jsonResponse({
      success: true,
      data: results
    });
  });

  // ==================== 健康检查 ====================

  app.get("/health", (c) => {
    return jsonResponse({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/", (c) => {
    return jsonResponse({
      name: "Antigravity Deno API",
      version: "1.0.0",
      description: "OpenAI-compatible API proxy for Antigravity and Codex",
      endpoints: {
        chat: "/v1/chat/completions",
        models: "/v1/models",
        health: "/health",
        management: "/manage/*",
      },
      supported_providers: ["antigravity", "codex"],
    });
  });

  return app;
}

/**
 * 验证API Key
 */
function validateApiKey(authHeader: string | undefined): boolean {
  const config = getConfig();
  
  // 如果没有配置API Key，则不验证
  if (!config.apiKeys || config.apiKeys.length === 0) {
    return true;
  }

  if (!authHeader) {
    return false;
  }

  // 支持 Bearer token 和直接 API Key
  let key = authHeader;
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    key = authHeader.slice(7);
  }

  return config.apiKeys.includes(key);
}