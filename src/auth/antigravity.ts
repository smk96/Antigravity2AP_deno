import { ANTIGRAVITY_OAUTH, ANTIGRAVITY_API } from "../config.ts";
import type { AntigravityAccount, TokenResponse, UserInfo, OAuthCallbackResult } from "../types.ts";
import { generateRandomState, generateUUID } from "../utils/crypto.ts";
import { fetchWithTimeout, log } from "../utils/http.ts";

/**
 * Antigravity认证服务
 */
export class AntigravityAuth {
  private callbackPort: number;
  private pendingStates: Map<string, { resolve: (result: OAuthCallbackResult) => void; reject: (error: Error) => void }>;

  constructor(callbackPort?: number) {
    this.callbackPort = callbackPort || ANTIGRAVITY_OAUTH.callbackPort;
    this.pendingStates = new Map();
  }

  /**
   * 生成OAuth授权URL
   */
  generateAuthUrl(redirectUri?: string): { url: string; state: string } {
    const state = generateRandomState();
    const redirect = redirectUri || `http://localhost:${this.callbackPort}/oauth-callback`;
    
    const params = new URLSearchParams({
      client_id: ANTIGRAVITY_OAUTH.clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: ANTIGRAVITY_OAUTH.scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });

    return {
      url: `${ANTIGRAVITY_OAUTH.authUrl}?${params.toString()}`,
      state,
    };
  }

  /**
   * 交换授权码获取Token
   */
  async exchangeCode(code: string, redirectUri?: string): Promise<TokenResponse> {
    const redirect = redirectUri || `http://localhost:${this.callbackPort}/oauth-callback`;
    
    log("info", `Exchanging code for token. Redirect URI: ${redirect}`);

    const params = new URLSearchParams({
      client_id: ANTIGRAVITY_OAUTH.clientId,
      client_secret: ANTIGRAVITY_OAUTH.clientSecret,
      code,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    });

    const response = await fetchWithTimeout(ANTIGRAVITY_OAUTH.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }, 30000);

    if (!response.ok) {
      const errorText = await response.text();
      log("error", `Token exchange failed. Status: ${response.status}, Body: ${errorText}`);
      throw new Error(`Token交换失败: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * 刷新Access Token
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const params = new URLSearchParams({
      client_id: ANTIGRAVITY_OAUTH.clientId,
      client_secret: ANTIGRAVITY_OAUTH.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const response = await fetchWithTimeout(ANTIGRAVITY_OAUTH.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": ANTIGRAVITY_API.userAgent,
      },
      body: params.toString(),
    }, 30000);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token刷新失败: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const response = await fetchWithTimeout(ANTIGRAVITY_OAUTH.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }, 15000);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`获取用户信息失败: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * 获取Project ID
   */
  async fetchProjectId(accessToken: string): Promise<string> {
    const baseUrl = ANTIGRAVITY_API.baseUrls[0];
    const url = `${baseUrl}${ANTIGRAVITY_API.paths.loadCodeAssist}`;

    const requestBody = {
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
    };

    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_API.userAgent,
      },
      body: JSON.stringify(requestBody),
    }, 30000);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`获取Project ID失败: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    if (data.cloudaicompanionProject) {
      return data.cloudaicompanionProject;
    }

    throw new Error("响应中未找到cloudaicompanionProject");
  }

  /**
   * 完整的登录流程
   */
  async login(code: string, redirectUri?: string): Promise<AntigravityAccount> {
    // 1. 交换Token
    log("info", "正在交换授权码...");
    const tokenResponse = await this.exchangeCode(code, redirectUri);

    // 2. 获取用户信息
    log("info", "正在获取用户信息...");
    const userInfo = await this.getUserInfo(tokenResponse.access_token);

    // 3. 获取Project ID
    log("info", "正在获取Project ID...");
    let projectId: string | undefined;
    try {
      projectId = await this.fetchProjectId(tokenResponse.access_token);
      log("info", `获取到Project ID: ${projectId}`);
    } catch (error) {
      log("warn", `获取Project ID失败: ${error}`);
    }

    // 4. 构建账号对象
    const now = new Date().toISOString();
    const expiryTimestamp = Math.floor(Date.now() / 1000) + tokenResponse.expires_in;

    const account: AntigravityAccount = {
      id: generateUUID(),
      email: userInfo.email,
      name: userInfo.name,
      token: {
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token || "",
        expires_in: tokenResponse.expires_in,
        expiry_timestamp: expiryTimestamp,
        project_id: projectId,
      },
      created_at: now,
      updated_at: now,
    };

    return account;
  }

  /**
   * 确保Token有效（如需要则刷新）
   */
  async ensureValidToken(account: AntigravityAccount): Promise<AntigravityAccount> {
    const now = Math.floor(Date.now() / 1000);
    const bufferSeconds = 300; // 提前5分钟刷新

    if (account.token.expiry_timestamp > now + bufferSeconds) {
      return account;
    }

    log("info", `账号 ${account.email} 的Token即将过期，正在刷新...`);

    const tokenResponse = await this.refreshToken(account.token.refresh_token);
    
    account.token.access_token = tokenResponse.access_token;
    account.token.expires_in = tokenResponse.expires_in;
    account.token.expiry_timestamp = now + tokenResponse.expires_in;
    if (tokenResponse.refresh_token) {
      account.token.refresh_token = tokenResponse.refresh_token;
    }
    account.updated_at = new Date().toISOString();

    log("info", `账号 ${account.email} Token刷新成功`);

    return account;
  }
}

/**
 * 创建默认的Antigravity认证服务实例
 */
export function createAntigravityAuth(): AntigravityAuth {
  return new AntigravityAuth();
}