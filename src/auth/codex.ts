import { CODEX_OAUTH } from "../config.ts";
import type { CodexAccount, TokenResponse, OAuthCallbackResult, PKCECodes } from "../types.ts";
import { generateRandomState, generatePKCECodes, generateUUID, getAccountIdFromJWT, getEmailFromJWT } from "../utils/crypto.ts";
import { fetchWithTimeout, log } from "../utils/http.ts";

/**
 * Codex认证服务
 */
export class CodexAuth {
  private callbackPort: number;

  constructor(callbackPort?: number) {
    this.callbackPort = callbackPort || CODEX_OAUTH.callbackPort;
  }

  /**
   * 生成PKCE代码对
   */
  async generatePKCE(): Promise<PKCECodes> {
    return await generatePKCECodes();
  }

  /**
   * 生成OAuth授权URL
   */
  generateAuthUrl(pkceCodes: PKCECodes, redirectUri?: string): { url: string; state: string } {
    const state = generateRandomState();
    const redirect = redirectUri || CODEX_OAUTH.redirectUri;
    
    const params = new URLSearchParams({
      client_id: CODEX_OAUTH.clientId,
      response_type: "code",
      redirect_uri: redirect,
      scope: CODEX_OAUTH.scopes.join(" "),
      state,
      code_challenge: pkceCodes.codeChallenge,
      code_challenge_method: "S256",
      prompt: "login",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
    });

    return {
      url: `${CODEX_OAUTH.authUrl}?${params.toString()}`,
      state,
    };
  }

  /**
   * 交换授权码获取Token
   */
  async exchangeCode(code: string, pkceCodes: PKCECodes, redirectUri?: string): Promise<TokenResponse> {
    const redirect = redirectUri || CODEX_OAUTH.redirectUri;
    
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CODEX_OAUTH.clientId,
      code,
      redirect_uri: redirect,
      code_verifier: pkceCodes.codeVerifier,
    });

    const response = await fetchWithTimeout(CODEX_OAUTH.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    }, 30000);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token交换失败: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * 刷新Access Token
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const params = new URLSearchParams({
      client_id: CODEX_OAUTH.clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "openid profile email",
    });

    const response = await fetchWithTimeout(CODEX_OAUTH.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
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
   * 完整的登录流程
   */
  async login(code: string, pkceCodes: PKCECodes, redirectUri?: string): Promise<CodexAccount> {
    // 1. 交换Token
    log("info", "正在交换授权码...");
    const tokenResponse = await this.exchangeCode(code, pkceCodes, redirectUri);

    // 2. 从ID Token中提取信息
    const idToken = tokenResponse.id_token || "";
    const accountId = getAccountIdFromJWT(idToken) || "";
    const email = getEmailFromJWT(idToken) || "";

    if (!email) {
      log("warn", "无法从ID Token中提取邮箱");
    }

    // 3. 构建账号对象
    const now = new Date().toISOString();
    const expiryTimestamp = Math.floor(Date.now() / 1000) + tokenResponse.expires_in;

    const account: CodexAccount = {
      id: generateUUID(),
      email,
      token: {
        id_token: idToken,
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token || "",
        expires_in: tokenResponse.expires_in,
        expiry_timestamp: expiryTimestamp,
        account_id: accountId,
      },
      created_at: now,
      updated_at: now,
    };

    return account;
  }

  /**
   * 确保Token有效（如需要则刷新）
   */
  async ensureValidToken(account: CodexAccount): Promise<CodexAccount> {
    const now = Math.floor(Date.now() / 1000);
    // Codex Token通常有效期较长，提前5天刷新
    const bufferSeconds = 5 * 24 * 60 * 60;

    if (account.token.expiry_timestamp > now + bufferSeconds) {
      return account;
    }

    log("info", `账号 ${account.email} 的Token即将过期，正在刷新...`);

    const tokenResponse = await this.refreshToken(account.token.refresh_token);
    
    account.token.access_token = tokenResponse.access_token;
    account.token.id_token = tokenResponse.id_token || account.token.id_token;
    account.token.expires_in = tokenResponse.expires_in;
    account.token.expiry_timestamp = now + tokenResponse.expires_in;
    if (tokenResponse.refresh_token) {
      account.token.refresh_token = tokenResponse.refresh_token;
    }
    
    // 更新账号ID和邮箱（如果有新的ID Token）
    if (tokenResponse.id_token) {
      const newAccountId = getAccountIdFromJWT(tokenResponse.id_token);
      const newEmail = getEmailFromJWT(tokenResponse.id_token);
      if (newAccountId) account.token.account_id = newAccountId;
      if (newEmail) account.email = newEmail;
    }
    
    account.updated_at = new Date().toISOString();

    log("info", `账号 ${account.email} Token刷新成功`);

    return account;
  }
}

/**
 * 创建默认的Codex认证服务实例
 */
export function createCodexAuth(): CodexAuth {
  return new CodexAuth();
}