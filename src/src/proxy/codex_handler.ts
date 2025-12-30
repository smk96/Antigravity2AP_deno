import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from "../types.ts";
import { TokenManager } from "../auth/token_manager.ts";
import { log, errorResponse, jsonResponse } from "../utils/http.ts";
import { generateUUID } from "../utils/crypto.ts";
import { getConfig, CODEX_API } from "../config.ts";

// 简单的logger封装
const logger = {
  info: (msg: string) => log("info", `[codex-handler] ${msg}`),
  debug: (msg: string) => log("debug", `[codex-handler] ${msg}`),
  error: (msg: string) => log("error", `[codex-handler] ${msg}`),
};

/**
 * Codex 上游错误
 */
export class CodexUpstreamError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public responseBody?: string
  ) {
    super(message);
    this.name = "CodexUpstreamError";
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRetryable(): boolean {
    return this.statusCode >= 500 || this.statusCode === 429;
  }
}

/**
 * 解析 reasoning effort 后缀
 * 例如: "gpt-5(high)" -> { model: "gpt-5", effort: "high" }
 */
function parseModelWithEffort(modelId: string): { model: string; effort?: string } {
  const match = modelId.match(/^(.+?)\((\w+)\)$/);
  if (match) {
    return { model: match[1], effort: match[2] };
  }
  return { model: modelId };
}

/**
 * 转换请求为 Codex 格式
 */
function translateToCodexRequest(
  request: ChatCompletionRequest
): Record<string, unknown> {
  const { model: rawModel, messages, stream, ...rest } = request;
  
  // 解析模型和 reasoning effort
  const { model, effort } = parseModelWithEffort(rawModel);

  const codexRequest: Record<string, unknown> = {
    model,
    messages,
    stream: stream || false,
    ...rest,
  };

  // 如果有 reasoning effort，添加到请求中
  if (effort) {
    codexRequest.reasoning = { effort };
  }

  return codexRequest;
}

/**
 * Codex代理处理器
 */
