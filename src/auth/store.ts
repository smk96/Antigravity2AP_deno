import { join } from "@std/path";
import type { AntigravityAccount, CodexAccount, AccountStore } from "../types.ts";
import { log } from "../utils/http.ts";
import { isDeployEnvironment } from "../config.ts";

/**
 * 账号存储管理
 */
export class AccountStorage {
  private authDir: string;
  private accounts: AccountStore;
  private saveDebounceTimer: number | null = null;
  private kv: Deno.Kv | null = null;

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
    if (isDeployEnvironment()) {
      this.kv = await Deno.openKv();
      await this.loadAllAccountsKv();
      return;
    }

    const { ensureDir } = await import("@std/fs");
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
   * 从 Deno KV 加载所有账号
   */
  private async loadAllAccountsKv(): Promise<void> {
    if (!this.kv) return;

    for await (const entry of this.kv.list<AntigravityAccount>({ prefix: ["antigravity"] })) {
      this.accounts.antigravity.set(entry.value.id, entry.value);
    }
    for await (const entry of this.kv.list<CodexAccount>({ prefix: ["codex"] })) {
      this.accounts.codex.set(entry.value.id, entry.value);
    }

    log("info", `已加载 ${this.accounts.antigravity.size} 个Antigravity账号 (KV)`);
    log("info", `已加载 ${this.accounts.codex.size} 个Codex账号 (KV)`);
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

    if (this.kv) {
      await this.kv.set(["antigravity", account.id], account);
    } else {
      const filename = this.sanitizeFilename(`${account.email}.json`);
      const filepath = join(this.authDir, "antigravity", filename);
      await Deno.writeTextFile(filepath, JSON.stringify(account, null, 2));
    }

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

    if (this.kv) {
      await this.kv.delete(["antigravity", id]);
    } else {
      const filename = this.sanitizeFilename(`${account.email}.json`);
      const filepath = join(this.authDir, "antigravity", filename);
      try {
        await Deno.remove(filepath);
      } catch {
        // 忽略删除失败
      }
    }

    log("info", `Antigravity账号已删除: ${account.email}`);
    return true;
  }

  // ==================== Codex账号操作 ====================

  /**
   * 保存Codex账号
   */
  async saveCodexAccount(account: CodexAccount): Promise<void> {
    this.accounts.codex.set(account.id, account);

    if (this.kv) {
      await this.kv.set(["codex", account.id], account);
    } else {
      const filename = this.sanitizeFilename(`codex-${account.email}.json`);
      const filepath = join(this.authDir, "codex", filename);
      await Deno.writeTextFile(filepath, JSON.stringify(account, null, 2));
    }

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

    if (this.kv) {
      await this.kv.delete(["codex", id]);
    } else {
      const filename = this.sanitizeFilename(`codex-${account.email}.json`);
      const filepath = join(this.authDir, "codex", filename);
      try {
        await Deno.remove(filepath);
      } catch {
        // 忽略删除失败
      }
    }

    log("info", `Codex账号已删除: ${account.email}`);
    return true;
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
export async function createAccountStorage(authDir: string): Promise<AccountStorage> {
  const storage = new AccountStorage(authDir);
  await storage.init();
  return storage;
}