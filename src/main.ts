import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { loadConfig, getConfig } from "./config.ts";
import { AccountStorage, createAccountStorage } from "./auth/store.ts";
import { TokenManager, createTokenManager } from "./auth/token_manager.ts";
import { createApiRoutes } from "./routes/api.ts";
import { createManagementRoutes } from "./routes/management.ts";
import { log as appLog } from "./utils/http.ts";

/**
 * 主程序入口
 */
async function main(): Promise<void> {
  // 加载配置
  const configPath = Deno.args.find((arg) => arg.startsWith("--config="))?.split("=")[1];
  await loadConfig(configPath);
  const config = getConfig();

  appLog("info", "正在启动 Antigravity Deno API 服务...");
  appLog("info", `数据目录: ${config.dataDir}`);
  appLog("info", `账号目录: ${config.authDir}`);

  // 初始化存储和Token管理器
  const storage = await createAccountStorage(config.authDir);
  const tokenManager = createTokenManager(storage);

  // 显示账号统计
  const stats = storage.getStats();
  appLog("info", `已加载 Antigravity 账号: ${stats.antigravity}`);
  appLog("info", `已加载 Codex 账号: ${stats.codex}`);

  // 创建Hono应用
  const app = new Hono();

  // 全局中间件
  app.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["*"],
  }));

  if (config.debug) {
    app.use("*", logger());
  }

  // 挂载API路由
  const apiRoutes = createApiRoutes(tokenManager);
  app.route("/", apiRoutes);

  // 挂载管理端路由
  const managementRoutes = createManagementRoutes(storage, tokenManager);
  app.route("/manage", managementRoutes);

  // 错误处理
  app.onError((err, c) => {
    appLog("error", `请求错误: ${err}`);
    return c.json(
      {
        error: {
          message: err.message || "Internal Server Error",
          type: "server_error",
        },
      },
      500
    );
  });

  // 404处理
  app.notFound((c) => {
    return c.json(
      {
        error: {
          message: "Not Found",
          type: "not_found",
        },
      },
      404
    );
  });

  // 启动服务器
  const port = config.port;
  const hostname = config.host;

  appLog("info", `服务启动于 http://${hostname}:${port}`);
  appLog("info", `API端点: http://${hostname}:${port}/v1/chat/completions`);
  appLog("info", `管理端点: http://${hostname}:${port}/manage`);
  
  if (config.apiKeys.length > 0) {
    appLog("info", `已配置 ${config.apiKeys.length} 个 API Key`);
  } else {
    appLog("warn", "未配置 API Key，任何请求都将被接受");
  }

  Deno.serve(
    {
      port,
      hostname,
      onListen: () => {
        appLog("info", "服务器已就绪");
      },
    },
    app.fetch
  );
}

// 运行主程序
if (import.meta.main) {
  main().catch((err) => {
    console.error("启动失败:", err);
    Deno.exit(1);
  });
}

export { main };