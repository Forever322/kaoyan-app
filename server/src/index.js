import 'dotenv/config';
import { assertMigrationsCurrent, closeDB, migrate } from './db/index.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 3000);
const shouldRunMigrations = process.env.RUN_MIGRATIONS_ON_START === 'true'
  || (process.env.NODE_ENV !== 'production' && process.env.RUN_MIGRATIONS_ON_START !== 'false');

async function bootstrap() {
  // Production deployments run db:migrate as a one-shot Compose service before
  // starting the API. Development remains convenient by migrating on start.
  if (shouldRunMigrations) await migrate();
  else await assertMigrationsCurrent();

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`[Server] 考研择校助手 API 已启动 → http://localhost:${PORT}`);
    console.log(`[Server] 健康检查 → http://localhost:${PORT}/api/health`);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Server] 收到 ${signal}，正在停止...`);
    server.close(async () => {
      try { await closeDB(); } catch (error) { console.error('[Server] MySQL 连接关闭失败:', error?.message || error); }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  console.error('[Server] 启动失败:', error?.message || error);
  process.exit(1);
});
