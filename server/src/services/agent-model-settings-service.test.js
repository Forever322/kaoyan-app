import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentModelSettingsError,
  assertAgentModelEndpointPublic,
  decryptAgentModelApiKey,
  encryptAgentModelApiKey,
  normalizeAgentModelBaseUrl,
  publicAgentModelSettings,
  resolveAgentModelConnectionTest,
  resolveAgentModelRuntime,
  saveAgentModelProfile,
  testAgentModelConnection,
} from './agent-model-settings-service.js';

const encryptionEnvironment = {
  AGENT_CREDENTIAL_ENCRYPTION_KEY: '11'.repeat(32),
  AGENT_CREDENTIAL_ENCRYPTION_KEY_VERSION: 'v1',
};

const fallbackEnvironment = {
  ...encryptionEnvironment,
  LLM_PROVIDER: 'deepseek',
  LLM_BASE_URL: 'https://api.deepseek.com/v1',
  LLM_API_KEY: 'legacy-environment-key-1234',
  AGENT_MODEL: 'deepseek-chat',
  AGENT_TEMPERATURE: '0.35',
  AGENT_MAX_TOKENS: '1200',
};

function profileRow(overrides = {}) {
  return {
    id: 1,
    profile_key: 'default',
    display_name: '默认模型',
    provider: 'deepseek',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    temperature: 0.2,
    max_tokens: 1200,
    encrypted_api_key: null,
    key_iv: null,
    key_auth_tag: null,
    key_last_four: '',
    credential_version: 1,
    encryption_key_version: 'v1',
    credential_mode: 'disabled',
    enabled: 1,
    is_default: 1,
    revision: 1,
    updated_by_user_id: 1,
    updated_by_username: 'root',
    created_at: '2026-08-11 00:00:00.000',
    updated_at: '2026-08-11 00:00:00.000',
    ...overrides,
  };
}

function encryptedProfile(apiKey = 'database-secret-key-5678', overrides = {}) {
  const row = profileRow({ credential_mode: 'database', ...overrides });
  const encrypted = encryptAgentModelApiKey(apiKey, {
    profileKey: row.profile_key,
    provider: row.provider,
    baseUrl: row.base_url,
  }, { environment: encryptionEnvironment });
  return {
    ...row,
    encrypted_api_key: encrypted.encryptedApiKey,
    key_iv: encrypted.keyIv,
    key_auth_tag: encrypted.keyAuthTag,
    key_last_four: encrypted.keyLastFour,
    credential_version: encrypted.credentialVersion,
    encryption_key_version: encrypted.encryptionKeyVersion,
  };
}

test('AES-256-GCM 加密不保存明文，并通过绑定配置的 AAD 防止密文挪用', () => {
  const apiKey = 'sk-secret-value-1234';
  const encrypted = encryptAgentModelApiKey(apiKey, {
    profileKey: 'default', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1',
  }, { environment: encryptionEnvironment });
  assert.equal(encrypted.keyIv.length, 12);
  assert.equal(encrypted.keyAuthTag.length, 16);
  assert.equal(encrypted.encryptedApiKey.includes(Buffer.from(apiKey)), false);
  assert.equal(encrypted.keyLastFour, '1234');

  const row = profileRow({
    encrypted_api_key: encrypted.encryptedApiKey,
    key_iv: encrypted.keyIv,
    key_auth_tag: encrypted.keyAuthTag,
    key_last_four: encrypted.keyLastFour,
    credential_version: encrypted.credentialVersion,
    encryption_key_version: encrypted.encryptionKeyVersion,
  });
  assert.equal(decryptAgentModelApiKey(row, { environment: encryptionEnvironment }), apiKey);
  assert.throws(
    () => decryptAgentModelApiKey({ ...row, base_url: 'https://api.openai.com/v1' }, { environment: encryptionEnvironment }),
    (error) => error.code === 'credential_decryption_failed' && !error.message.includes(apiKey),
  );
});

