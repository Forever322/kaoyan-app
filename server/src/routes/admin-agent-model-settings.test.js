import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createAdminAgentModelSettingsRouter } from './admin-agent-model-settings.js';

const superAdmin = { id: 1, username: 'root', role: 'super_admin', status: 'active' };
const normalAdmin = { id: 2, username: 'operator', role: 'admin', status: 'active' };

async function withRouter(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
  }));
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

function settingsDto(overrides = {}) {
  return {
    id: 1,
    profileKey: 'default',
    displayName: '默认模型',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.2,
    maxTokens: 1200,
    enabled: true,
    isDefault: true,
    credentialMode: 'database',
    credentialSource: 'database',
    keyConfigured: true,
    keyLastFour: '1234',
    credentialVersion: 1,
    encryptionKeyVersion: 'v1',
    canClearKey: true,
    revision: 2,
    updatedBy: { id: 1, username: 'root' },
    createdAt: '2026-08-11 00:00:00.000',
    updatedAt: '2026-08-11 00:01:00.000',
    ...overrides,
  };
}

test('模型设置读取、更新和测试连接全部只允许超级管理员', async () => {
  let called = false;
  const router = createAdminAgentModelSettingsRouter({
    database: async () => ({}),
    authenticate: async () => normalAdmin,
    listSettings: async () => { called = true; },
    saveProfile: async () => { called = true; },
    resolveTest: async () => { called = true; },
    connectionTestLimiter: (_req, _res, next) => next(),
  });
  await withRouter(router, async (baseUrl) => {
    for (const request of [
      () => fetch(`${baseUrl}/agent-model-settings`),
      () => fetch(`${baseUrl}/agent-model-settings`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'x' }),
      }),
      () => fetch(`${baseUrl}/agent-model-settings`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'x' }),
      }),
      () => fetch(`${baseUrl}/agent-model-settings/test`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      }),
    ]) {
      const response = await request();
      assert.equal(response.status, 403);
      assert.match((await response.json()).error, /超级管理员/u);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  });
  assert.equal(called, false);
});

test('GET 返回扁平默认配置且永不包含密钥或密文', async () => {
  const settings = settingsDto();
  const router = createAdminAgentModelSettingsRouter({
    database: async () => ({}),
    authenticate: async () => superAdmin,
    listSettings: async () => ({
      data: [settings],
      defaultProfileKey: 'default',
      credentialEncryptionConfigured: true,
      environmentFallbackConfigured: false,
    }),
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/agent-model-settings`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const payload = await response.json();
    assert.deepEqual(payload.settings, settings);
    assert.equal(payload.defaultProfileKey, 'default');
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /encrypted_api_key|key_auth_tag|key_iv|apiKey/u);
  });
});

test('PATCH 只审计脱敏 DTO，响应不会回显提交的 API Key', async () => {
  const apiKey = 'submitted-secret-key-9999';
  const before = settingsDto({ keyConfigured: false, keyLastFour: '', revision: 1 });
  const after = settingsDto({ keyLastFour: '9999', revision: 2 });
  const audits = [];
  const router = createAdminAgentModelSettingsRouter({
    database: async () => ({}),
    authenticate: async () => superAdmin,
    saveProfile: async (_db, options) => {
      assert.equal(options.profileKey, 'default');
      assert.equal(options.body.apiKey, apiKey);
      await options.onSaved({}, { before, after, connectionValidated: true });
      return after;
    },
    listSettings: async () => ({
      data: [after], defaultProfileKey: 'default', credentialEncryptionConfigured: true, environmentFallbackConfigured: false,
    }),
    audit: async (_db, event) => { audits.push(event); },
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/agent-model-settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileKey: 'default', apiKey, expectedRevision: 1 }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.settings.keyLastFour, '9999');
    assert.equal(JSON.stringify(payload).includes(apiKey), false);
  });
  assert.equal(audits.length, 1);
  assert.equal(audits[0].metadata.connectionValidatedBeforeSave, true);
  assert.equal(JSON.stringify(audits).includes(apiKey), false);
});

test('连接测试使用专用限流并仅审计安全元数据', async () => {
  const runtime = {
    profileKey: 'default', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat', apiKey: 'stored-secret-key-1234', source: 'database',
  };
  const audits = [];
  let limited = false;
  const router = createAdminAgentModelSettingsRouter({
    database: async () => ({}),
    authenticate: async () => superAdmin,
    resolveTest: async () => runtime,
    testConnection: async () => ({
      ok: true, provider: runtime.provider, baseUrl: runtime.baseUrl, model: runtime.model, latencyMs: 12,
    }),
    audit: async (_db, event) => { audits.push(event); },
    connectionTestLimiter: (_req, _res, next) => { limited = true; next(); },
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/agent-model-settings/test`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileKey: 'default' }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(JSON.stringify(payload).includes(runtime.apiKey), false);
  });
  assert.equal(limited, true);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].metadata, {
    profileKey: 'default', provider: 'deepseek', model: 'deepseek-chat',
    credentialSource: 'database', success: true, latencyMs: 12,
  });
  assert.equal(JSON.stringify(audits).includes(runtime.apiKey), false);
});
