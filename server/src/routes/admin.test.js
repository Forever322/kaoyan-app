import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createAdminRouter, parseAdminAuditQuery, parseAdminUsersQuery } from './admin.js';

const regularUser = {
  id: 12,
  username: 'candidate12',
  email: 'candidate@example.test',
  avatar_url: '',
  role: 'user',
  status: 'active',
  last_login_at: '2026-08-09 10:00:00.000',
  created_at: '2026-08-01 10:00:00.000',
  updated_at: '2026-08-09 10:00:00.000',
  favorite_count: '2',
  study_session_count: '4',
  agent_run_count: '1',
  password_hash: 'must-never-be-returned',
};

const superAdmin = { id: 1, username: 'root', role: 'super_admin', status: 'active' };

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
    return await run(`http://127.0.0.1:${port}/api/admin`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('管理员用户列表有稳定分页且绝不返回密码哈希或令牌', async () => {
  const calls = [];
  const router = createAdminRouter({
    database: async () => ({
      one: async (sql, params) => {
        calls.push({ kind: 'one', sql, params });
        assert.match(sql, /SELECT COUNT\(\*\) AS total FROM users u/);
        return { total: '1' };
      },
      all: async (sql, params) => {
        calls.push({ kind: 'all', sql, params });
        assert.match(sql, /FROM users u/);
        return [regularUser];
      },
    }),
    authenticate: async () => superAdmin,
  });

  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/users?status=active&keyword=candidate&page=2&pageSize=5`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.page, 2);
    assert.equal(body.pageSize, 5);
    assert.equal(body.total, 1);
    assert.equal(body.data[0].username, 'candidate12');
    assert.equal(body.data[0].favoriteCount, 2);
    assert.equal(Object.hasOwn(body.data[0], 'password_hash'), false);
    assert.equal(Object.hasOwn(body.data[0], 'passwordHash'), false);
    assert.equal(Object.hasOwn(body.data[0], 'accessToken'), false);
  });
  assert.deepEqual(calls[0].params, ['active', '%candidate%', '%candidate%']);
  assert.match(calls[1].sql, /LIMIT 5 OFFSET 5$/);
});

test('普通管理员不能提升角色，超级管理员调整账号状态会撤销令牌并写入审计', async () => {
  const noPrivilegeRouter = createAdminRouter({
    database: async () => ({ one: async () => regularUser }),
    authenticate: async () => ({ id: 2, username: 'operator', role: 'admin', status: 'active' }),
  });
  await withRouter(noPrivilegeRouter, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/users/12`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(response.status, 403);
  });

  const calls = [];
  const suspended = { ...regularUser, status: 'suspended', updated_at: '2026-08-09 12:00:00.000' };
  const router = createAdminRouter({
    database: async () => {
      const db = {
        transaction: async (callback) => callback(db),
        one: async (sql) => (sql.includes('FOR UPDATE') ? regularUser : suspended),
        execute: async (sql, params) => {
          calls.push({ sql, params });
          return { affectedRows: 1 };
        },
      };
      return db;
    },
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/users/12`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'suspended' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.status, 'suspended');
  });
  assert.ok(calls.some((call) => call.sql === 'DELETE FROM auth_tokens WHERE user_id=?' && call.params[0] === 12));
  const auditCall = calls.find((call) => call.sql.includes('INSERT INTO admin_audit_logs'));
  assert.ok(auditCall);
  assert.equal(auditCall.params[1], 'user.update_access');
});

test('智能体配置固定列表会脱敏，且 PATCH 拒绝密钥等运行时配置', async () => {
  const configuration = {
    config_key: 'kaoyan-coach', display_name: '考研顾问', description: 'reviewed', enabled: 1,
    settings_json: '{"apiKey":"not-public","profile":"kaoyan-coach-zh"}', updated_at: '2026-08-09 10:00:00.000',
    updated_by_user_id: null,
  };
  const router = createAdminRouter({
    database: async () => ({
      all: async (sql) => {
        assert.match(sql, /FROM agent_configurations c/);
        return [configuration];
      },
    }),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/agent-configurations`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data[0].settings.apiKey, '[redacted]');
    assert.equal(body.data[0].settings.profile, 'kaoyan-coach-zh');

    const invalid = await fetch(`${baseUrl}/agent-configurations/kaoyan-coach`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { apiKey: 'x' } }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /敏感/);
  });
});

test('普通管理员不能修改全局功能开关', async () => {
  let databaseQueryCount = 0;
  const router = createAdminRouter({
    database: async () => ({
      one: async () => { databaseQueryCount += 1; return null; },
      execute: async () => { databaseQueryCount += 1; return { affectedRows: 1 }; },
    }),
    authenticate: async () => ({ id: 2, username: 'operator', role: 'admin', status: 'active' }),
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/feature-flags/agent-database-manager`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /超级管理员/);
  });
  assert.equal(databaseQueryCount, 0);
});

test('数据库管理 Agent 的人工确认安全边界不能通过 settings 放宽', async () => {
  const current = {
    config_key: 'database-manager', display_name: '数据库管理 Agent', description: 'reviewed', enabled: 1,
    settings_json: JSON.stringify({ profile: 'database-manager', writeAccess: false, requiresHumanConfirmation: true }),
    updated_at: '2026-08-11 10:00:00.000', updated_by_user_id: null,
  };
  let updateCount = 0;
  const db = {
    transaction: async (callback) => callback(db),
    one: async (sql) => (sql.includes('FOR UPDATE') ? current : current),
    execute: async () => { updateCount += 1; return { affectedRows: 1 }; },
  };
  const router = createAdminRouter({ database: async () => db, authenticate: async () => superAdmin });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/agent-configurations/database-manager`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: { profile: 'database-manager', writeAccess: true, requiresHumanConfirmation: false } }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /必须保持/);
  });
  assert.equal(updateCount, 0);
});

test('审计列表脱敏历史字段并验证分页查询', async () => {
  const router = createAdminRouter({
    database: async () => ({
      one: async () => ({ total: 1 }),
      all: async (sql, params) => {
        assert.match(sql, /FROM admin_audit_logs l/);
        assert.deepEqual(params, [1, 'feature_flag.update']);
        return [{
          id: 7, action: 'feature_flag.update', resource_type: 'feature_flag', resource_id: 'agent-kaoyan-coach',
          actor_user_id: 1, actor_username: 'root', before_json: '{"token":"hidden","enabled":true}',
          after_json: '{"enabled":false}', metadata_json: '{"reason":"maintenance"}',
          request_id: '', ip_address: '', user_agent: '', created_at: '2026-08-09 11:00:00.000',
        }];
      },
    }),
    authenticate: async () => superAdmin,
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/audit?actorUserId=1&action=feature_flag.update&pageSize=10`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data[0].before.token, '[redacted]');
    assert.equal(body.data[0].after.enabled, false);
  });
});

test('管理筛选 DTO 拒绝越界、数组和未知角色', () => {
  assert.throws(() => parseAdminUsersQuery({ pageSize: '101' }), /pageSize/);
  assert.throws(() => parseAdminUsersQuery({ role: 'operator' }), /role/);
  assert.throws(() => parseAdminUsersQuery({ keyword: ['a', 'b'] }), /keyword/);
  assert.throws(() => parseAdminAuditQuery({ actorUserId: '0' }), /actorUserId/);
  assert.throws(() => parseAdminAuditQuery({ action: ['x', 'y'] }), /action/);
});
