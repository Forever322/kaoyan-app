import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { checksumRows } from './admin-database.js';
import { createAdminAgentRouter } from './admin-agent.js';

const superAdmin = { id: 1, username: 'root', role: 'super_admin', status: 'active' };
const normalAdmin = { id: 2, username: 'operator', role: 'admin', status: 'active' };

async function withRouter(router, run) {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
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

const tableRow = {
  table_name: 'universities', table_rows: '0', data_length: '0', index_length: '0', update_time: null,
};

const columnRows = [
  {
    column_name: 'id', data_type: 'bigint', column_type: 'bigint unsigned', is_nullable: 'NO',
    column_default: null, column_key: 'PRI', extra: 'auto_increment', character_maximum_length: null,
  },
  {
    column_name: 'name', data_type: 'varchar', column_type: 'varchar(191)', is_nullable: 'NO',
    column_default: null, column_key: '', extra: '', character_maximum_length: 191,
  },
  {
    column_name: 'province', data_type: 'varchar', column_type: 'varchar(64)', is_nullable: 'NO',
    column_default: null, column_key: '', extra: '', character_maximum_length: 64,
  },
  {
    column_name: 'source_document_id', data_type: 'bigint', column_type: 'bigint unsigned', is_nullable: 'YES',
    column_default: null, column_key: '', extra: '', character_maximum_length: null,
  },
  {
    column_name: 'verification_status', data_type: 'varchar', column_type: 'varchar(32)', is_nullable: 'NO',
    column_default: 'pending', column_key: '', extra: '', character_maximum_length: 32,
  },
  {
    column_name: 'status', data_type: 'varchar', column_type: 'varchar(32)', is_nullable: 'NO',
    column_default: 'active', column_key: '', extra: '', character_maximum_length: 32,
  },
];

const indexRows = [
  { index_name: 'PRIMARY', column_name: 'id', seq_in_index: 1, non_unique: 0 },
  { index_name: 'uq_universities_name', column_name: 'name', seq_in_index: 1, non_unique: 0 },
];

const foreignKeyRows = [{
  column_name: 'source_document_id', referenced_table_name: 'source_documents', referenced_column_name: 'id',
  constraint_name: 'fk_universities_document',
}];

function databaseStateChecksum(rows, existingRecords = []) {
  return checksumRows([{
    table: 'universities',
    rows: rows.map((_, rowIndex) => ({
      rowIndex,
      conflict: false,
      keys: [{ name: 'uq_universities_name', record: existingRecords[rowIndex] || null }],
    })),
  }]);
}

function emptyDatabaseStateChecksum(rows) {
  return databaseStateChecksum(rows);
}

function stagedJob(rows, overrides = {}) {
  return {
    id: 9,
    actor_user_id: 1,
    actor_username: 'root',
    target_table: 'universities',
    import_batch_id: 11,
    source_document_id: 12,
    source_type: 'file',
    source_name: 'universities.csv',
    instruction_text: null,
    input_format: 'csv',
    operation_mode: 'insert',
    status: 'awaiting_confirmation',
    review_status: 'passed',
    row_count: rows.length,
    checksum: checksumRows(rows),
    normalized_rows_json: JSON.stringify(rows),
    review_json: JSON.stringify({
      status: 'passed', riskLevel: 'low', issues: [], policyVersion: '2026-08-11.3',
      databaseStateChecksum: emptyDatabaseStateChecksum(rows),
    }),
    model: 'stub-model',
    error_code: '',
    error_message: '',
    affected_rows: 0,
    confirmed_by_user_id: null,
    confirmer_username: '',
    confirmed_at: null,
    completed_at: null,
    expires_at: '2099-01-01 00:00:00.000',
    created_at: '2026-08-11 10:00:00.000',
    updated_at: '2026-08-11 10:00:00.000',
    ...overrides,
  };
}

function createAgentDb({
  initialJob = null,
  configurationEnabled = true,
  featureEnabled = true,
  metadataColumns = columnRows,
  metadataIndexes = indexRows,
  metadataForeignKeys = foreignKeyRows,
  oneResult = null,
  allResult = null,
  executeResult = null,
  failTransitionAffectedRows = 1,
} = {}) {
  const calls = [];
  const state = { job: initialJob ? { ...initialJob } : null, nextJobId: 9, nextUniversityId: 101 };
  const db = {
    transaction: async (callback) => callback(db),
    one: async (sql, params = []) => {
      calls.push({ kind: 'one', sql, params });
      if (sql.includes('FROM agent_configurations')) return { enabled: configurationEnabled ? 1 : 0 };
      if (sql.includes('FROM feature_flags')) return { enabled: featureEnabled ? 1 : 0, rollout_percentage: 100 };
      if (sql.includes('COUNT(*) AS count FROM agent_runs')) return { count: 0 };
      if (sql.includes('information_schema.tables')) return tableRow;
      if (sql.includes('SELECT * FROM admin_agent_jobs') && sql.includes('FOR UPDATE')) return state.job;
      if (sql.includes('FROM admin_agent_jobs j')) return state.job;
      if (oneResult) {
        const value = await oneResult({ sql, params, state });
        if (value !== undefined) return value;
      }
      return null;
    },
    all: async (sql, params = []) => {
      calls.push({ kind: 'all', sql, params });
      if (sql.includes('information_schema.columns')) return metadataColumns;
      if (sql.includes('information_schema.statistics')) return metadataIndexes;
      if (sql.includes('information_schema.key_column_usage')) return metadataForeignKeys;
      if (sql.includes('FROM `source_documents`')) return [{ value: 12 }];
      if (allResult) {
        const value = await allResult({ sql, params, state });
        if (value !== undefined) return value;
      }
      if (sql.includes('FROM `universities`')) return [];
      return [];
    },
    execute: async (sql, params = []) => {
      calls.push({ kind: 'execute', sql, params });
      if (executeResult) {
        const value = await executeResult({ sql, params, state });
        if (value !== undefined) return value;
      }
      if (/INSERT INTO admin_agent_jobs/iu.test(sql)) {
        const id = state.nextJobId;
        state.job = stagedJob([], {
          id,
          actor_user_id: params[0],
          target_table: params[1],
          source_type: params[2],
          source_name: params[3],
          instruction_text: params[4],
          input_format: params[5],
          operation_mode: params[6],
          status: 'reviewing',
          review_status: 'pending',
          row_count: 0,
          checksum: '',
          normalized_rows_json: null,
          review_json: null,
          expires_at: params[7],
          import_batch_id: null,
          source_document_id: null,
        });
        return { affectedRows: 1, insertId: id };
      }
      if (/INSERT INTO data_import_batches/iu.test(sql)) return { affectedRows: 1, insertId: 11 };
      if (/INSERT INTO source_documents/iu.test(sql)) return { affectedRows: 1, insertId: 12 };
      if (/UPDATE admin_agent_jobs SET import_batch_id=/iu.test(sql)) {
        Object.assign(state.job, { import_batch_id: params[0], source_document_id: params[1] });
        return { affectedRows: 1 };
      }
      if (/UPDATE admin_agent_jobs SET\s+status=\?,review_status=\?/iu.test(sql)) {
        Object.assign(state.job, {
          status: params[0], review_status: params[1], row_count: params[2], checksum: params[3],
          normalized_rows_json: params[4], review_json: params[5], model: params[6],
        });
        return { affectedRows: 1 };
      }
      if (/INSERT INTO `universities`/iu.test(sql)) {
        const insertId = state.nextUniversityId;
        state.nextUniversityId += 1;
        return { affectedRows: 1, insertId };
      }
      if (/UPDATE admin_agent_jobs SET\s+status='completed'/iu.test(sql)) {
        Object.assign(state.job, {
          status: 'completed', review_status: 'passed', affected_rows: params[0],
          confirmed_by_user_id: params[1], confirmer_username: 'root',
          confirmed_at: '2026-08-11 11:00:00.000', completed_at: '2026-08-11 11:00:00.000',
        });
        return { affectedRows: 1 };
      }
      if (/UPDATE admin_agent_jobs\s+SET status='failed'.*status='reviewing'/isu.test(sql)) {
        if (failTransitionAffectedRows === 1 && state.job) {
          Object.assign(state.job, { status: 'failed', review_status: 'blocked' });
        }
        return { affectedRows: failTransitionAffectedRows };
      }
      return { affectedRows: 1, insertId: 0 };
    },
  };
  return { db, calls, state };
}

test('数据库管理 Agent 的创建、查询和写入接口都只允许超级管理员', async () => {
  const { db, calls } = createAgentDb();
  const router = createAdminAgentRouter({ database: async () => db, authenticate: async () => normalAdmin });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database-agent/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceType: 'text', table: 'universities', instruction: '新增测试大学' }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /超级管理员/);

    const jobs = await fetch(`${baseUrl}/database-agent/jobs`);
    assert.equal(jobs.status, 403);
    assert.match((await jobs.json()).error, /超级管理员/);
  });
  assert.equal(calls.some((call) => call.kind === 'execute'), false);
});

