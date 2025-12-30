import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from "../types.ts";
import { TokenManager } from "../auth/token_manager.ts";
import { UpstreamClient, parseSSEStream, UpstreamError } from "./upstream.ts";
import {
  translateToAntigravity,
  translateFromAntigravity,
  translateStreamChunk,
  createInitialChunk,
  createFinalChunk,
} from "./translator.ts";
import { log, errorResponse, jsonResponse, createSSEStream } from "../utils/http.ts";
import { generateUUID } from "../utils/crypto.ts";
import { getConfig } from "../config.ts";

// 简单的logger封装
const logger = {
  info: (msg: string) => log("info", `[handler] ${msg}`),
  debug: (msg: string) => log("debug", `[handler] ${msg}`),
  error: (msg: string) => log("error", `[handler] ${msg}`),
};

/**
 * Antigravity代理处理器
 */
export class AntigravityProxyHandler {
  private tokenManager: TokenManager;
  private upstreamClient: UpstreamClient;
  private maxRetries: number;

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
    this.upstreamClient = new UpstreamClient(true); // 使用daily API
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
      
      if (error instanceof UpstreamError) {
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
        // 获取token（如果之前失败则强制轮换）
        const tokenInfo = await this.tokenManager.getAntigravityToken(retry > 0);
        
        logger.info(`Using account: ${tokenInfo.email} (attempt ${retry + 1})`);

        // 转换请求
        const antigravityRequest = await translateToAntigravity(
          request,
          tokenInfo.projectId
        );

        // 发送请求
        const response = await this.upstreamClient.generateContent(
          antigravityRequest,
          tokenInfo.accessToken
        );

        // 转换响应
        const openaiResponse = translateFromAntigravity(response, request.model);
        
        return jsonResponse(openaiResponse);
      } catch (error) {
        lastError = error as Error;
        logger.error(`Attempt ${retry + 1} failed: ${error}`);

        // 如果是认证错误，标记账号失败并尝试下一个
        if (error instanceof UpstreamError && error.isAuthError()) {
          const tokenInfo = await this.tokenManager.getAntigravityToken(false).catch(() => null);
          if (tokenInfo) {
            this.tokenManager.markAntigravityAccountFailed(tokenInfo.account.id);
            logger.info(`Marked account as failed: ${tokenInfo.email}`);
          }
        }

        // 如果不是可重试的错误，直接抛出
        if (error instanceof UpstreamError && !error.isRetryable() && !error.isAuthError()) {
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
    const chunkId = `chatcmpl-${generateUUID()}`;
    
    let lastError: Error | null = null;

    for (let retry = 0; retry < this.maxRetries; retry++) {
      try {
        // 获取token
        const tokenInfo = await this.tokenManager.getAntigravityToken(retry > 0);
        
        logger.info(`Streaming with account: ${tokenInfo.email} (attempt ${retry + 1})`);

        // 转换请求
        const antigravityRequest = await translateToAntigravity(
          request,
          tokenInfo.projectId
        );

        // 发送流式请求
        const upstreamStream = await this.upstreamClient.streamGenerateContent(
          antigravityRequest,
          tokenInfo.accessToken
        );

        // 创建转换流
        const transformedStream = this.createTransformStream(
          upstreamStream,
          request.model,
          chunkId
        );

        return new Response(transformedStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      } catch (error) {
        lastError = error as Error;
        logger.error(`Streaming attempt ${retry + 1} failed: ${error}`);

        if (error instanceof UpstreamError && !error.isRetryable() && !error.isAuthError()) {
          throw error;
        }
      }
    }

    throw lastError || new Error("Streaming request failed after all retries");
  }

  /**
   * 创建流转换器
   */
  private createTransformStream(
    upstreamStream: ReadableStream<Uint8Array>,
    model: string,
    chunkId: string
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let sentInitial = false;
    let hasContent = false;
    
    const self = this;

    return new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of parseSSEStream(upstreamStream)) {
            // 发送初始chunk
            if (!sentInitial) {
              const initialChunk = createInitialChunk(model, chunkId);
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(initialChunk)}\n\n`)
              );
              sentInitial = true;
            }

            // 转换并发送chunk
            const translatedChunk = translateStreamChunk(chunk, model, chunkId);
            if (translatedChunk) {
              hasContent = true;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(translatedChunk)}\n\n`)
              );
            }
          }

          // 发送结束chunk
          if (hasContent || sentInitial) {
            const finalChunk = createFinalChunk(model, chunkId);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`)
            );
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          logger.error(`Stream transform error: ${error}`);
          controller.error(error);
        }
      },
    });
  }
}

/**
 * 创建处理器实例
 */
export function createAntigravityHandler(tokenManager: TokenManager): AntigravityProxyHandler {
  return new AntigravityProxyHandler(tokenManager);
}