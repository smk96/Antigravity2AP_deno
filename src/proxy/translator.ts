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
  Tool,
  ToolCall,
} from "../types.ts";
import { generateRequestId, generateProjectId, generateStableSessionId } from "../utils/crypto.ts";
import { getUpstreamModelName } from "../config.ts";

/**
 * OpenAI消息转Gemini内容
 */
function messageToGeminiContent(message: ChatMessage): GeminiContent {
  const role = message.role === "assistant" ? "model" : "user";
  const parts: GeminiPart[] = [];

  if (message.content) {
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
  }

  // 处理工具调用
  if (message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error("Failed to parse tool arguments:", e);
      }
      parts.push({
        functionCall: {
          name: toolCall.function.name,
          args,
        },
      });
    }
  }

  return { role, parts };
}

/**
 * 查找工具调用对应的函数名
 */
function findFunctionName(messages: ChatMessage[], toolCallId: string): string {
  // 倒序查找最近的assistant消息
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && msg.tool_calls) {
      const toolCall = msg.tool_calls.find((tc) => tc.id === toolCallId);
      if (toolCall) {
        return toolCall.function.name;
      }
    }
  }
  return "unknown_function";
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
  for (let i = 0; i < request.messages.length; i++) {
    const message = request.messages[i];

    if (message.role === "system") {
      // 系统消息作为system instruction
      if (!systemInstruction) {
        systemInstruction = {
          role: "user",
          parts: [{ text: typeof message.content === "string" ? message.content || "" : "" }],
        };
      }
      continue;
    }

    if (message.role === "tool") {
      // 合并连续的tool消息
      const functionResponseParts: GeminiPart[] = [];
      let j = i;
      while (j < request.messages.length && request.messages[j].role === "tool") {
        const toolMsg = request.messages[j];
        const functionName = findFunctionName(request.messages.slice(0, j), toolMsg.tool_call_id || "");
        
        let responseContent: Record<string, unknown> = {};
        try {
            if (typeof toolMsg.content === "string") {
                responseContent = JSON.parse(toolMsg.content);
            } else {
                responseContent = { result: toolMsg.content };
            }
        } catch {
            responseContent = { result: toolMsg.content };
        }

        functionResponseParts.push({
          functionResponse: {
            name: functionName,
            response: responseContent,
          },
        });
        j++;
      }
      i = j - 1; // 跳过已处理的消息
      contents.push({ role: "function", parts: functionResponseParts });
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

  // 优先使用 max_completion_tokens（OpenAI 新版 API），其次使用 max_tokens
  // 默认值设置为 65536，确保 Claude 模型能够输出足够长的内容
  const maxOutputTokens = request.max_completion_tokens || request.max_tokens || 65536;

  // 默认安全设置 - 关闭所有内容过滤，防止响应被截断
  const defaultSafetySettings = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
    { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
  ];

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
        maxOutputTokens,
        topP: request.top_p,
      },
      safetySettings: defaultSafetySettings,
      toolConfig: {
        functionCallingConfig: {
          mode: typeof request.tool_choice === "object" ? "ANY" : (request.tool_choice === "none" ? "NONE" : "AUTO"),
          allowedFunctionNames: typeof request.tool_choice === "object" ? [request.tool_choice.function.name] : undefined,
        },
      },
    },
  };

  // 添加系统指令
  if (systemInstruction) {
    (antigravityRequest.request as Record<string, unknown>).systemInstruction = systemInstruction;
  }

  // 处理工具定义
  if (request.tools && request.tools.length > 0) {
    const functionDeclarations = request.tools
      .filter((t) => t.type === "function")
      .map((t) => ({
        name: t.function.name,
        description: t.function.description || "",
        parametersJsonSchema: t.function.parameters,
      }));

    if (functionDeclarations.length > 0) {
      antigravityRequest.request.tools = [{ functionDeclarations }];
    }
  }

  return antigravityRequest;
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
  let reasoningContent = "";
  const toolCalls: ToolCall[] = [];

  if (content?.parts) {
    for (const part of content.parts) {
      if (part.text !== undefined) {
        if (part.thought) {
          reasoningContent += part.text;
        } else {
          textContent += part.text;
        }
      }
      
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${crypto.randomUUID().slice(0, 8)}`,
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      }
    }
  }

  const message: ChatMessage = {
    role: "assistant",
    content: textContent || null, // 如果有tool_calls但没有text，content应为null
  };

  if (reasoningContent) {
    message.reasoning_content = reasoningContent;
  }

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }
  
  // 如果内容为空且没有工具调用，提供空字符串以避免错误
  if (message.content === null && (!message.tool_calls || message.tool_calls.length === 0)) {
    message.content = "";
  }

  let finishReason = mapFinishReason(candidate?.finishReason || "STOP");
  if (toolCalls.length > 0) {
    finishReason = "tool_calls";
  }

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

  let textContent = "";
  let reasoningContent = "";
  const toolCalls: ToolCall[] = []; // 这里是delta中的tool_calls

  for (const part of content.parts) {
      if (part.text) {
          if (part.thought) {
              reasoningContent += part.text;
          } else {
              textContent += part.text;
          }
      }
      if (part.functionCall) {
          toolCalls.push({
              id: `call_${crypto.randomUUID().slice(0, 8)}`,
              type: "function",
              function: {
                  name: part.functionCall.name,
                  arguments: JSON.stringify(part.functionCall.args),
              }
          });
      }
  }

  let finishReason = candidate.finishReason
    ? mapFinishReason(candidate.finishReason as string)
    : null;

  if (toolCalls.length > 0) {
      finishReason = "tool_calls"; // 通常如果有functionCall，finishReason就是function_call/tool_calls
  }

  const delta: Partial<ChatMessage> = {};
  if (textContent) {
      delta.content = textContent;
  }
  if (reasoningContent) {
      delta.reasoning_content = reasoningContent;
  }
  if (toolCalls.length > 0) {
      // 流式tool_calls需要特殊处理，OpenAI使用index来流式传输数组
      // 这里简化处理，直接发送完整的tool_calls数组作为delta（虽然OpenAI协议是index based，但许多客户端能处理）
      // 严格来说，应该映射为 { index: number, id?: ..., function?: ... } 的结构
      // 但ChatCompletionChunk定义 delta: Partial<ChatMessage>，ChatMessage里的tool_calls是数组
      // 我们这里稍微hack一下，只要客户端能收到就行
      delta.tool_calls = toolCalls;
  }

  // 如果没有内容也没有tool_calls，跳过 (除非是finishReason)
  if (!delta.content && !delta.reasoning_content && !delta.tool_calls && !finishReason) {
      return null;
  }

  // 流式通常不带role，除非是第一帧，但handler里我们单独发了第一帧
  // 这里delta不需要role

  return {
    id: chunkId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
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