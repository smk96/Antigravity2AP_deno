import type { AntigravityRequest, AntigravityResponse } from "../types.ts";
import { ANTIGRAVITY_API } from "../config.ts";
import { log } from "../utils/http.ts";

// 简单的logger封装
const logger = {
  info: (msg: string) => log("info", `[upstream] ${msg}`),
  debug: (msg: string) => log("debug", `[upstream] ${msg}`),
  error: (msg: string) => log("error", `[upstream] ${msg}`),
};

/**
 * 上游API客户端
 */
export class UpstreamClient {
  private baseUrl: string;
  private useDailyApi: boolean;

  constructor(useDailyApi: boolean = false) {
    this.useDailyApi = useDailyApi;
    this.baseUrl = useDailyApi
      ? ANTIGRAVITY_API.baseUrls[0]  // daily
      : ANTIGRAVITY_API.baseUrls[2]; // production
  }

  /**
   * 发送非流式请求
   */
  async generateContent(
    request: AntigravityRequest,
    accessToken: string
  ): Promise<AntigravityResponse> {
    const url = `${this.baseUrl}${ANTIGRAVITY_API.paths.generateContent}`;

    logger.info(`Sending request to ${url}`);
    logger.debug(`Request body: ${JSON.stringify(request)}`);

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(accessToken),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Upstream error: ${response.status} ${errorText}`);
      throw new UpstreamError(
        `Upstream API error: ${response.status}`,
        response.status,
        errorText
      );
    }

    const data = await response.json();
    logger.debug(`Response: ${JSON.stringify(data)}`);
    return data;
  }

  /**
   * 发送流式请求
   */
  async streamGenerateContent(
    request: AntigravityRequest,
    accessToken: string
  ): Promise<ReadableStream<Uint8Array>> {
    const url = `${this.baseUrl}${ANTIGRAVITY_API.paths.streamGenerateContent}`;

    logger.info(`Sending streaming request to ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(accessToken),
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Upstream streaming error: ${response.status} ${errorText}`);
      throw new UpstreamError(
        `Upstream API error: ${response.status}`,
        response.status,
        errorText
      );
    }

    if (!response.body) {
      throw new UpstreamError("No response body for streaming request", 500, "");
    }

    return response.body;
  }

  /**
   * 获取可用模型列表
   */
  async fetchAvailableModels(
    accessToken: string,
    projectId: string
  ): Promise<string[]> {
    const url = `${this.baseUrl}${ANTIGRAVITY_API.paths.fetchAvailableModels}`;

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(accessToken),
      body: JSON.stringify({
        project: projectId,
        request: {},
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Failed to fetch models: ${response.status} ${errorText}`);
      return [];
    }

    const data = await response.json();
    const models: string[] = [];

    // 解析模型列表
    if (data.response?.models) {
      for (const model of data.response.models) {
        if (model.name) {
          models.push(model.name);
        }
      }
    }

    return models;
  }

  /**
   * 加载代码辅助配置
   */
  async loadCodeAssist(
    accessToken: string,
    projectId: string
  ): Promise<unknown> {
    const url = `${this.baseUrl}${ANTIGRAVITY_API.paths.loadCodeAssist}`;

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(accessToken),
      body: JSON.stringify({
        project: projectId,
        request: {},
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Failed to load code assist: ${response.status} ${errorText}`);
      throw new UpstreamError(
        `Failed to load code assist: ${response.status}`,
        response.status,
        errorText
      );
    }

    return await response.json();
  }

  /**
   * 构建请求头
   */
  private buildHeaders(accessToken: string): Headers {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("User-Agent", "antigravity-deno/1.0.0");
    headers.set("X-Goog-Api-Client", "gl-js/1.0.0 grpc-js/1.0.0");
    return headers;
  }
}

/**
 * 上游错误
 */
export class UpstreamError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string
  ) {
    super(message);
    this.name = "UpstreamError";
  }

  /**
   * 是否是可重试的错误
   */
  isRetryable(): boolean {
    // 5xx错误和429限流可以重试
    return this.statusCode >= 500 || this.statusCode === 429;
  }

  /**
   * 是否是认证错误
   */
  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

/**
 * 解析流式响应 (支持 SSE 和 JSON Array Stream)
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let braceDepth = 0;
  let inString = false;
  let escaped = false;
  let jsonStartIndex = -1;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 尝试处理 SSE 格式 (data: ...)
      // 如果 buffer 开头看起来像 SSE，我们按行处理
      if (buffer.startsWith("data:") || buffer.includes("\ndata:")) {
        const lines = buffer.split("\n");
        // 保留最后一行（可能不完整）
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const data = trimmed.slice(6);
            if (data === "[DONE]") return;
            try {
              yield JSON.parse(data);
            } catch { /* ignore */ }
          }
        }
        continue;
      }

      // 处理 JSON Array Stream (Google API 格式)
      // 简单的状态机提取顶层 JSON 对象
      let i = 0;
      while (i < buffer.length) {
        const char = buffer[i];
        
        if (!inString) {
          if (char === '{') {
            if (braceDepth === 0) jsonStartIndex = i;
            braceDepth++;
          } else if (char === '}') {
            braceDepth--;
            if (braceDepth === 0 && jsonStartIndex !== -1) {
              // 找到一个完整的 JSON 对象
              const jsonStr = buffer.substring(jsonStartIndex, i + 1);
              try {
                yield JSON.parse(jsonStr);
              } catch (e) {
                logger.debug(`Failed to parse extracted JSON: ${e}`);
              }
              // 移除已处理的部分
              buffer = buffer.substring(i + 1);
              i = -1; // 重置索引，从新 buffer 开头开始
              jsonStartIndex = -1;
            }
          } else if (char === '"') {
            inString = true;
          }
        } else {
          if (char === '\\') {
            escaped = !escaped;
          } else if (char === '"' && !escaped) {
            inString = false;
          } else {
            escaped = false;
          }
        }
        i++;
      }
      
      // 如果 buffer 过大且没有找到对象，可能需要清理（防止内存泄漏）
      // 但对于 JSON Stream，我们必须保留直到找到闭合括号
      if (buffer.length > 1024 * 1024 * 5) { // 5MB limit
         logger.error("Buffer too large, clearing");
         buffer = "";
         braceDepth = 0;
         jsonStartIndex = -1;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 创建上游客户端单例
 */
let upstreamClient: UpstreamClient | null = null;

export function getUpstreamClient(useDailyApi: boolean = false): UpstreamClient {
  if (!upstreamClient || upstreamClient["useDailyApi"] !== useDailyApi) {
    upstreamClient = new UpstreamClient(useDailyApi);
  }
  return upstreamClient;
}