test('模型地址只接受 HTTPS 443 白名单，并拒绝 IP、私网 DNS 与 URL 注入', async () => {
  assert.equal(normalizeAgentModelBaseUrl('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1');
  for (const value of [
    'http://api.deepseek.com/v1',
    'https://user:pass@api.deepseek.com/v1',
    'https://api.deepseek.com:8443/v1',
    'https://127.0.0.1/v1',
    'https://api.deepseek.com.evil.example/v1',
    'https://api.deepseek.com/v1?target=internal',
  ]) assert.throws(() => normalizeAgentModelBaseUrl(value), AgentModelSettingsError);

  const custom = normalizeAgentModelBaseUrl('https://llm.example.com/v1', {
    environment: { AGENT_LLM_ALLOWED_HOSTS: 'llm.example.com' },
  });
  assert.equal(custom, 'https://llm.example.com/v1');
  await assert.rejects(
    assertAgentModelEndpointPublic(custom, {
      lookup: async () => [{ address: '169.254.169.254', family: 4 }], cache: null,
    }),
    (error) => error.code === 'model_host_not_public',
  );
  assert.deepEqual(await assertAgentModelEndpointPublic(custom, {
    lookup: async () => [{ address: '203.0.114.10', family: 4 }], cache: null,
  }), [{ address: '203.0.114.10', family: 4 }]);
});

test('公开设置查询不选择或返回密文，environment 模式展示整套实际环境配置', async () => {
  let selectSql = '';
  const db = {
    all: async (sql) => {
      selectSql = sql;
      return [profileRow({
        credential_mode: 'environment',
        provider: 'openai',
        base_url: 'https://api.openai.com/v1',
        model: 'stale-row-model',
        key_configured: 0,
      })];
    },
  };
  const result = await publicAgentModelSettings(db, { environment: fallbackEnvironment });
  assert.doesNotMatch(selectSql, /p\.encrypted_api_key\s*,/u);
  assert.equal(result.data[0].provider, 'deepseek');
  assert.equal(result.data[0].baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(result.data[0].model, 'deepseek-chat');
  assert.equal(result.data[0].keyConfigured, true);
  assert.equal(result.data[0].keyLastFour, '1234');
  assert.equal(result.data[0].canClearKey, false);
  assert.equal(JSON.stringify(result).includes(fallbackEnvironment.LLM_API_KEY), false);
});

test('运行时严格按整套凭据来源解析，disabled 不会回退环境密钥', async () => {
  const noNetwork = async () => {};
  const environmentRow = profileRow({
    credential_mode: 'environment', provider: 'openai', base_url: 'https://api.openai.com/v1', model: 'wrong-row-model', revision: 4,
  });
  const environmentRuntime = await resolveAgentModelRuntime({ one: async () => environmentRow }, {
    environment: fallbackEnvironment, endpointGuard: noNetwork,
  });
  assert.equal(environmentRuntime.source, 'environment');
  assert.equal(environmentRuntime.provider, 'deepseek');
  assert.equal(environmentRuntime.model, 'deepseek-chat');
  assert.equal(environmentRuntime.apiKey, fallbackEnvironment.LLM_API_KEY);
  assert.equal(environmentRuntime.profileRevision, 4);

  await assert.rejects(
    resolveAgentModelRuntime({ one: async () => profileRow({ credential_mode: 'disabled' }) }, {
      environment: fallbackEnvironment, endpointGuard: noNetwork,
    }),
    (error) => error.code === 'missing_llm_key',
  );

  const databaseRow = encryptedProfile();
  const databaseRuntime = await resolveAgentModelRuntime({ one: async () => databaseRow }, {
    environment: fallbackEnvironment, endpointGuard: noNetwork,
  });
  assert.equal(databaseRuntime.source, 'database');
  assert.equal(databaseRuntime.apiKey, 'database-secret-key-5678');
  assert.equal(databaseRuntime.profileRevision, 1);
  assert.equal(databaseRuntime.credentialVersion, 1);
  assert.equal(typeof databaseRuntime.fetch, 'function');
});

test('连接测试不会把环境密钥与数据库中的另一套连接参数混用', async () => {
  const environmentRow = profileRow({
    credential_mode: 'environment', provider: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-test',
  });
  const runtime = await resolveAgentModelConnectionTest({ one: async () => environmentRow }, {}, {
    environment: fallbackEnvironment, endpointGuard: async () => {},
  });
  assert.equal(runtime.provider, 'deepseek');
  assert.equal(runtime.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(runtime.model, 'deepseek-chat');
  assert.equal(runtime.apiKey, fallbackEnvironment.LLM_API_KEY);

  await assert.rejects(
    resolveAgentModelConnectionTest({ one: async () => environmentRow }, { model: 'gpt-test' }, {
      environment: fallbackEnvironment, endpointGuard: async () => {},
    }),
    /必须重新输入 API Key/u,
  );
});

test('数据库模式修改模型时先用现有密钥测试，随后以 revision CAS 更新', async () => {
  const current = encryptedProfile('existing-database-key-9012', { revision: 7 });
  let transactionStarted = false;
  let updated = false;
  const executeCalls = [];
  const db = {
    one: async () => current,
    transaction: async (callback) => {
      transactionStarted = true;
      let reads = 0;
      const tx = {
        all: async () => [{ id: 1 }],
        one: async () => {
          reads += 1;
          return reads === 1 ? current : profileRow({ ...current, model: 'deepseek-reasoner', revision: 8 });
        },
        execute: async (sql, params = []) => {
          executeCalls.push({ sql, params });
          if (/UPDATE agent_model_profiles SET\s+display_name/iu.test(sql)) updated = true;
          return { affectedRows: 1 };
        },
      };
      return callback(tx);
    },
  };
  const validations = [];
  const saved = await saveAgentModelProfile(db, {
    profileKey: 'default',
    body: { model: 'deepseek-reasoner', expectedRevision: 7 },
    actorUserId: 1,
    environment: encryptionEnvironment,
    endpointGuard: async () => {},
    credentialValidator: async (runtime) => { validations.push(runtime); },
  });
  assert.equal(transactionStarted, true);
  assert.equal(updated, true);
  assert.equal(validations.length, 1);
  assert.equal(validations[0].apiKey, 'existing-database-key-9012');
  assert.equal(validations[0].model, 'deepseek-reasoner');
  assert.equal(saved.revision, 8);
  const update = executeCalls.find((call) => /WHERE profile_key=\? AND revision=\?/u.test(call.sql));
  assert.equal(update.params.at(-1), 7);
  assert.equal(update.params.includes('existing-database-key-9012'), false);
});

test('新密钥测试失败时不启动写事务，environment 模式也不能无密钥修改显示参数', async () => {
  const current = profileRow({ credential_mode: 'environment' });
  let transactionStarted = false;
  const db = {
    one: async () => current,
    transaction: async () => { transactionStarted = true; },
  };
  await assert.rejects(saveAgentModelProfile(db, {
    profileKey: 'default',
    body: { apiKey: 'candidate-secret-key-0000', expectedRevision: 1 },
    actorUserId: 1,
    environment: encryptionEnvironment,
    endpointGuard: async () => {},
    credentialValidator: async () => {
      throw new AgentModelSettingsError('模型连接测试失败', 502, 'model_connection_failed');
    },
  }), (error) => error.code === 'model_connection_failed');
  assert.equal(transactionStarted, false);

  await assert.rejects(saveAgentModelProfile(db, {
    profileKey: 'default',
    body: { model: 'another-model', expectedRevision: 1 },
    actorUserId: 1,
    environment: encryptionEnvironment,
    endpointGuard: async () => {},
    credentialValidator: async () => {},
  }), /环境凭据模式/u);
  assert.equal(transactionStarted, false);
});

test('数据库凭据删除必须显式 clear，过期 revision 在外部连接测试前即被拒绝', async () => {
  const current = encryptedProfile('existing-database-key-3456', { revision: 5 });
  let validated = false;
  let transactionStarted = false;
  const db = {
    one: async () => current,
    transaction: async () => { transactionStarted = true; },
  };
  await assert.rejects(saveAgentModelProfile(db, {
    profileKey: 'default',
    body: { credentialMode: 'disabled', expectedRevision: 5 },
    actorUserId: 1,
    environment: encryptionEnvironment,
    endpointGuard: async () => {},
    credentialValidator: async () => { validated = true; },
  }), /clearApiKey=true/u);
  assert.equal(transactionStarted, false);

  await assert.rejects(saveAgentModelProfile(db, {
    profileKey: 'default',
    body: { apiKey: 'new-candidate-key-7890', expectedRevision: 4 },
    actorUserId: 1,
    environment: encryptionEnvironment,
    endpointGuard: async () => {},
    credentialValidator: async () => { validated = true; },
  }), (error) => error.code === 'agent_model_profile_conflict');
  assert.equal(validated, false);
  assert.equal(transactionStarted, false);
});

test('测试客户端使用独立无重试、短超时且受控的 fetch，不回显密钥', async () => {
  let clientOptions;
  let completion;
  class FakeOpenAI {
    constructor(options) {
      clientOptions = options;
      this.chat = { completions: { create: async (payload) => { completion = payload; return { choices: [] }; } } };
    }
  }
  const safeFetch = async () => new Response('{}', { status: 200 });
  const result = await testAgentModelConnection({
    provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'secret-test-key-1234',
  }, {
    OpenAIClient: FakeOpenAI,
    timeoutMs: 30_000,
    fetchFactory: () => safeFetch,
  });
  assert.equal(clientOptions.maxRetries, 0);
  assert.equal(clientOptions.timeout, 15_000);
  assert.equal(clientOptions.fetch, safeFetch);
  assert.equal(completion.max_tokens, 1);
  assert.equal(JSON.stringify(result).includes('secret-test-key-1234'), false);
});
