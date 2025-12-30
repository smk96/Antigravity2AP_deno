import { Hono } from "hono";
import type { AntigravityAccount, CodexAccount } from "../types.ts";
import { TokenManager } from "../auth/token_manager.ts";
import { AccountStorage } from "../auth/store.ts";
import { AntigravityAuth } from "../auth/antigravity.ts";
import { CodexAuth } from "../auth/codex.ts";
import { getConfig } from "../config.ts";
import { errorResponse, jsonResponse, log } from "../utils/http.ts";
import { DASHBOARD_HTML, CODEX_CALLBACK_HTML } from "../views/dashboard.ts";

/**
 * 创建管理端路由
 */
export function createManagementRoutes(
  storage: AccountStorage,
  tokenManager: TokenManager
): Hono {
  const app = new Hono();
  const antigravityAuth = new AntigravityAuth();
  const codexAuth = new CodexAuth();

  // ==================== HTML 页面 ====================
  app.get("/", (c) => c.html(DASHBOARD_HTML));
  app.get("/codex-callback", (c) => c.html(CODEX_CALLBACK_HTML));

  // ==================== 认证中间件 ====================

  /**
   * 管理密钥验证
   */
  app.use("/*", async (c, next) => {
    // 排除无需认证的路径
    const path = c.req.path;
    if (path === "/" || path === "/codex-callback" || path === "/auth/antigravity/callback") {
      return next();
    }

    const config = getConfig();
    
    // 如果没有配置管理密钥，跳过验证
    if (!config.remoteManagement?.enabled || !config.remoteManagement?.secretKey) {
      return next();
    }

    const authHeader = c.req.header("X-Management-Key") ||
                       c.req.header("Authorization");
    
    if (!authHeader) {
      return errorResponse(401, "Management key required");
    }

    let key = authHeader;
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      key = authHeader.slice(7);
    }

    if (key !== config.remoteManagement.secretKey) {
      return errorResponse(403, "Invalid management key");
    }

    return next();
  });

  // ==================== 账号管理 ====================

  /**
   * 获取所有账号列表
   */
  app.get("/accounts", async (c) => {
    // 自动刷新 Antigravity 账号
    const antigravityAccounts = storage.getAllAntigravityAccounts();
    await Promise.all(antigravityAccounts.map(async (acc) => {
      try {
        // ensureValidToken 内部会检查是否过期，未过期则直接返回
        const refreshed = await antigravityAuth.ensureValidToken(acc);
        // 保存更新后的状态
        await storage.saveAntigravityAccount(refreshed);
      } catch (e) {
        log("warn", `Auto-refresh failed for ${acc.email}: ${e}`);
      }
    }));

    // 自动刷新 Codex 账号
    const codexAccounts = storage.getAllCodexAccounts();
    await Promise.all(codexAccounts.map(async (acc) => {
      try {
        const refreshed = await codexAuth.ensureValidToken(acc);
        await storage.saveCodexAccount(refreshed);
      } catch (e) {
        log("warn", `Auto-refresh failed for ${acc.email}: ${e}`);
      }
    }));

    // 重新获取最新状态
    const antigravity = storage.getAllAntigravityAccounts().map(sanitizeAccount);
    const codex = storage.getAllCodexAccounts().map(sanitizeCodexAccount);

    return jsonResponse({
      antigravity: {
        count: antigravity.length,
        accounts: antigravity,
      },
      codex: {
        count: codex.length,
        accounts: codex,
      },
    });
  });

  /**
   * 获取Antigravity账号列表
   */
  app.get("/accounts/antigravity", (c) => {
    const accounts = storage.getAllAntigravityAccounts().map(sanitizeAccount);
    return jsonResponse({
      count: accounts.length,
      accounts,
    });
  });

  /**
   * 获取Codex账号列表
   */
  app.get("/accounts/codex", (c) => {
    const accounts = storage.getAllCodexAccounts().map(sanitizeCodexAccount);
    return jsonResponse({
      count: accounts.length,
      accounts,
    });
  });

  /**
   * 删除Antigravity账号
   */
  app.delete("/accounts/antigravity/:id", async (c) => {
    const id = c.req.param("id");
    const account = storage.getAntigravityAccount(id);
    
    if (!account) {
      return errorResponse(404, `Account ${id} not found`);
    }

    await storage.deleteAntigravityAccount(id);
    log("info", `Deleted Antigravity account: ${account.email}`);
    
    return jsonResponse({
      success: true,
      message: `Account ${account.email} deleted`,
    });
  });

  /**
   * 删除Codex账号
   */
  app.delete("/accounts/codex/:id", async (c) => {
    const id = c.req.param("id");
    const account = storage.getCodexAccount(id);
    
    if (!account) {
      return errorResponse(404, `Account ${id} not found`);
    }

    await storage.deleteCodexAccount(id);
    log("info", `Deleted Codex account: ${account.email}`);
    
    return jsonResponse({
      success: true,
      message: `Account ${account.email} deleted`,
    });
  });

  // ==================== OAuth登录 ====================

  /**
   * 获取Antigravity OAuth登录URL
   */
  app.get("/auth/antigravity/login", (c) => {
    const isManual = c.req.query("manual") === "true";
    // 如果是手动模式，使用 CLIProxyAPI 默认的本地回调地址，以通过 Google 白名单校验
    const redirectUri = isManual
      ? "http://localhost:51121/oauth-callback"
      : c.req.query("redirect_uri");
      
    const { url, state } = antigravityAuth.generateAuthUrl(redirectUri);
    
    return jsonResponse({
      url,
      state,
      instructions: "在浏览器中打开此URL进行登录",
    });
  });

  /**
   * 获取Codex OAuth登录URL
   */
  app.get("/auth/codex/login", async (c) => {
    const redirectUri = c.req.query("redirect_uri");
    const pkceCodes = await codexAuth.generatePKCE();
    const { url, state } = codexAuth.generateAuthUrl(pkceCodes, redirectUri);
    
    return jsonResponse({
      url,
      state,
      codeVerifier: pkceCodes.codeVerifier,
      instructions: "在浏览器中打开此URL进行登录，保存codeVerifier用于回调",
    });
  });

  /**
   * Antigravity OAuth回调 (自动模式)
   */
  app.get("/auth/antigravity/callback", async (c) => {
    try {
      const code = c.req.query("code");
      
      if (!code) {
        return errorResponse(400, "Missing authorization code");
      }

      // 动态构造 redirect_uri
      const origin = new URL(c.req.url).origin;
      const redirectUri = `${origin}/manage/auth/antigravity/callback`;

      const tokenResponse = await antigravityAuth.exchangeCode(code, redirectUri);
      const userInfo = await antigravityAuth.getUserInfo(tokenResponse.access_token);
      
      const account = await createAntigravityAccount(tokenResponse, userInfo, antigravityAuth);
      await storage.saveAntigravityAccount(account);
      log("info", `Added Antigravity account (auto): ${account.email}`);

      // 成功后重定向回管理页面
      return c.redirect("/manage");
    } catch (error) {
      log("error", `Antigravity OAuth callback error: ${error}`);
      return c.html(`<h1>Login Failed</h1><p>${error}</p><a href="/manage">Back to Manager</a>`);
    }
  });

  /**
   * Antigravity OAuth回调 (手动模式)
   */
  app.post("/auth/antigravity/manual-callback", async (c) => {
    try {
      const body = await c.req.json();
      const { code, redirectUri: providedRedirectUri } = body;
      
      if (!code) {
        return errorResponse(400, "Missing authorization code");
      }

      // 优先使用前端传来的 redirectUri，否则使用默认的
      const redirectUri = providedRedirectUri || "http://localhost:51121/oauth-callback";

      const tokenResponse = await antigravityAuth.exchangeCode(code, redirectUri);
      const userInfo = await antigravityAuth.getUserInfo(tokenResponse.access_token);
      
      const account = await createAntigravityAccount(tokenResponse, userInfo, antigravityAuth);
      await storage.saveAntigravityAccount(account);
      log("info", `Added Antigravity account (manual): ${account.email}`);

      return jsonResponse({
        success: true,
        account: sanitizeAccount(account),
      });
    } catch (error) {
      log("error", `Antigravity manual callback error: ${error}`);
      return errorResponse(500, `OAuth error: ${error}`);
    }
  });

  /**
   * Codex OAuth回调
   */
  app.post("/auth/codex/callback", async (c) => {
    try {
      const body = await c.req.json();
      const { code, codeVerifier, redirectUri } = body;
      
      if (!code || !codeVerifier) {
        return errorResponse(400, "Missing code or codeVerifier");
      }

      const pkceCodes = { codeVerifier, codeChallenge: "" }; // codeChallenge不需要用于交换
      const tokenResponse = await codexAuth.exchangeCode(code, pkceCodes, redirectUri);
      
      // 从id_token解析用户信息
      const idToken = tokenResponse.id_token;
      if (!idToken) {
        return errorResponse(500, "No id_token in response");
      }

      // 解析JWT payload
      const parts = idToken.split(".");
      if (parts.length !== 3) {
        return errorResponse(500, "Invalid id_token format");
      }

      const payload = JSON.parse(atob(parts[1]));
      const email = payload.email || payload.sub || "unknown";

      const account: CodexAccount = {
        id: crypto.randomUUID(),
        email,
        token: {
          id_token: idToken,
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token || "",
          expires_in: tokenResponse.expires_in,
          expiry_timestamp: Date.now() + tokenResponse.expires_in * 1000,
          account_id: payload.sub,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await storage.saveCodexAccount(account);
      log("info", `Added Codex account: ${account.email}`);

      return jsonResponse({
        success: true,
        account: sanitizeCodexAccount(account),
      });
    } catch (error) {
      log("error", `Codex OAuth callback error: ${error}`);
      return errorResponse(500, `OAuth error: ${error}`);
    }
  });

  // ==================== 统计信息 ====================

  /**
   * 获取服务状态
   */
  app.get("/status", (c) => {
    const stats = tokenManager.getStats();
    const config = getConfig();

    return jsonResponse({
      status: "running",
      version: "1.0.0",
      accounts: stats,
      config: {
        host: config.host,
        port: config.port,
        debug: config.debug,
        hasApiKeys: config.apiKeys.length > 0,
        hasManagementKey: !!config.remoteManagement?.secretKey,
      },
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * 刷新所有Token
   */
  app.post("/refresh-tokens", async (c) => {
    const results = {
      antigravity: { success: 0, failed: 0, errors: [] as string[] },
      codex: { success: 0, failed: 0, errors: [] as string[] },
    };

    // 刷新Antigravity Token
    for (const account of storage.getAllAntigravityAccounts()) {
      try {
        const refreshed = await antigravityAuth.ensureValidToken(account);
        await storage.saveAntigravityAccount(refreshed);
        results.antigravity.success++;
      } catch (error) {
        results.antigravity.failed++;
        results.antigravity.errors.push(`${account.email}: ${error}`);
      }
    }

    // 刷新Codex Token
    for (const account of storage.getAllCodexAccounts()) {
      try {
        const refreshed = await codexAuth.ensureValidToken(account);
        await storage.saveCodexAccount(refreshed);
        results.codex.success++;
      } catch (error) {
        results.codex.failed++;
        results.codex.errors.push(`${account.email}: ${error}`);
      }
    }

    return jsonResponse(results);
  });

  return app;
}

/**
 * 清理账号敏感信息
 */
function sanitizeAccount(account: AntigravityAccount): Record<string, unknown> {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    hasProjectId: !!account.token.project_id,
    tokenExpiry: new Date(account.token.expiry_timestamp * 1000).toISOString(),
    isExpired: Date.now() > account.token.expiry_timestamp * 1000,
    created_at: account.created_at,
    updated_at: account.updated_at,
    quota: account.quota,
  };
}

/**
 * 清理Codex账号敏感信息
 */
function sanitizeCodexAccount(account: CodexAccount): Record<string, unknown> {
  return {
    id: account.id,
    email: account.email,
    hasAccountId: !!account.token.account_id,
    tokenExpiry: new Date(account.token.expiry_timestamp * 1000).toISOString(),
    isExpired: Date.now() > account.token.expiry_timestamp * 1000,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}

/**
 * 辅助函数：创建 Antigravity 账号对象
 */
async function createAntigravityAccount(
  tokenResponse: any,
  userInfo: any,
  auth: AntigravityAuth
): Promise<AntigravityAccount> {
  const account: AntigravityAccount = {
    id: crypto.randomUUID(),
    email: userInfo.email,
    name: userInfo.name,
    token: {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token || "",
      expires_in: tokenResponse.expires_in,
      expiry_timestamp: Date.now() + tokenResponse.expires_in * 1000,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 尝试获取project_id
  try {
    const projectId = await auth.fetchProjectId(tokenResponse.access_token);
    account.token.project_id = projectId;
  } catch (error) {
    log("warn", `Failed to fetch project_id: ${error}`);
  }

  return account;
}