import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { adminUniversitySnapshot, createAdminCatalogRouter, synchronizeLegacyCatalogStatus } from './admin-catalog.js';

const superAdmin = { id: 1, username: 'root', role: 'super_admin', status: 'active' };
const university = {
  id: 7, name: '示例大学', official_name: '', institution_code: '10007', founded_year: null,
  administrative_level: '', affiliation: '', is_double_first_class: null, is_985: 0, is_211: 1,
  tags_json: '[]', province: '北京', city: '北京', zone: 'A', level: '211', type: '理工',
  source_document_id: null, verification_status: 'verified', catalog_status: 'active',
  created_at: '2026-08-09 10:00:00.000', updated_at: '2026-08-09 10:00:00.000',
};

async function withRouter(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}/api/admin`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('院校列表使用管理员鉴权、分页和参数绑定', async () => {
  const calls = [];
  const router = createAdminCatalogRouter({
    database: async () => ({
      one: async (sql, params) => {
        calls.push({ sql, params });
        return { total: 1 };
      },
      all: async (sql, params) => {
        calls.push({ sql, params });
        return [university];
      },
    }),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/universities?keyword=%E5%8C%97%E4%BA%AC&catalogStatus=active&page=2&pageSize=5`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.page, 2);
    assert.equal(body.total, 1);
    assert.equal(body.data[0].institutionCode, '10007');
    assert.equal(body.data[0].verificationStatus, 'verified');
  });
  assert.deepEqual(calls[0].params, ['%北京%', '%北京%', '%北京%', '%北京%', 'active']);
  assert.match(calls[1].sql, /LIMIT 5 OFFSET 5/);
});

test('院校写入拒绝未知字段，归档不会硬删除关联数据', async () => {
  const invalidRouter = createAdminCatalogRouter({ database: async () => ({}), authenticate: async () => superAdmin });
  await withRouter(invalidRouter, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/universities`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试大学', province: '北京', rawSql: 'DROP TABLE users' }),
    });
    assert.equal(response.status, 400);
  });

  const calls = [];
  const db = {
    transaction: async (task) => task(db),
    one: async (sql) => {
      if (sql.includes('FROM universities')) return { ...university, catalog_status: calls.some((call) => call.sql.includes("SET catalog_status='archived'")) ? 'archived' : 'active' };
      if (sql.includes('FROM uni_details')) return null;
      if (sql.includes('FROM programs') || sql.includes('FROM uni_photos') || sql.includes('FROM admission_scores')) return { total: 0 };
      return null;
    },
    execute: async (sql, params) => { calls.push({ sql, params }); return { affectedRows: 1 }; },
  };
  const router = createAdminCatalogRouter({ database: async () => db, authenticate: async () => superAdmin, audit: async () => {} });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/universities/7`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.archived, true);
    assert.equal(body.university.catalogStatus, 'archived');
  });
  assert.ok(calls.some((call) => call.sql.includes("UPDATE universities SET catalog_status='archived'")));
  assert.equal(calls.some((call) => /DELETE\s+FROM\s+universities/i.test(call.sql)), false);
});

test('院校审计快照保留有界的详情变更依据', () => {
  const snapshot = adminUniversitySnapshot({
    id: 7, name: '示例大学', province: '北京', city: '北京', zone: 'A', level: '211', type: '理工',
    institutionCode: '10007', verificationStatus: 'verified', catalogStatus: 'active',
    detail: {
      englishName: 'Example University', address: '北京市示例路 1 号', website: 'https://example.test', phone: '010-12345678',
      ranking: '', description: '更新后的院校简介', advantages: '', disadvantages: '', pros: ['科研资源丰富'], cons: [], features: '特色学科说明',
      verificationStatus: 'verified', catalogStatus: 'active',
    },
  });
  assert.equal(snapshot.detail.address, '北京市示例路 1 号');
  assert.deepEqual(snapshot.detail.pros, ['科研资源丰富']);
  assert.equal(snapshot.detail.features, '特色学科说明');
  const fullWidth = '汉'.repeat(30_000);
  const bounded = adminUniversitySnapshot({
    id: 8, name: '多字节测试大学', province: '北京', city: '', zone: 'A', level: '双非', type: '综合',
    institutionCode: '', verificationStatus: 'pending', catalogStatus: 'active',
    detail: {
      englishName: fullWidth, address: fullWidth, website: fullWidth, phone: fullWidth, ranking: fullWidth,
      description: fullWidth, advantages: fullWidth, disadvantages: fullWidth,
      pros: Array.from({ length: 60 }, () => fullWidth), cons: Array.from({ length: 60 }, () => fullWidth),
      features: fullWidth, verificationStatus: 'pending', catalogStatus: 'active',
    },
  });
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') < 12 * 1024);
});

test('详情 TEXT 字段按 UTF-8 字节数拒绝超大多字节输入', async () => {
  const router = createAdminCatalogRouter({ database: async () => ({}), authenticate: async () => superAdmin });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/universities`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试大学', province: '北京', detail: { description: '汉'.repeat(20_001) } }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /字节/);
  });
});

test('院校归档与恢复会同步 legacy 子资料的可见状态', async () => {
  const calls = [];
  await synchronizeLegacyCatalogStatus({
    execute: async (sql, params) => { calls.push({ sql, params }); },
  }, 7, 'active');
  assert.deepEqual(calls.map((call) => call.params), [
    ['active', 7], ['active', 7], ['active', 7], ['active', 7],
  ]);
  assert.deepEqual(calls.map((call) => call.sql.match(/UPDATE (\w+)/)?.[1]), [
    'uni_details', 'uni_photos', 'admission_scores', 'uni_requirements',
  ]);
});
