import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { AntigravityAccount, CodexAccount, AccountStore } from "../types.ts";
import { log } from "../utils/http.ts";

/**
 * 账号存储管理
 */
export class AccountStorage {
  private authDir: string;
  private accounts: AccountStore;
  private saveDebounceTimer: number | null = null;

  constructor(authDir: string) {
    this.authDir = authDir;
    this.accounts = {
      antigravity: new Map(),
      codex: new Map(),
    };
  }

  /**
   * 初始化存储（加载所有账号）
   */
  async init(): Promise<void> {
    await ensureDir(this.authDir);
    await ensureDir(join(this.authDir, "antigravity"));
    await ensureDir(join(this.authDir, "codex"));
    
    await this.loadAllAccounts();
  }

  /**
   * 加载所有账号
   */
  private async loadAllAccounts(): Promise<void> {
    await this.loadAntigravityAccounts();
    await this.loadCodexAccounts();
    
    log("info", `已加载 ${this.accounts.antigravity.size} 个Antigravity账号`);
    log("info", `已加载 ${this.accounts.codex.size} 个Codex账号`);
  }

  /**
   * 加载Antigravity账号
   */
  private async loadAntigravityAccounts(): Promise<void> {
    const dir = join(this.authDir, "antigravity");
    
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        
        try {
          const content = await Deno.readTextFile(join(dir, entry.name));
          const account = JSON.parse(content) as AntigravityAccount;
          this.accounts.antigravity.set(account.id, account);
        } catch (error) {
          log("warn", `加载Antigravity账号失败: ${entry.name}`, error);
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        log("error", "读取Antigravity账号目录失败", error);
      }
    }
  }

  /**
   * 加载Codex账号
   */
  private async loadCodexAccounts(): Promise<void> {
    const dir = join(this.authDir, "codex");
    
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        
        try {
          const content = await Deno.readTextFile(join(dir, entry.name));
          const account = JSON.parse(content) as CodexAccount;
          this.accounts.codex.set(account.id, account);
        } catch (error) {
          log("warn", `加载Codex账号失败: ${entry.name}`, error);
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        log("error", "读取Codex账号目录失败", error);
      }
    }
  }

  // ==================== Antigravity账号操作 ====================

  /**
   * 保存Antigravity账号
   */
  async saveAntigravityAccount(account: AntigravityAccount): Promise<void> {
    this.accounts.antigravity.set(account.id, account);
    
    const filename = this.sanitizeFilename(`${account.email}.json`);
    const filepath = join(this.authDir, "antigravity", filename);
    
    await Deno.writeTextFile(filepath, JSON.stringify(account, null, 2));
    log("info", `Antigravity账号已保存: ${account.email}`);
  }

  /**
   * 获取Antigravity账号
   */
  getAntigravityAccount(id: string): AntigravityAccount | undefined {
    return this.accounts.antigravity.get(id);
  }

  /**
   * 获取所有Antigravity账号
   */
  getAllAntigravityAccounts(): AntigravityAccount[] {
    return Array.from(this.accounts.antigravity.values());
  }

  /**
   * 删除Antigravity账号
   */
  async deleteAntigravityAccount(id: string): Promise<boolean> {
    const account = this.accounts.antigravity.get(id);
    if (!account) return false;
    
    this.accounts.antigravity.delete(id);
    
    const filename = this.sanitizeFilename(`${account.email}.json`);
    const filepath = join(this.authDir, "antigravity", filename);
    
    try {
      await Deno.remove(filepath);
      log("info", `Antigravity账号已删除: ${account.email}`);
      return true;
    } catch {
      return false;
    }
  }

  // ==================== Codex账号操作 ====================

  /**
   * 保存Codex账号
   */
  async saveCodexAccount(account: CodexAccount): Promise<void> {
    this.accounts.codex.set(account.id, account);
    
    const filename = this.sanitizeFilename(`codex-${account.email}.json`);
    const filepath = join(this.authDir, "codex", filename);
    
    await Deno.writeTextFile(filepath, JSON.stringify(account, null, 2));
    log("info", `Codex账号已保存: ${account.email}`);
  }

  /**
   * 获取Codex账号
   */
  getCodexAccount(id: string): CodexAccount | undefined {
    return this.accounts.codex.get(id);
  }

  /**
   * 获取所有Codex账号
   */
  getAllCodexAccounts(): CodexAccount[] {
    return Array.from(this.accounts.codex.values());
  }

  /**
   * 删除Codex账号
   */
  async deleteCodexAccount(id: string): Promise<boolean> {
    const account = this.accounts.codex.get(id);
    if (!account) return false;
    
    this.accounts.codex.delete(id);
    
    const filename = this.sanitizeFilename(`codex-${account.email}.json`);
    const filepath = join(this.authDir, "codex", filename);
    
    try {
      await Deno.remove(filepath);
      log("info", `Codex账号已删除: ${account.email}`);
      return true;
    } catch {
      return false;
    }
  }

  // ==================== 工具方法 ====================

  /**
   * 清理文件名
   */
  private sanitizeFilename(filename: string): string {
    return filename.replace(/[<>:"/\\|?*@]/g, "_");
  }

  /**
   * 获取账号统计
   */
  getStats(): { antigravity: number; codex: number } {
    return {
      antigravity: this.accounts.antigravity.size,
      codex: this.accounts.codex.size,
    };
  }
}

/**
 * 创建账号存储实例
 */
export function createAccountStorage(authDir: string): AccountStorage {
  return new AccountStorage(authDir);
}