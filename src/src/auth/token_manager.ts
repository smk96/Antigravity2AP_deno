import type { AntigravityAccount, CodexAccount } from "../types.ts";
import { AccountStorage } from "./store.ts";
import { AntigravityAuth } from "./antigravity.ts";
import { CodexAuth } from "./codex.ts";
import { log } from "../utils/http.ts";

/**
 * Token管理器
 * 负责账号轮换和Token刷新
 */
export class TokenManager {
  private storage: AccountStorage;
  private antigravityAuth: AntigravityAuth;
  private codexAuth: CodexAuth;
  
  // 轮换索引
  private antigravityIndex: number = 0;
  private codexIndex: number = 0;
  
  // 最后使用的账号（用于时间窗口锁定）
  private lastUsedAntigravity: { id: string; time: number } | null = null;
  private lastUsedCodex: { id: string; time: number } | null = null;
  
  // 时间窗口（毫秒）
  private lockWindowMs: number = 60000; // 60秒

  constructor(storage: AccountStorage) {
    this.storage = storage;
    this.antigravityAuth = new AntigravityAuth();
    this.codexAuth = new CodexAuth();
  }

  /**
   * 获取账号存储
   */
  getAccountStorage(): AccountStorage {
    return this.storage;
  }

  // ==================== Antigravity Token管理 ====================

  /**
   * 获取可用的Antigravity Token
   * @param forceRotate 是否强制轮换
   */
  async getAntigravityToken(forceRotate: boolean = false): Promise<{
    accessToken: string;
    projectId: string;
    email: string;
    account: AntigravityAccount;
  }> {
    const accounts = this.storage.getAllAntigravityAccounts();
    
    if (accounts.length === 0) {
      throw new Error("没有可用的Antigravity账号");
    }

    let account: AntigravityAccount;

    // 检查时间窗口锁定
    if (!forceRotate && this.lastUsedAntigravity) {
      const elapsed = Date.now() - this.lastUsedAntigravity.time;
      if (elapsed < this.lockWindowMs) {
        const lockedAccount = this.storage.getAntigravityAccount(this.lastUsedAntigravity.id);
        if (lockedAccount) {
          log("debug", `时间窗口内，复用账号: ${lockedAccount.email}`);
          account = lockedAccount;
        } else {
          account = this.selectNextAntigravityAccount(accounts);
        }
      } else {
        account = this.selectNextAntigravityAccount(accounts);
      }
    } else {
      account = this.selectNextAntigravityAccount(accounts);
    }

    // 确保Token有效
    try {
      account = await this.antigravityAuth.ensureValidToken(account);
      // 更新存储
      await this.storage.saveAntigravityAccount(account);
    } catch (error) {
      log("error", `Token刷新失败: ${account.email}`, error);
      throw error;
    }

    // 更新最后使用的账号
    this.lastUsedAntigravity = { id: account.id, time: Date.now() };

    // 确保有project_id
    if (!account.token.project_id) {
      try {
        const projectId = await this.antigravityAuth.fetchProjectId(account.token.access_token);
        account.token.project_id = projectId;
        await this.storage.saveAntigravityAccount(account);
      } catch (error) {
        log("warn", `获取project_id失败: ${error}`);
      }
    }

    return {
      accessToken: account.token.access_token,
      projectId: account.token.project_id || "",
      email: account.email,
      account,
    };
  }

  /**
   * 选择下一个Antigravity账号（轮换）
   */
  private selectNextAntigravityAccount(accounts: AntigravityAccount[]): AntigravityAccount {
    const index = this.antigravityIndex % accounts.length;
    this.antigravityIndex++;
    const account = accounts[index];
    log("info", `切换到Antigravity账号: ${account.email}`);
    return account;
  }

  // ==================== Codex Token管理 ====================

  /**
   * 获取可用的Codex Token
   * @param forceRotate 是否强制轮换
   */
  async getCodexToken(forceRotate: boolean = false): Promise<{
    accessToken: string;
    email: string;
    account: CodexAccount;
  }> {
    const accounts = this.storage.getAllCodexAccounts();
    
    if (accounts.length === 0) {
      throw new Error("没有可用的Codex账号");
    }

    let account: CodexAccount;

    // 检查时间窗口锁定
    if (!forceRotate && this.lastUsedCodex) {
      const elapsed = Date.now() - this.lastUsedCodex.time;
      if (elapsed < this.lockWindowMs) {
        const lockedAccount = this.storage.getCodexAccount(this.lastUsedCodex.id);
        if (lockedAccount) {
          log("debug", `时间窗口内，复用Codex账号: ${lockedAccount.email}`);
          account = lockedAccount;
        } else {
          account = this.selectNextCodexAccount(accounts);
        }
      } else {
        account = this.selectNextCodexAccount(accounts);
      }
    } else {
      account = this.selectNextCodexAccount(accounts);
    }

    // 确保Token有效
    try {
      account = await this.codexAuth.ensureValidToken(account);
      // 更新存储
      await this.storage.saveCodexAccount(account);
    } catch (error) {
      log("error", `Codex Token刷新失败: ${account.email}`, error);
      throw error;
    }

    // 更新最后使用的账号
    this.lastUsedCodex = { id: account.id, time: Date.now() };

    return {
      accessToken: account.token.access_token,
      email: account.email,
      account,
    };
  }

  /**
   * 选择下一个Codex账号（轮换）
   */
  private selectNextCodexAccount(accounts: CodexAccount[]): CodexAccount {
    const index = this.codexIndex % accounts.length;
    this.codexIndex++;
    const account = accounts[index];
    log("info", `切换到Codex账号: ${account.email}`);
    return account;
  }

  // ==================== 通用方法 ====================

  /**
   * 标记账号不可用（触发强制轮换）
   */
  markAntigravityAccountFailed(accountId: string): void {
    if (this.lastUsedAntigravity?.id === accountId) {
      this.lastUsedAntigravity = null;
    }
    log("warn", `Antigravity账号已标记为失败，下次将强制轮换: ${accountId}`);
  }

  /**
   * 标记Codex账号不可用
   */
  markCodexAccountFailed(accountId: string): void {
    if (this.lastUsedCodex?.id === accountId) {
      this.lastUsedCodex = null;
    }
    log("warn", `Codex账号已标记为失败，下次将强制轮换: ${accountId}`);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    antigravity: { total: number; currentIndex: number };
    codex: { total: number; currentIndex: number };
  } {
    const storeStats = this.storage.getStats();
    return {
      antigravity: {
        total: storeStats.antigravity,
        currentIndex: this.antigravityIndex,
      },
      codex: {
        total: storeStats.codex,
        currentIndex: this.codexIndex,
      },
    };
  }
}

/**
 * 创建Token管理器
 */
export function createTokenManager(storage: AccountStorage): TokenManager {
  return new TokenManager(storage);
}