test('普通管理员不能确认 Agent 审核任务写入数据库', async () => {
  const rows = [{ name: '待写入大学', province: '上海', source_document_id: '12', verification_status: 'pending' }];
  const { db, calls, state } = createAgentDb({ initialJob: stagedJob(rows) });
  const router = createAdminAgentRouter({
    database: async () => db,
    authenticate: async () => normalAdmin,
    audit: async () => {},
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database-agent/jobs/9/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checksum: checksumRows(rows), rowCount: rows.length }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /超级管理员/);
  });
  assert.equal(state.job.status, 'awaiting_confirmation');
  assert.equal(calls.some((call) => call.kind === 'execute'), false);
});

test('文字口述先生成持久化审核任务，不会在审核阶段写业务表', async () => {
  const previousKey = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = 'test-only-key';
  const { db, calls, state } = createAgentDb();
  const audits = [];
  const router = createAdminAgentRouter({
    database: async () => db,
    authenticate: async () => superAdmin,
    generateRows: async ({ table, instruction }) => {
      assert.equal(table, 'universities');
      assert.match(instruction, /测试大学/);
      return { summary: '已抽取 1 行', mode: 'insert', rows: [{ name: '测试大学', province: '北京' }] };
    },
    reviewContent: async () => ({
      summary: '语义审核通过', riskLevel: 'low', recommendation: '核对后确认', approved: true, issues: [],
    }),
    audit: async (_db, event) => { audits.push(event); },
  });
  try {
    await withRouter(router, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/database-agent/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'text', table: 'universities', mode: 'insert', instruction: '新增测试大学，位于北京',
        }),
      });
      assert.equal(response.status, 201);
      const payload = await response.json();
      assert.equal(payload.job.status, 'awaiting_confirmation');
      assert.equal(payload.job.reviewStatus, 'passed');
      assert.equal(payload.job.rowCount, 1);
      assert.match(payload.job.checksum, /^[a-f0-9]{64}$/u);
      assert.equal(payload.job.preview[0].name, '测试大学');
      assert.equal(String(payload.job.preview[0].source_document_id), '12');
      assert.equal(payload.job.preview[0].verification_status, 'pending');
    });
  } finally {
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
  }
  assert.equal(state.job.status, 'awaiting_confirmation');
  assert.equal(calls.filter((call) => call.kind === 'execute' && /INSERT INTO agent_runs/iu.test(call.sql)).length, 2);
  assert.equal(calls.some((call) => call.kind === 'execute' && /INSERT INTO `universities`/iu.test(call.sql)), false);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'database_agent.review');
});

