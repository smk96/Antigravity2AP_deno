import { QuotaData, ModelQuota } from "../types.ts";

const QUOTA_API_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
const LOAD_PROJECT_API_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const CLOUD_CODE_BASE_URL = "https://cloudcode-pa.googleapis.com";
const USER_AGENT = "antigravity/1.11.3 Darwin/arm64";

interface LoadProjectResponse {
  cloudaicompanionProject?: string;
  currentTier?: Tier;
  paidTier?: Tier;
}

interface Tier {
  id?: string;
  quotaTier?: string;
  name?: string;
  slug?: string;
}

interface QuotaResponse {
  models: Record<string, ModelInfo>;
}

interface ModelInfo {
  quotaInfo?: QuotaInfo;
}

interface QuotaInfo {
  remainingFraction?: number;
  resetTime?: string;
}

/**
 * 获取项目 ID 和订阅类型
 */
async function fetchProjectId(accessToken: string, email: string): Promise<{ projectId?: string; subscriptionTier?: string }> {
  try {
    const response = await fetch(`${CLOUD_CODE_BASE_URL}/v1internal:loadCodeAssist`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "antigravity/windows/amd64",
      },
      body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
    });

    if (response.ok) {
      const data: LoadProjectResponse = await response.json();
      const projectId = data.cloudaicompanionProject;
      
      // 优先从 paid_tier 获取订阅 ID
      const subscriptionTier = data.paidTier?.id || data.currentTier?.id;
      
      if (subscriptionTier) {
        console.log(`📊 [${email}] 订阅识别成功: ${subscriptionTier}`);
      }
      
      return { projectId, subscriptionTier };
    } else {
      console.warn(`⚠️ [${email}] loadCodeAssist 失败: Status: ${response.status}`);
    }
  } catch (e) {
    console.error(`❌ [${email}] loadCodeAssist 网络错误:`, e);
  }
  
  return {};
}

/**
 * 查询账号配额
 */
export async function fetchQuota(accessToken: string, email: string): Promise<{ quota: QuotaData; projectId?: string }> {
  // 1. 获取 Project ID 和订阅类型
  const { projectId, subscriptionTier } = await fetchProjectId(accessToken, email);
  
  const finalProjectId = projectId || "bamboo-precept-lgxtn";
  
  const payload = {
    project: finalProjectId,
  };
  
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(QUOTA_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": USER_AGENT,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 403) {
        console.warn(`账号无权限 (403 Forbidden), 标记为 forbidden 状态`);
        return {
          quota: {
            models: [],
            last_updated: Math.floor(Date.now() / 1000),
            is_forbidden: true,
            subscription_tier: subscriptionTier,
          },
          projectId: projectId,
        };
      }

      if (!response.ok) {
        const text = await response.text();
        console.warn(`API 错误: ${response.status} - ${text} (尝试 ${attempt}/${maxRetries})`);
        lastError = new Error(`HTTP ${response.status} - ${text}`);
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        } else {
          throw lastError;
        }
      }

      const quotaResponse: QuotaResponse = await response.json();
      
      const models: ModelQuota[] = [];
      
      if (quotaResponse.models) {
        for (const [name, info] of Object.entries(quotaResponse.models)) {
          if (info.quotaInfo) {
            const percentage = info.quotaInfo.remainingFraction !== undefined
              ? Math.floor(info.quotaInfo.remainingFraction * 100)
              : 0;
            
            const resetTime = info.quotaInfo.resetTime || "";
            
            // 只保存我们关心的模型
            if (name.includes("gemini") || name.includes("claude")) {
              models.push({
                name,
                percentage,
                reset_time: resetTime,
              });
            }
          }
        }
      }

      return {
        quota: {
          models,
          last_updated: Math.floor(Date.now() / 1000),
          is_forbidden: false,
          subscription_tier: subscriptionTier,
        },
        projectId: projectId,
      };

    } catch (e) {
      console.warn(`请求失败: ${e} (尝试 ${attempt}/${maxRetries})`);
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError || new Error("配额查询失败");
}