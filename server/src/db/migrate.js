// 数据库迁移 CLI 入口
// 用法: node src/db/migrate.js [--reset]

import { migrate, reset } from './index.js';

const shouldReset = process.argv.includes('--reset');

if (shouldReset) {
    console.log('[Migrate] 重置数据库...');
    reset();
} else {
    console.log('[Migrate] 执行迁移...');
    migrate();
}

console.log('[Migrate] 完成');