test('匹配审核校验和只写入一次并记录一次 apply 审计，重复执行被拒绝', async () => {
  const rows = [{ name: '待写入大学', province: '上海', source_document_id: '12', verification_status: 'pending' }];
  const { db, calls, state } = createAgentDb({ initialJob: stagedJob(rows) });
  const audits = [];
  const router = createAdminAgentRouter({
    database: async () => db,
    authenticate: async () => superAdmin,
    audit: async (_db, event) => { audits.push(event); },
  });
  await withRouter(router, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/database-agent/jobs/9/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checksum: checksumRows(rows), rowCount: rows.length }),
    });
    const applied = await first.json();
    assert.equal(first.status, 200, JSON.stringify(applied));
    assert.equal(applied.job.status, 'completed');
    assert.equal(applied.job.affectedRows, 1);

    const repeated = await fetch(`${baseUrl}/database-agent/jobs/9/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checksum: checksumRows(rows), rowCount: rows.length }),
    });
    assert.equal(repeated.status, 409);
    assert.equal((await repeated.json()).code, 'job_already_applied');
  });
  assert.equal(state.job.status, 'completed');
  assert.equal(calls.filter((call) => call.kind === 'execute' && /INSERT INTO `universities`/iu.test(call.sql)).length, 1);
  assert.equal(calls.filter((call) => call.kind === 'execute' && /INSERT INTO catalog_change_log/iu.test(call.sql)).length, 1);
  assert.equal(audits.filter((event) => event.action === 'database_agent.apply').length, 1);
});

test('upsert 显式更新已审核实体并在变更日志保存 before/after 快照', async () => {
  const rows = [{
    name: '待更新大学', province: '上海', source_document_id: '12', verification_status: 'pending',
  }];
  const before = {
    id: '50', name: '待更新大学', province: '北京', source_document_id: '5',
    verification_status: 'verified', status: 'active',
  };
  const after = {
    id: '50', name: '待更新大学', province: '上海', source_document_id: '12',
    verification_status: 'pending', status: 'active',
  };
  const review = {
    status: 'warning', riskLevel: 'medium', issues: [], policyVersion: '2026-08-11.3',
    databaseStateChecksum: databaseStateChecksum(rows, [before]),
  };
  const scenario = createAgentDb({
    initialJob: stagedJob(rows, {
      operation_mode: 'upsert', review_status: 'warning', review_json: JSON.stringify(review),
    }),
    allResult: async ({ sql }) => {
      if (!sql.includes('JOIN `universities`')) return undefined;
      return sql.includes(',existing.*')
        ? [{ __agent_row_index: 0, ...before }]
        : [{ __agent_row_index: 0 }];
    },
    oneResult: async ({ sql }) => (
      sql.includes('SELECT * FROM `universities` WHERE `id`=?') ? after : undefined
    ),
  });
  const audits = [];
  const router = createAdminAgentRouter({
    database: async () => scenario.db,
    authenticate: async () => superAdmin,
    audit: async (_db, event) => { audits.push(event); },
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database-agent/jobs/9/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checksum: checksumRows(rows), rowCount: rows.length }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.job.status, 'completed');
  });

  const update = scenario.calls.find((call) => call.kind === 'execute' && /^UPDATE `universities` SET/iu.test(call.sql));
  assert.ok(update);
  assert.equal(update.params.at(-1), '50');
  assert.equal(scenario.calls.some((call) => (
    call.kind === 'execute' && /INSERT INTO `universities`|ON DUPLICATE KEY/iu.test(call.sql)
  )), false);
  const change = scenario.calls.find((call) => call.kind === 'execute' && /INSERT INTO catalog_change_log/iu.test(call.sql));
  assert.ok(change);
  assert.equal(change.params[1], '50');
  assert.equal(change.params[2], 'update');
  assert.deepEqual(JSON.parse(change.params[4]), before);
  assert.deepEqual(JSON.parse(change.params[5]), after);
  const changedFields = new Set(JSON.parse(change.params[3]));
  assert.deepEqual(changedFields, new Set(['province', 'source_document_id', 'verification_status']));
  assert.equal(audits.filter((event) => event.action === 'database_agent.apply').length, 1);
});

test('upsert 的重复提示与数据库快照来自同一次读取，不能隐藏并发出现的旧记录', async () => {
  const previousKey = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  const existing = { id: '50', name: '并发大学', province: '北京' };
  const scenario = createAgentDb({
    allResult: async ({ sql }) => {
      if (!sql.includes('JOIN `universities`')) return undefined;
      // 旧实现先做不返回记录的重复查询、再做快照查询，会把这条
      // 并发记录收进 apply 基线，却没有在管理员看到的审核中提示。
      return sql.includes(',existing.*')
        ? [{ __agent_row_index: 0, ...existing }]
        : [];
    },
  });
  const router = createAdminAgentRouter({
    database: async () => scenario.db,
    authenticate: async () => superAdmin,
    audit: async () => {},
  });
  try {
    await withRouter(router, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/database-agent/reviews`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer consistent-upsert-review',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceType: 'file', table: 'universities', format: 'json', mode: 'upsert',
          rows: [{ name: '并发大学', province: '上海' }],
        }),
      });
      const payload = await response.json();
      assert.equal(response.status, 201, JSON.stringify(payload));
      assert.equal(payload.job.status, 'awaiting_confirmation');
      assert.equal(payload.job.reviewStatus, 'warning');
      assert.ok(payload.job.review.issues.some((issue) => issue.code === 'duplicate_in_database'));
    });
  } finally {
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
  }
});

