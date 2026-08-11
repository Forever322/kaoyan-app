import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import initSqlJs from 'sql.js';
import * as XLSX from 'xlsx';
import { checksumRows, createAdminDatabaseRouter, normalizeDatabaseRow } from './admin-database.js';

const superAdmin = { id: 1, username: 'root', role: 'super_admin' };
const normalAdmin = { id: 2, username: 'operator', role: 'admin' };

test('审核校验和不受 JSON 对象键顺序影响', () => {
  assert.equal(checksumRows([{ name: '测试大学', province: '北京' }]), checksumRows([{ province: '北京', name: '测试大学' }]));
});

test('数值与日期在进入审核校验和前按 MySQL 类型严格规范化', () => {
  const makeColumn = (name, dataType, columnType, extra = {}) => ({
    name, dataType, columnType, nullable: false, defaultValue: null,
    primaryKey: false, autoIncrement: false, sensitive: false, maxLength: null,
    numericPrecision: null, numericScale: null, ...extra,
  });
  const meta = {
    tableName: 'universities',
    columns: [
      makeColumn('integer_value', 'int', 'int'),
      makeColumn('large_value', 'bigint', 'bigint unsigned'),
      makeColumn('ratio', 'decimal', 'decimal(5,2)', { numericPrecision: 5, numericScale: 2 }),
      makeColumn('is_active', 'tinyint', 'tinyint(1)'),
      makeColumn('published_at', 'date', 'date'),
    ],
  };
  assert.throws(() => normalizeDatabaseRow({ integer_value: '1.5' }, meta, { importMode: true }), /必须是整数/);
  assert.equal(normalizeDatabaseRow({ large_value: '9007199254740993' }, meta, { importMode: true }).large_value, '9007199254740993');
  assert.throws(() => normalizeDatabaseRow({ ratio: '1234.567' }, meta, { importMode: true }), /DECIMAL\(5,2\)/);
  assert.throws(() => normalizeDatabaseRow({ is_active: 2 }, meta, { importMode: true }), /布尔值或 0\/1/);
  assert.throws(() => normalizeDatabaseRow({ published_at: '2026-02-30' }, meta, { importMode: true }), /有效日历日期/);
});

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

function adminDbStub({ calls = [], rows = [], tableName = 'users', columns: requestedColumns = null } = {}) {
  const table = { table_name: tableName, table_rows: '7', data_length: '1024', index_length: '512', update_time: null };
  const columns = requestedColumns || [
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
      if (sql.includes(`SELECT * FROM \`${tableName}\``)) return rows[0] || null;
      return null;
    },
    all: async (sql, params) => {
      calls.push({ kind: 'all', sql, params });
      if (sql.includes('schema_migrations')) return [{ version: '004-admin-rbac-and-agent-controls', applied_at: '2026-08-09 10:00:00.000' }];
      if (sql.includes('information_schema.tables')) return [table];
      if (sql.includes('information_schema.columns')) return columns;
      if (sql.includes(`SELECT * FROM \`${tableName}\``)) return rows;
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
    assert.deepEqual(payload.tables[0], {
      name: 'users', readable: false, writable: false,
      estimatedRows: 7, dataBytes: 1024, indexBytes: 512, updatedAt: null,
    });
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

test('账号等私密控制表拒绝通用读取和写入', async () => {
  const rows = [{ id: 1, username: 'kakcraftaia', password_hash: 'secret-hash', role: 'super_admin' }];
  const router = createAdminDatabaseRouter({
    database: async () => adminDbStub({ rows }),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const list = await fetch(`${baseUrl}/database/tables/users/rows?pageSize=5`);
    assert.equal(list.status, 403);
    assert.match((await list.json()).error, /私密业务数据|控制配置/);

    const invalid = await fetch(`${baseUrl}/database/tables/users/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ row: { username: 'x', password_hash: 'never' } }),
    });
    assert.equal(invalid.status, 403);
    assert.match((await invalid.json()).error, /领域管理接口/);
  });
});

test('CSV 导入默认 dry-run，仅返回预览和后续模型审核挂点', async () => {
  const calls = [];
  const columns = [
    { column_name: 'id', data_type: 'bigint', column_type: 'bigint unsigned', is_nullable: 'NO', column_default: null, column_key: 'PRI', extra: 'auto_increment' },
    { column_name: 'name', data_type: 'varchar', column_type: 'varchar(191)', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
    { column_name: 'province', data_type: 'varchar', column_type: 'varchar(64)', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
  ];
  const router = createAdminDatabaseRouter({
    database: async () => {
      const db = adminDbStub({ calls, tableName: 'universities', columns });
      db.one = async (sql, params) => {
        calls.push({ kind: 'one', sql, params });
        if (sql.includes('information_schema.tables')) return { table_name: 'universities', table_rows: '0', data_length: '0', index_length: '0', update_time: null };
        return null;
      };
      return db;
    },
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database/tables/universities/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        format: 'csv',
        content: 'name,province\n测试大学,北京\n',
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dryRun, true);
    assert.equal(body.rowCount, 1);
    assert.equal(body.preview[0].name, '测试大学');
    assert.equal(body.review.status, 'preview_only');
  });
  assert.equal(calls.some((call) => call.kind === 'execute'), false);
});

test('SQLite DB 导入读取同名表并默认 dry-run', async () => {
  const columns = [
    { column_name: 'id', data_type: 'bigint', column_type: 'bigint unsigned', is_nullable: 'NO', column_default: null, column_key: 'PRI', extra: 'auto_increment' },
    { column_name: 'name', data_type: 'varchar', column_type: 'varchar(191)', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
    { column_name: 'province', data_type: 'varchar', column_type: 'varchar(64)', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
  ];
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('CREATE TABLE universities (id INTEGER PRIMARY KEY, name TEXT, province TEXT)');
  sqlite.run('INSERT INTO universities (id, name, province) VALUES (1, ?, ?)', ['SQLite 大学', '北京']);
  const contentBase64 = Buffer.from(sqlite.export()).toString('base64');
  sqlite.close();

  const router = createAdminDatabaseRouter({
    database: async () => adminDbStub({ tableName: 'universities', columns }),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database/tables/universities/import`, {
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
    assert.equal(body.preview[0].name, 'SQLite 大学');
  });
});

test('已修复版本的 XLSX 解析器可生成受控导入预览', async () => {
  assert.equal(XLSX.version, '0.20.3');
  const columns = [
    { column_name: 'id', data_type: 'bigint', column_type: 'bigint unsigned', is_nullable: 'NO', column_default: null, column_key: 'PRI', extra: 'auto_increment' },
    { column_name: 'name', data_type: 'varchar', column_type: 'varchar(191)', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
    { column_name: 'province', data_type: 'varchar', column_type: 'varchar(64)', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { name: '表格大学', province: '上海' },
  ]), 'universities');
  const contentBase64 = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })).toString('base64');
  const router = createAdminDatabaseRouter({
    database: async () => adminDbStub({ tableName: 'universities', columns }),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database/tables/universities/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'xlsx', contentBase64 }),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.dryRun, true);
    assert.equal(body.rowCount, 1);
    assert.equal(body.preview[0].name, '表格大学');
  });
});

