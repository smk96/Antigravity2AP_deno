import { encodeBase64Url } from "@std/encoding/base64url";
import type { PKCECodes } from "../types.ts";

/**
 * 生成随机字节
 */
export function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * 生成随机状态字符串
 */
export function generateRandomState(): string {
  const bytes = generateRandomBytes(32);
  return encodeBase64Url(bytes);
}

/**
 * 生成PKCE代码对
 */
export async function generatePKCECodes(): Promise<PKCECodes> {
  // 生成96字节的随机数据作为code_verifier
  const bytes = generateRandomBytes(96);
  const codeVerifier = encodeBase64Url(bytes);
  
  // 使用SHA256生成code_challenge
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const codeChallenge = encodeBase64Url(new Uint8Array(hashBuffer));
  
  return {
    codeVerifier,
    codeChallenge,
  };
}

/**
 * 生成UUID
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * 生成请求ID
 */
export function generateRequestId(): string {
  return `agent-${generateUUID()}`;
}

/**
 * 生成会话ID
 */
export function generateSessionId(): string {
  const bytes = generateRandomBytes(8);
  const view = new DataView(bytes.buffer);
  const num = view.getBigInt64(0) & BigInt("0x7FFFFFFFFFFFFFFF");
  return `-${num.toString()}`;
}

/**
 * 基于内容生成稳定的会话ID
 */
export async function generateStableSessionId(content: string): Promise<string> {
  if (!content) {
    return generateSessionId();
  }
  
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  const view = new DataView(hashArray.buffer);
  const num = view.getBigInt64(0) & BigInt("0x7FFFFFFFFFFFFFFF");
  return `-${num.toString()}`;
}

/**
 * 生成随机项目ID
 */
export function generateProjectId(): string {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomPart = generateUUID().slice(0, 5).toLowerCase();
  
  return `${adj}-${noun}-${randomPart}`;
}

/**
 * 解析JWT token（不验证签名）
 */
export function parseJWT(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }
    
    const payload = parts[1];
    // 添加填充
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * 从JWT中提取账号ID
 */
export function getAccountIdFromJWT(token: string): string | null {
  const payload = parseJWT(token);
  if (!payload) return null;
  
  // OpenAI格式
  if (typeof payload.sub === "string") {
    return payload.sub;
  }
  
  // 其他格式
  if (typeof payload.account_id === "string") {
    return payload.account_id;
  }
  
  return null;
}

/**
 * 从JWT中提取邮箱
 */
export function getEmailFromJWT(token: string): string | null {
  const payload = parseJWT(token);
  if (!payload) return null;
  
  if (typeof payload.email === "string") {
    return payload.email;
  }
  
  return null;
}