test('apply 缺少行数或校验和格式非法时不会改变任务和导入批次', async () => {
  const rows = [{ name: '待写入大学', province: '上海', source_document_id: '12', verification_status: 'pending' }];
  const { db, calls, state } = createAgentDb({ initialJob: stagedJob(rows) });
  const router = createAdminAgentRouter({
    database: async () => db,
    authenticate: async () => superAdmin,
    audit: async () => {},
  });
  await withRouter(router, async (baseUrl) => {
    const missingRowCount = await fetch(`${baseUrl}/database-agent/jobs/9/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checksum: checksumRows(rows) }),
    });
    assert.equal(missingRowCount.status, 400);
    assert.match((await missingRowCount.json()).error, /rowCount/);

    const invalidChecksum = await fetch(`${baseUrl}/database-agent/jobs/9/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checksum: 'not-a-checksum', rowCount: rows.length }),
    });
    assert.equal(invalidChecksum.status, 400);
    assert.match((await invalidChecksum.json()).error, /校验和/);
  });
  assert.equal(state.job.status, 'awaiting_confirmation');
  assert.equal(calls.some((call) => call.kind === 'execute'), false);
});

test('功能开关关闭时 apply 被拒绝且不会污染审核任务或导入批次', async () => {
  const rows = [{ name: '待写入大学', province: '上海', source_document_id: '12', verification_status: 'pending' }];
  const { db, calls, state } = createAgentDb({ initialJob: stagedJob(rows), featureEnabled: false });
  const router = createAdminAgentRouter({
    database: async () => db,
    authenticate: async () => superAdmin,
    audit: async () => {},
  });
  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database-agent/jobs/9/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checksum: checksumRows(rows), rowCount: rows.length }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'agent_feature_disabled');
  });
  assert.equal(state.job.status, 'awaiting_confirmation');
  assert.equal(calls.some((call) => call.kind === 'execute'), false);
});