test('导出不会包含敏感列内容', async () => {
  const rows = [{ id: 1, name: '测试大学', api_key: 'secret-key' }];
  const columns = [
    { column_name: 'id', data_type: 'bigint', column_type: 'bigint unsigned', is_nullable: 'NO', column_default: null, column_key: 'PRI', extra: 'auto_increment' },
    { column_name: 'name', data_type: 'varchar', column_type: 'varchar(191)', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
    { column_name: 'api_key', data_type: 'varchar', column_type: 'varchar(255)', is_nullable: 'YES', column_default: null, column_key: '', extra: '' },
  ];
  const router = createAdminDatabaseRouter({
    database: async () => adminDbStub({ rows, tableName: 'universities', columns }),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database/tables/universities/export?format=csv&limit=10`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /name/);
    assert.doesNotMatch(body, /api_key/);
    assert.doesNotMatch(body, /secret-key/);
  });
});

test('兼容导入接口拒绝 dryRun=false，控制表写入也不会执行 SQL', async () => {
  const calls = [];
  const columns = [
    { column_name: 'id', data_type: 'bigint', column_type: 'bigint unsigned', is_nullable: 'NO', column_default: null, column_key: 'PRI', extra: 'auto_increment' },
    { column_name: 'name', data_type: 'varchar', column_type: 'varchar(191)', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
    { column_name: 'province', data_type: 'varchar', column_type: 'varchar(64)', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
  ];
  const router = createAdminDatabaseRouter({
    database: async () => adminDbStub({ calls, tableName: 'universities', columns }),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const directImport = await fetch(`${baseUrl}/database/tables/universities/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        format: 'csv', dryRun: false, content: 'name,province\n测试大学,北京\n',
      }),
    });
    assert.equal(directImport.status, 409);
    assert.match((await directImport.json()).error, /直接导入已关闭/);

    const controlWrite = await fetch(`${baseUrl}/database/tables/agent_configurations/rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ row: { name: 'unsafe', province: '北京' } }),
    });
    assert.equal(controlWrite.status, 403);
    assert.match((await controlWrite.json()).error, /领域管理接口/);
  });
  assert.equal(calls.some((call) => call.kind === 'execute' && /^\s*(?:INSERT|UPDATE|DELETE)\s/iu.test(call.sql)), false);
});

test('非空数值字段的空白导入值不会被静默转换成 0', async () => {
  const columns = [
    { column_name: 'id', data_type: 'bigint', column_type: 'bigint unsigned', is_nullable: 'NO', column_default: null, column_key: 'PRI', extra: 'auto_increment' },
    { column_name: 'year', data_type: 'smallint', column_type: 'smallint unsigned', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
    { column_name: 'score', data_type: 'smallint', column_type: 'smallint unsigned', is_nullable: 'NO', column_default: null, column_key: '', extra: '' },
  ];
  const router = createAdminDatabaseRouter({
    database: async () => adminDbStub({ tableName: 'national_lines', columns }),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database/tables/national_lines/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'csv', content: 'year,score\n2026,\n' }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /score.*不能为空/);
  });
});
