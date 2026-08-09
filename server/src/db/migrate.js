// MySQL migration CLI.
// Usage: node src/db/migrate.js [--reset]

import { closeDB, migrate, reset } from './index.js';

const shouldReset = process.argv.includes('--reset');

try {
  if (shouldReset) {
    console.log('[Migrate] 重置 MySQL 数据库...');
    await reset();
  } else {
    console.log('[Migrate] 执行 MySQL 迁移...');
    await migrate();
  }
  console.log('[Migrate] 完成');
} catch (error) {
  console.error('[Migrate] 失败:', error?.message || error);
  process.exitCode = 1;
} finally {
  await closeDB();
}