test('已完成或已驳回任务的 apply 失败不会把任务和导入批次降级为 failed', async () => {
  const rows = [{ name: '待写入大学', province: '上海', source_document_id: '12', verification_status: 'pending' }];
  for (const [status, expectedCode] of [
    ['completed', 'job_already_applied'],
    ['rejected', 'job_not_applicable'],
  ]) {
    const scenario = createAgentDb({ initialJob: stagedJob(rows, { status }) });
    const router = createAdminAgentRouter({
      database: async () => scenario.db,
      authenticate: async () => superAdmin,
      audit: async () => {},
    });
    await withRouter(router, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/database-agent/jobs/9/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checksum: checksumRows(rows), rowCount: rows.length }),
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, expectedCode);
    });
    assert.equal(scenario.state.job.status, status);
    assert.equal(scenario.calls.some((call) => (
      call.kind === 'execute'
      && (/UPDATE admin_agent_jobs SET status='failed'/iu.test(call.sql)
        || /SET b\.status='failed'/iu.test(call.sql))
    )), false);
  }
});

test('校验和不匹配和已阻断审核都不可落库', async () => {
  const rows = [{ name: '风险大学', province: '北京', source_document_id: '12', verification_status: 'pending' }];
  const mismatch = createAgentDb({ initialJob: stagedJob(rows) });
  const mismatchRouter = createAdminAgentRouter({
    database: async () => mismatch.db, authenticate: async () => superAdmin, audit: async () => {},
  });
  await withRouter(mismatchRouter, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database-agent/jobs/9/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checksum: '0'.repeat(64), rowCount: rows.length }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'checksum_mismatch');
  });
  assert.equal(mismatch.calls.some((call) => call.kind === 'execute' && /INSERT INTO `universities`/iu.test(call.sql)), false);

  const blocked = createAgentDb({ initialJob: stagedJob(rows, { status: 'blocked', review_status: 'blocked' }) });
  const blockedRouter = createAdminAgentRouter({
    database: async () => blocked.db, authenticate: async () => superAdmin, audit: async () => {},
  });
  await withRouter(blockedRouter, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/database-agent/jobs/9/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checksum: checksumRows(rows), rowCount: rows.length }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'job_not_applicable');
  });
  assert.equal(blocked.calls.some((call) => call.kind === 'execute' && /INSERT INTO `universities`/iu.test(call.sql)), false);
});