export class CodexProxyHandler {
  private tokenManager: TokenManager;
  private maxRetries: number;

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
    this.maxRetries = getConfig().maxRetries || 3;
  }

  /**
   * 处理聊天完成请求
   */
  async handleChatCompletion(request: ChatCompletionRequest): Promise<Response> {
    try {
      // 验证请求
      if (!request.messages || request.messages.length === 0) {
        return errorResponse(400, "messages is required");
      }

      if (request.stream) {
        return await this.handleStreamingRequest(request);
      } else {
        return await this.handleNonStreamingRequest(request);
      }
    } catch (error) {
      logger.error(`Chat completion error: ${error}`);
      
      if (error instanceof CodexUpstreamError) {
        return errorResponse(
          error.statusCode,
          error.message,
          "upstream_error"
        );
      }
      
      return errorResponse(500, `Internal server error: ${error}`);
    }
  }

  /**
   * 处理非流式请求
   */
  private async handleNonStreamingRequest(
    request: ChatCompletionRequest
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let retry = 0; retry < this.maxRetries; retry++) {
      try {
        // 获取 Codex token
        const tokenInfo = await this.tokenManager.getCodexToken(retry > 0);
        
        logger.info(`Using Codex account: ${tokenInfo.email} (attempt ${retry + 1})`);

        // 转换请求
        const codexRequest = translateToCodexRequest(request);

        // 发送请求到 Codex API
        const response = await this.sendRequest(
          `${CODEX_API.baseUrl}${CODEX_API.paths.responses}`,
          codexRequest,
          tokenInfo.accessToken,
          false,
          tokenInfo.account.token.account_id
        );

        // 解析响应
        const responseData = await response.json();
        
        // 转换为 OpenAI 格式
        const openaiResponse = this.translateFromCodex(responseData, request.model);
        
        return jsonResponse(openaiResponse);
      } catch (error) {
        lastError = error as Error;
        logger.error(`Attempt ${retry + 1} failed: ${error}`);

        // 如果是认证错误，标记账号失败并尝试下一个
        if (error instanceof CodexUpstreamError && error.isAuthError()) {
          const tokenInfo = await this.tokenManager.getCodexToken(false).catch(() => null);
          if (tokenInfo) {
            this.tokenManager.markCodexAccountFailed(tokenInfo.account.id);
            logger.info(`Marked Codex account as failed: ${tokenInfo.email}`);
          }
        }

        // 如果不是可重试的错误，直接抛出
        if (error instanceof CodexUpstreamError && !error.isRetryable() && !error.isAuthError()) {
          throw error;
        }
      }
    }

    throw lastError || new Error("Request failed after all retries");
  }

  /**
   * 处理流式请求
   */
  private async handleStreamingRequest(
    request: ChatCompletionRequest
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let retry = 0; retry < this.maxRetries; retry++) {
      try {
        // 获取 Codex token
        const tokenInfo = await this.tokenManager.getCodexToken(retry > 0);
        
        logger.info(`Streaming with Codex account: ${tokenInfo.email} (attempt ${retry + 1})`);

        // 转换请求
        const codexRequest = translateToCodexRequest(request);

        // 发送流式请求
        const response = await this.sendRequest(
          `${CODEX_API.baseUrl}${CODEX_API.paths.responses}`,
          codexRequest,
          tokenInfo.accessToken,
          true,
          tokenInfo.account.token.account_id
        );

        // 直接转发流式响应
        return new Response(response.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      } catch (error) {
        lastError = error as Error;
        logger.error(`Streaming attempt ${retry + 1} failed: ${error}`);

        if (error instanceof CodexUpstreamError && !error.isRetryable() && !error.isAuthError()) {
          throw error;
        }
      }
    }

    throw lastError || new Error("Streaming request failed after all retries");
  }

  /**
   * 发送请求到 Codex API
   */
  private async sendRequest(
    url: string,
    body: Record<string, unknown>,
    accessToken: string,
    stream: boolean,
    accountId?: string
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "User-Agent": "codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464",
      "Version": "0.21.0",
      "Openai-Beta": "responses=experimental",
      "Session_id": generateUUID(),
      "Originator": "codex_cli_rs",
      "Accept": "text/event-stream",
      "Connection": "Keep-Alive",
    };

    if (accountId) {
      headers["Chatgpt-Account-Id"] = accountId;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new CodexUpstreamError(
        response.status,
        `Codex API error: ${response.statusText}`,
        errorBody
      );
    }

    return response;
  }

  /**
   * 将 Codex 响应转换为 OpenAI 格式
   */
  private translateFromCodex(
    response: Record<string, unknown>,
    model: string
  ): ChatCompletionResponse {
    const id = (response.id as string) || `chatcmpl-${generateUUID()}`;
    const created = (response.created as number) || Math.floor(Date.now() / 1000);

    // Codex 响应格式与 OpenAI 类似，但可能需要一些转换
    const output = response.output as Array<{
      type: string;
      content?: Array<{ type: string; text?: string }>;
      text?: string;
    }> || [];

    let content = "";
    for (const item of output) {
      if (item.type === "message" && item.content) {
        for (const contentItem of item.content) {
          if (contentItem.type === "output_text" && contentItem.text) {
            content += contentItem.text;
          }
        }
      } else if (item.type === "text" && item.text) {
        content += item.text;
      }
    }

    // 如果没有找到内容，尝试其他格式
    if (!content && response.choices) {
      const choices = response.choices as Array<{
        message?: { content?: string };
        delta?: { content?: string };
      }>;
      if (choices[0]?.message?.content) {
        content = choices[0].message.content;
      }
    }

    // 提取 usage 信息
    const usage = response.usage as {
      input_tokens?: number;
      output_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    } || {};

    return {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: usage.input_tokens || usage.prompt_tokens || 0,
        completion_tokens: usage.output_tokens || usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 
          (usage.input_tokens || usage.prompt_tokens || 0) + 
          (usage.output_tokens || usage.completion_tokens || 0),
      },
    };
  }
}

/**
 * 创建 Codex 处理器实例
 */
export function createCodexHandler(tokenManager: TokenManager): CodexProxyHandler {
  return new CodexProxyHandler(tokenManager);
}