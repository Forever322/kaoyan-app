import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createAdminDatabaseRouter } from './admin-database.js';

test('数据库运维接口只返回只读健康与容量摘要', async () => {
  const app = express();
  app.use('/api/admin', createAdminDatabaseRouter({
    database: async () => ({
      one: async () => ({ database_name: 'kaoyan', server_version: '8.4', checked_at: '2026-08-09 10:00:00.000' }),
      all: async (sql) => (sql.includes('schema_migrations')
        ? [{ version: '004-admin-rbac-and-agent-controls', applied_at: '2026-08-09 10:00:00.000' }]
        : [{ table_name: 'users', table_rows: '7', data_length: '1024', index_length: '512', update_time: null }]),
    }),
    authenticate: async () => ({ id: 1, role: 'super_admin' }),
  }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/database/status`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.databaseName, 'kaoyan');
    assert.equal(payload.migrationCount, 1);
    assert.deepEqual(payload.tables[0], { name: 'users', estimatedRows: 7, dataBytes: 1024, indexBytes: 512, updatedAt: null });
    assert.equal(Object.hasOwn(payload, 'password'), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