test('upsert 审核阻断唯一键映射到歧义实体以及不同旧实体共享新键', async () => {
  const dualUniqueColumns = [
    columnRows[0],
    columnRows[1],
    {
      column_name: 'code', data_type: 'varchar', column_type: 'varchar(64)', is_nullable: 'NO',
      column_default: null, column_key: '', extra: '', character_maximum_length: 64,
    },
    columnRows[3],
    columnRows[4],
  ];
  const dualUniqueIndexes = [
    { index_name: 'PRIMARY', column_name: 'id', seq_in_index: 1, non_unique: 0 },
    { index_name: 'uq_universities_name', column_name: 'name', seq_in_index: 1, non_unique: 0 },
    { index_name: 'uq_universities_code', column_name: 'code', seq_in_index: 1, non_unique: 0 },
  ];
  const scenarios = [
    {
      label: 'one-row-two-entities',
      rows: [{ name: '旧名称 A', code: '旧代码 B' }],
      matches: {
        name: [{ rowIndex: 0, record: { id: 41, name: '旧名称 A', code: '代码 A' } }],
        code: [{ rowIndex: 0, record: { id: 42, name: '名称 B', code: '旧代码 B' } }],
      },
      expectedCode: 'unique_keys_resolve_to_different_rows',
    },
    {
      label: 'two-rows-one-entity',
      rows: [{ name: '旧名称 A', code: '新代码 A' }, { name: '新名称 B', code: '旧代码 A' }],
      matches: {
        name: [{ rowIndex: 0, record: { id: 41, name: '旧名称 A', code: '旧代码 A' } }],
        code: [{ rowIndex: 1, record: { id: 41, name: '旧名称 A', code: '旧代码 A' } }],
      },
      expectedCode: 'multiple_rows_resolve_to_same_entity',
    },
    {
      label: 'two-entities-one-new-key',
      rows: [{ name: '旧名称 A', code: '共享新代码' }, { name: '旧名称 B', code: '共享新代码' }],
      matches: {
        name: [
          { rowIndex: 0, record: { id: 41, name: '旧名称 A', code: '旧代码 A' } },
          { rowIndex: 1, record: { id: 42, name: '旧名称 B', code: '旧代码 B' } },
        ],
        code: [],
      },
      expectedCode: 'duplicate_in_batch',
    },
  ];

  for (const scenarioDefinition of scenarios) {
    const scenario = createAgentDb({
      metadataColumns: dualUniqueColumns,
      metadataIndexes: dualUniqueIndexes,
      allResult: async ({ sql }) => {
        if (!sql.includes('JOIN `universities`')) return undefined;
        const key = sql.includes('AS `name`') ? 'name' : sql.includes('AS `code`') ? 'code' : '';
        const matches = scenarioDefinition.matches[key] || [];
        return matches.map(({ rowIndex, record }) => (
          sql.includes(',existing.*') ? { __agent_row_index: rowIndex, ...record } : { __agent_row_index: rowIndex }
        ));
      },
    });
    const router = createAdminAgentRouter({
      database: async () => scenario.db,
      authenticate: async () => superAdmin,
      reviewContent: async () => ({ approved: true, riskLevel: 'low', summary: '语义通过', issues: [] }),
      audit: async () => {},
    });
    await withRouter(router, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/database-agent/reviews`, {
        method: 'POST',
        headers: {
          authorization: `Bearer test-${scenarioDefinition.label}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceType: 'file', table: 'universities', format: 'json', mode: 'upsert', rows: scenarioDefinition.rows,
        }),
      });
      assert.equal(response.status, 201);
      const payload = await response.json();
      assert.equal(payload.job.status, 'blocked');
      assert.ok(payload.job.review.issues.some((issue) => issue.code === scenarioDefinition.expectedCode));
    });
    assert.equal(scenario.calls.some((call) => (
      call.kind === 'execute' && /(?:INSERT INTO|UPDATE) `universities`/iu.test(call.sql)
    )), false);
  }
});

