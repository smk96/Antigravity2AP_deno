import { getConfig } from "../config.ts";

/**
 * 创建HTTP客户端
 */
export function createHttpClient(timeoutSeconds: number = 300): {
  fetch: typeof fetch;
  timeout: number;
} {
  return {
    fetch: fetch,
    timeout: timeoutSeconds * 1000,
  };
}

/**
 * 带超时的fetch
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 300000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 解析SSE行
 */
export function parseSSELine(line: string): { event?: string; data?: string } | null {
  if (!line || line.startsWith(":")) {
    return null;
  }
  
  if (line.startsWith("event:")) {
    return { event: line.slice(6).trim() };
  }
  
  if (line.startsWith("data:")) {
    return { data: line.slice(5).trim() };
  }
  
  return null;
}

/**
 * 创建SSE流读取器
 */
export async function* readSSEStream(
  response: Response
): AsyncGenerator<string, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) {
    return;
  }
  
  const decoder = new TextDecoder();
  let buffer = "";
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data && data !== "[DONE]") {
            yield data;
          }
        }
      }
    }
    
    // 处理剩余的buffer
    if (buffer.startsWith("data:")) {
      const data = buffer.slice(5).trim();
      if (data && data !== "[DONE]") {
        yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 创建SSE响应流
 */
export function createSSEStream(
  generator: AsyncGenerator<string, void, unknown>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await generator.next();
        if (done) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } else {
          controller.enqueue(encoder.encode(`data: ${value}\n\n`));
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * 日志函数
 */
export function log(level: "debug" | "info" | "warn" | "error", message: string, ...args: unknown[]): void {
  const config = getConfig();
  const timestamp = new Date().toISOString();
  
  if (level === "debug" && !config.debug) {
    return;
  }
  
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  switch (level) {
    case "debug":
      console.debug(prefix, message, ...args);
      break;
    case "info":
      console.info(prefix, message, ...args);
      break;
    case "warn":
      console.warn(prefix, message, ...args);
      break;
    case "error":
      console.error(prefix, message, ...args);
      break;
  }
}

/**
 * 错误响应
 */
export function errorResponse(
  status: number,
  message: string,
  type: string = "error"
): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type,
        code: status,
      },
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

/**
 * JSON响应
 */
export function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}