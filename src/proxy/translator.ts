import type {
  ChatCompletionRequest,
  ChatMessage,
  ContentPart,
  GeminiContent,
  GeminiPart,
  AntigravityRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  AntigravityResponse,
} from "../types.ts";
import { generateRequestId, generateProjectId, generateStableSessionId } from "../utils/crypto.ts";
import { getUpstreamModelName } from "../config.ts";

/**
 * OpenAI消息转Gemini内容
 */
function messageToGeminiContent(message: ChatMessage): GeminiContent {
  const role = message.role === "assistant" ? "model" : "user";
  const parts: GeminiPart[] = [];

  if (typeof message.content === "string") {
    parts.push({ text: message.content });
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "text" && part.text) {
        parts.push({ text: part.text });
      } else if (part.type === "image_url" && part.image_url) {
        // 处理base64图片
        const url = part.image_url.url;
        if (url.startsWith("data:")) {
          const match = url.match(/^data:(.+?);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }
    }
  }

  return { role, parts };
}

/**
 * OpenAI请求转Antigravity请求
 */
export async function translateToAntigravity(
  request: ChatCompletionRequest,
  projectId: string
): Promise<AntigravityRequest> {
  const contents: GeminiContent[] = [];
  let systemInstruction: GeminiContent | undefined;

  // 处理消息
  for (const message of request.messages) {
    if (message.role === "system") {
      // 系统消息作为system instruction
      if (!systemInstruction) {
        systemInstruction = {
          role: "user",
          parts: [{ text: typeof message.content === "string" ? message.content : "" }],
        };
      }
    } else {
      contents.push(messageToGeminiContent(message));
    }
  }

  // 获取第一条用户消息用于生成稳定的session ID
  const firstUserMessage = request.messages.find((m) => m.role === "user");
  const firstUserText = firstUserMessage
    ? typeof firstUserMessage.content === "string"
      ? firstUserMessage.content
      : ""
    : "";
  const sessionId = await generateStableSessionId(firstUserText);

  const upstreamModel = getUpstreamModelName(request.model);

  const antigravityRequest: AntigravityRequest = {
    model: upstreamModel,
    project: projectId || generateProjectId(),
    requestId: generateRequestId(),
    userAgent: "antigravity",
    request: {
      contents,
      sessionId,
      generationConfig: {
        temperature: request.temperature,
        maxOutputTokens: request.max_tokens,
        topP: request.top_p,
      },
      toolConfig: {
        functionCallingConfig: {
          mode: "VALIDATED",
        },
      },
    },
  };

  // 添加系统指令
  if (systemInstruction) {
    (antigravityRequest.request as Record<string, unknown>).systemInstruction = systemInstruction;
  }

  return antigravityRequest;
}

/**
 * Gemini Part转OpenAI内容
 */
function geminiPartToContent(part: GeminiPart): string {
  if (part.text !== undefined) {
    return part.text;
  }
  if (part.functionCall) {
    return JSON.stringify(part.functionCall);
  }
  return "";
}

/**
 * Antigravity响应转OpenAI响应（非流式）
 */
export function translateFromAntigravity(
  response: AntigravityResponse,
  model: string
): ChatCompletionResponse {
  const candidate = response.response.candidates?.[0];
  const content = candidate?.content;
  
  let textContent = "";
  if (content?.parts) {
    textContent = content.parts.map(geminiPartToContent).join("");
  }

  const message: ChatMessage = {
    role: "assistant",
    content: textContent,
  };

  const finishReason = mapFinishReason(candidate?.finishReason || "STOP");

  return {
    id: response.response.responseId || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
    usage: response.response.usageMetadata
      ? {
          prompt_tokens: response.response.usageMetadata.promptTokenCount || 0,
          completion_tokens: response.response.usageMetadata.candidatesTokenCount || 0,
          total_tokens: response.response.usageMetadata.totalTokenCount || 0,
        }
      : undefined,
  };
}

/**
 * Antigravity流式响应转OpenAI流式响应
 */
export function translateStreamChunk(
  chunk: unknown,
  model: string,
  chunkId: string
): ChatCompletionChunk | null {
  const data = chunk as Record<string, unknown>;
  
  // 尝试从不同的响应格式中提取内容
  let response = data.response as Record<string, unknown> | undefined;
  if (!response && data.candidates) {
    response = data as Record<string, unknown>;
  }
  
  if (!response) return null;

  const candidates = response.candidates as Array<Record<string, unknown>> | undefined;
  if (!candidates || candidates.length === 0) return null;

  const candidate = candidates[0];
  const content = candidate.content as { parts?: GeminiPart[] } | undefined;
  
  if (!content?.parts || content.parts.length === 0) return null;

  const textContent = content.parts.map(geminiPartToContent).join("");
  
  const finishReason = candidate.finishReason 
    ? mapFinishReason(candidate.finishReason as string)
    : null;

  return {
    id: chunkId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content: textContent,
        },
        finish_reason: finishReason,
      },
    ],
  };
}

/**
 * 映射完成原因
 */
function mapFinishReason(reason: string): "stop" | "length" | "function_call" | "tool_calls" | "content_filter" | null {
  switch (reason.toUpperCase()) {
    case "STOP":
    case "END_TURN":
      return "stop";
    case "MAX_TOKENS":
    case "LENGTH":
      return "length";
    case "FUNCTION_CALL":
      return "function_call";
    case "TOOL_CALLS":
      return "tool_calls";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
      return "content_filter";
    default:
      return null;
  }
}

/**
 * 创建初始流式chunk（包含role）
 */
export function createInitialChunk(model: string, chunkId: string): ChatCompletionChunk {
  return {
    id: chunkId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content: "",
        },
        finish_reason: null,
      },
    ],
  };
}

/**
 * 创建结束流式chunk
 */
export function createFinalChunk(model: string, chunkId: string): ChatCompletionChunk {
  return {
    id: chunkId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  };
}