test('upsert 必须有可由 Agent 提供的完整业务唯一键', async () => {
  const scoreLineColumns = [
    {
      column_name: 'id', data_type: 'bigint', column_type: 'bigint unsigned', is_nullable: 'NO',
      column_default: null, column_key: 'PRI', extra: 'auto_increment', character_maximum_length: null,
    },
    {
      column_name: 'total_score', data_type: 'decimal', column_type: 'decimal(6,2)', is_nullable: 'NO',
      column_default: null, column_key: '', extra: '', character_maximum_length: null,
      numeric_precision: 6, numeric_scale: 2,
    },
  ];
  const cases = [
    {
      label: 'no-business-key',
      table: 'score_lines',
      rows: [{ total_score: '315.00' }],
      metadataColumns: scoreLineColumns,
      metadataIndexes: [{ index_name: 'PRIMARY', column_name: 'id', seq_in_index: 1, non_unique: 0 }],
    },
    {
      label: 'missing-business-key-value',
      table: 'universities',
      rows: [{ province: '北京' }],
      metadataColumns: columnRows,
      metadataIndexes: indexRows,
    },
  ];

  for (const definition of cases) {
    const scenario = createAgentDb({
      metadataColumns: definition.metadataColumns,
      metadataIndexes: definition.metadataIndexes,
      metadataForeignKeys: [],
    });
    const router = createAdminAgentRouter({
      database: async () => scenario.db,
      authenticate: async () => superAdmin,
      audit: async () => {},
    });
    await withRouter(router, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/database-agent/reviews`, {
        method: 'POST',
        headers: {
          authorization: `Bearer unsafe-upsert-${definition.label}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceType: 'file', table: definition.table, format: 'json', mode: 'upsert', rows: definition.rows,
        }),
      });
      assert.equal(response.status, 400);
      const payload = await response.json();
      assert.equal(payload.code, 'unsafe_upsert_key');
      assert.match(payload.error, /唯一键/);
    });
    assert.equal(scenario.calls.some((call) => (
      call.kind === 'execute' && /INSERT INTO (?:data_import_batches|source_documents|`score_lines`|`universities`)/iu.test(call.sql)
    )), false);
  }
});

test('外部文件不能伪造来源、核验或状态字段，内部来源链字段仍可由服务端附加', async () => {
  for (const [field, value] of [
    ['source_document_id', 999],
    ['verification_status', 'pending'],
    ['status', 'active'],
  ]) {
    const scenario = createAgentDb();
    const router = createAdminAgentRouter({
      database: async () => scenario.db,
      authenticate: async () => superAdmin,
      audit: async () => {},
    });
    await withRouter(router, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/database-agent/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'file',
          table: 'universities',
          format: 'json',
          mode: 'insert',
          rows: [{ name: '伪造字段大学', province: '北京', [field]: value }],
        }),
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, new RegExp(field, 'u'));
    });
    assert.equal(scenario.calls.some((call) => (
      call.kind === 'execute' && /INSERT INTO (?:data_import_batches|source_documents|`universities`)/iu.test(call.sql)
    )), false);
  }
});

