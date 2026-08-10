import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import initSqlJs from 'sql.js';
import { createAdminDatabaseRouter } from './admin-database.js';

const superAdmin = { id: 1, username: 'root', role: 'super_admin' };
const normalAdmin = { id: 2, username: 'operator', role: 'admin' };

async function withRouter(router, run) {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use('/api/admin', router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    return await run(`http://127.0.0.1:${server.address().port}/api/admin`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function adminDbStub({ calls = [], rows = [] } = {}) {
  const table = { table_name: 'users', table_rows: '7', data_length: '1024', index_length: '512', update_time: null };
  const columns = [
    { column_name: 'id', data_type: 'bigint', column_type: 'bigint unsigned', is_nullable: 'NO', column_default: null, column_key: 'PRI', extra: 'auto_increment' },
    { column_name: 'username', data_type: 'varchar', column_type: 'varchar(64)', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
    { column_name: 'password_hash', data_type: 'varchar', column_type: 'varchar(255)', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
    { column_name: 'role', data_type: 'varchar', column_type: 'varchar(32)', is_nullable: 'NO', column_default: 'user', column_key: '', extra: '' },
  ];
  const db = {
    transaction: async (callback) => callback(db),
    one: async (sql, params) => {
      calls.push({ kind: 'one', sql, params });
      if (sql.includes('DATABASE() AS database_name')) return { database_name: 'kaoyan', server_version: '8.4', checked_at: '2026-08-09 10:00:00.000' };
      if (sql.includes('information_schema.tables') && sql.includes('table_name=?')) return table;
      if (sql.includes('COUNT(*) AS total')) return { total: String(rows.length) };
      if (sql.includes('SELECT * FROM `users`')) return rows[0] || null;
      return null;
    },
    all: async (sql, params) => {
      calls.push({ kind: 'all', sql, params });
      if (sql.includes('schema_migrations')) return [{ version: '004-admin-rbac-and-agent-controls', applied_at: '2026-08-09 10:00:00.000' }];
      if (sql.includes('information_schema.tables')) return [table];
      if (sql.includes('information_schema.columns')) return columns;
      if (sql.includes('SELECT * FROM `users`')) return rows;
      return [];
    },
    execute: async (sql, params) => {
      calls.push({ kind: 'execute', sql, params });
      return { affectedRows: 1, insertId: 9 };
    },
  };
  return db;
}

test('数据库运维接口返回健康、迁移和容量摘要', async () => {
  const router = createAdminDatabaseRouter({
    database: async () => adminDbStub(),
    authenticate: async () => normalAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database/status`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.databaseName, 'kaoyan');
    assert.equal(payload.migrationCount, 1);
    assert.deepEqual(payload.tables[0], { name: 'users', estimatedRows: 7, dataBytes: 1024, indexBytes: 512, updatedAt: null });
    assert.equal(Object.hasOwn(payload, 'password'), false);
  });
});

test('直接表数据操作仅允许超级管理员访问', async () => {
  const router = createAdminDatabaseRouter({
    database: async () => adminDbStub(),
    authenticate: async () => normalAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database/tables/users/rows`);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /超级管理员/);
  });
});

test('表行查询会脱敏敏感列，写入拒绝敏感字段', async () => {
  const rows = [{ id: 1, username: 'kakcraftaia', password_hash: 'secret-hash', role: 'super_admin' }];
  const router = createAdminDatabaseRouter({
    database: async () => adminDbStub({ rows }),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const list = await fetch(`${baseUrl}/database/tables/users/rows?pageSize=5`);
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.equal(body.data[0].password_hash, '[redacted]');

    const invalid = await fetch(`${baseUrl}/database/tables/users/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ row: { username: 'x', password_hash: 'never' } }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /不允许/);
  });
});

test('CSV 导入默认 dry-run，仅返回预览和后续模型审核挂点', async () => {
  const calls = [];
  const router = createAdminDatabaseRouter({
    database: async () => {
      const db = adminDbStub({ calls });
      db.one = async (sql, params) => {
        calls.push({ kind: 'one', sql, params });
        if (sql.includes('information_schema.tables')) return { table_name: 'users', table_rows: '0', data_length: '0', index_length: '0', update_time: null };
        return null;
      };
      return db;
    },
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database/tables/users/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        format: 'csv',
        content: 'username,role\nnew_admin,admin\n',
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dryRun, true);
    assert.equal(body.rowCount, 1);
    assert.equal(body.preview[0].username, 'new_admin');
    assert.equal(body.review.modelReady, false);
  });
  assert.equal(calls.some((call) => call.kind === 'execute'), false);
});

test('SQLite DB 导入读取同名表并默认 dry-run', async () => {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, role TEXT)');
  sqlite.run('INSERT INTO users (id, username, role) VALUES (1, ?, ?)', ['sqlite_admin', 'admin']);
  const contentBase64 = Buffer.from(sqlite.export()).toString('base64');
  sqlite.close();

  const router = createAdminDatabaseRouter({
    database: async () => adminDbStub(),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database/tables/users/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        format: 'db',
        contentBase64,
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dryRun, true);
    assert.equal(body.rowCount, 1);
    assert.equal(body.preview[0].username, 'sqlite_admin');
  });
});

test('导出不会包含敏感列内容', async () => {
  const rows = [{ id: 1, username: 'root', password_hash: 'secret-hash', role: 'super_admin' }];
  const router = createAdminDatabaseRouter({
    database: async () => adminDbStub({ rows }),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database/tables/users/export?format=csv&limit=10`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /username/);
    assert.doesNotMatch(body, /password_hash/);
    assert.doesNotMatch(body, /secret-hash/);
  });
});