test('review 失败时只有 reviewing 到 failed 的状态迁移命中后才失败导入批次', async () => {
  for (const affectedRows of [0, 1]) {
    const scenario = createAgentDb({
      failTransitionAffectedRows: affectedRows,
      allResult: async ({ sql }) => {
        if (sql.includes('JOIN `universities`')) throw new Error('模拟审核查询失败');
        return undefined;
      },
    });
    const router = createAdminAgentRouter({
      database: async () => scenario.db,
      authenticate: async () => superAdmin,
      audit: async () => {},
    });
    await withRouter(router, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/database-agent/reviews`, {
        method: 'POST',
        headers: {
          authorization: `Bearer fail-transition-${affectedRows}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sourceType: 'file', table: 'universities', format: 'json', mode: 'insert',
          rows: [{ name: `审核失败大学-${affectedRows}`, province: '北京' }],
        }),
      });
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /模拟审核查询失败/);
    });
    assert.ok(scenario.calls.some((call) => call.kind === 'execute' && /INSERT INTO data_import_batches/iu.test(call.sql)));
    assert.ok(scenario.calls.some((call) => (
      call.kind === 'execute' && /UPDATE admin_agent_jobs\s+SET status='failed'.*status='reviewing'/isu.test(call.sql)
    )));
    assert.equal(scenario.calls.some((call) => (
      call.kind === 'execute' && /SET b\.status='failed'/iu.test(call.sql)
    )), affectedRows === 1);
    assert.equal(scenario.state.job.status, affectedRows === 1 ? 'failed' : 'reviewing');
  }
});

test('告警和后台访问日志列表返回分页后的安全 DTO', async () => {
  const db = {
    one: async (sql) => {
      if (sql.includes('admin_access_logs')) return { total: 1 };
      if (sql.includes('admin_alerts')) return { total: 1 };
      return null;
    },
    all: async (sql) => {
      if (sql.includes('admin_access_logs')) return [{
        id: 3, actor_user_id: 1, actor_username: 'root', method: 'GET', path: '/api/admin/database/status',
        status_code: 200, duration_ms: 12, request_id: 'req-3', ip_address: '192.0.2.0', user_agent: 'test',
        created_at: '2026-08-11 10:00:00.000',
      }];
      if (sql.includes('admin_alerts')) return [{
        id: 4, alert_type: 'database_review_blocked', severity: 'critical', title: '数据审核阻断',
        message: '发现阻断问题', resource_type: 'admin_agent_job', resource_id: '9', details_json: '{"issueCount":1}',
        status: 'open', occurrence_count: 1, first_detected_at: '2026-08-11 10:00:00.000',
        last_detected_at: '2026-08-11 10:00:00.000', created_at: '2026-08-11 10:00:00.000', updated_at: null,
      }];
      return [];
    },
  };
  const router = createAdminAgentRouter({ database: async () => db, authenticate: async () => superAdmin });
  await withRouter(router, async (baseUrl) => {
    const logs = await fetch(`${baseUrl}/access-logs?page=1&pageSize=5`);
    assert.equal(logs.status, 200);
    const logPayload = await logs.json();
    assert.equal(logPayload.total, 1);
    assert.deepEqual(logPayload.data[0].actor, { id: 1, username: 'root' });
    assert.equal(logPayload.data[0].requestId, 'req-3');

    const alerts = await fetch(`${baseUrl}/alerts?status=open&severity=critical&pageSize=5`);
    assert.equal(alerts.status, 200);
    const alertPayload = await alerts.json();
    assert.equal(alertPayload.total, 1);
    assert.equal(alertPayload.data[0].severity, 'critical');
    assert.deepEqual(alertPayload.data[0].details, { issueCount: 1 });
  });
});
