import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentWritableColumns,
  rankDatabaseTableCandidates,
  mergeDatabaseReviews,
  runDeterministicDatabaseReview,
  selectDatabaseTableByHeuristic,
} from './database-manager-agent-service.js';

function column(name, {
  dataType = 'varchar', columnType = 'varchar(191)', nullable = true, defaultValue = null,
  autoIncrement = false, primaryKey = false, sensitive = false,
} = {}) {
  return { name, dataType, columnType, nullable, defaultValue, autoIncrement, primaryKey, sensitive };
}

test('规则审核同时拦截必填、枚举、范围、批内重复和缺失外键', async () => {
  const queries = [];
  const db = {
    all: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM `source_documents`')) return [{ value: 7 }];
      return [];
    },
  };
  const meta = {
    tableName: 'universities',
    columns: [
      column('id', { dataType: 'bigint', columnType: 'bigint unsigned', nullable: false, autoIncrement: true }),
      column('name', { nullable: false }),
      column('province', { nullable: false }),
      column('zone', { columnType: "enum('A','B')", nullable: false, defaultValue: 'A' }),
      column('score', { dataType: 'int', columnType: 'int unsigned' }),
      column('source_document_id', { dataType: 'bigint', columnType: 'bigint unsigned' }),
    ],
    uniqueKeys: [{ name: 'uq_universities_name', fields: ['name'] }],
    foreignKeys: [{
      field: 'source_document_id', referencedTable: 'source_documents', referencedField: 'id',
      constraintName: 'fk_universities_document',
    }],
  };

  const review = await runDeterministicDatabaseReview(db, meta, [
    { name: '重复大学', province: '', zone: 'C', score: 800, source_document_id: 99 },
    { name: '重复大学', province: '北京', zone: 'A', score: 500, source_document_id: 7 },
  ]);

  assert.equal(review.status, 'blocked');
  assert.equal(review.riskLevel, 'high');
  const codes = new Set(review.issues.map((issue) => issue.code));
  assert.ok(codes.has('required_field_missing'));
  assert.ok(codes.has('enum_value_invalid'));
  assert.ok(codes.has('score_out_of_range'));
  assert.ok(codes.has('duplicate_in_batch'));
  assert.ok(codes.has('foreign_key_missing'));
  assert.ok(queries.some(({ sql }) => sql.includes('JOIN `universities`')));
  assert.ok(queries.some(({ sql }) => sql.includes('FROM `source_documents`')));
});

test('upsert 命中数据库唯一键只产生 warning，不会被规则审核误判为阻断', async () => {
  const db = {
    all: async (sql) => (sql.includes('JOIN `universities`') ? [{ row_index: 0 }] : []),
  };
  const meta = {
    tableName: 'universities',
    columns: [
      column('id', { dataType: 'bigint', columnType: 'bigint unsigned', nullable: false, autoIncrement: true }),
      column('name', { nullable: false }),
    ],
    uniqueKeys: [{ name: 'uq_universities_name', fields: ['name'] }],
    foreignKeys: [],
  };

  const review = await runDeterministicDatabaseReview(db, meta, [{ name: '已存在大学' }], { mode: 'upsert' });
  assert.equal(review.status, 'warning');
  assert.equal(review.riskLevel, 'medium');
  assert.equal(review.issues[0].code, 'duplicate_in_database');
  assert.equal(review.issues[0].severity, 'warning');
});

test('upsert 的两条新行共享唯一键时审核必须阻断，不能留到第二次 INSERT 才失败', async () => {
  const db = { all: async () => [] };
  const meta = {
    tableName: 'universities',
    columns: [column('name', { nullable: false }), column('province', { nullable: false })],
    uniqueKeys: [{ name: 'uq_universities_name', fields: ['name'] }],
    foreignKeys: [],
  };
  const review = await runDeterministicDatabaseReview(db, meta, [
    { name: '共享唯一键大学', province: '北京' },
    { name: '共享唯一键大学', province: '上海' },
  ], { mode: 'upsert' });
  assert.equal(review.status, 'blocked');
  assert.equal(review.riskLevel, 'high');
  const duplicate = review.issues.find((issue) => issue.code === 'duplicate_in_batch');
  assert.ok(duplicate);
  assert.equal(duplicate.severity, 'error');
});

test('复合唯一键中的空字符串仍参与批内重复检测', async () => {
  const db = { all: async () => [] };
  const meta = {
    tableName: 'programs',
    columns: [column('university_id'), column('code'), column('direction')],
    uniqueKeys: [{ name: 'uq_program_identity', fields: ['university_id', 'code', 'direction'] }],
    foreignKeys: [],
  };
  const review = await runDeterministicDatabaseReview(db, meta, [
    { university_id: 1, code: '081200', direction: '' },
    { university_id: 1, code: '081200', direction: '' },
  ]);
  assert.equal(review.status, 'blocked');
  assert.ok(review.issues.some((issue) => issue.code === 'duplicate_in_batch'));
});

test('唯一键按数据库大小写不敏感语义检测批内和库内重复', async () => {
  const queries = [];
  const db = {
    all: async (sql, params) => {
      queries.push({ sql, params });
      return sql.includes('JOIN `universities`') ? [{ row_index: 0 }] : [];
    },
  };
  const meta = {
    tableName: 'universities',
    columns: [column('name', { nullable: false })],
    uniqueKeys: [{ name: 'uq_universities_name', fields: ['name'] }],
    foreignKeys: [],
  };
  const review = await runDeterministicDatabaseReview(db, meta, [
    { name: 'Example University' },
    { name: 'example university' },
  ]);
  const codes = review.issues.map((issue) => issue.code);
  assert.ok(codes.includes('duplicate_in_batch'));
  assert.ok(codes.includes('duplicate_in_database'));
  assert.ok(queries.some(({ sql, params }) => sql.includes('incoming.row_index') && params[0] === 0));
});

test('大量 warning 不能截断后续 error 并把阻断审核误降级', async () => {
  const db = {
    all: async (sql) => (sql.includes('FROM `source_documents`') ? [{ value: 7 }] : []),
  };
  const meta = {
    tableName: 'universities',
    columns: [
      column('id', { dataType: 'bigint', columnType: 'bigint unsigned', nullable: false, autoIncrement: true }),
      column('name', { nullable: false }),
      column('website'),
      column('source_document_id', { dataType: 'bigint', columnType: 'bigint unsigned' }),
    ],
    uniqueKeys: [],
    foreignKeys: [{
      field: 'source_document_id', referencedTable: 'source_documents', referencedField: 'id',
      constraintName: 'fk_universities_document',
    }],
  };
  const rows = Array.from({ length: 301 }, (_, index) => ({
    name: `测试大学-${index}`,
    website: '不是网址',
    source_document_id: index === 300 ? 999 : 7,
  }));

  const review = await runDeterministicDatabaseReview(db, meta, rows);
  assert.equal(review.status, 'blocked');
  assert.equal(review.riskLevel, 'high');
  assert.ok(review.issues.some((issue) => issue.code === 'foreign_key_missing'));
  assert.ok(review.issues.length <= 300);
});

test('模型拒绝或高风险结论只能加严规则审核，不能批准阻断数据', () => {
  const deterministic = {
    status: 'passed', riskLevel: 'low', summary: '规则通过', recommendation: '人工确认', issues: [],
  };
  const merged = mergeDatabaseReviews(deterministic, {
    approved: false,
    riskLevel: 'high',
    summary: '来源表述存在歧义',
    recommendation: '补充来源',
    issues: [{ rowIndex: 0, field: 'name', code: 'ambiguous_name', severity: 'warning', message: '名称有歧义', source: 'model' }],
  });
  assert.equal(merged.status, 'blocked');
  assert.equal(merged.riskLevel, 'high');
  assert.equal(merged.modelStatus, 'completed');
  assert.equal(merged.modelIssueCount, 1);

  const hardBlocked = mergeDatabaseReviews({
    status: 'blocked', riskLevel: 'high', summary: '硬规则阻断', recommendation: '修正',
    issues: [{ rowIndex: 0, field: 'score', code: 'score_out_of_range', severity: 'error', message: '越界', source: 'rules' }],
  }, {
    approved: true, riskLevel: 'low', summary: '模型认为可用', recommendation: '确认', issues: [],
  });
  assert.equal(hardBlocked.status, 'blocked');
  assert.equal(hardBlocked.riskLevel, 'high');
});

test('300 个规则 warning 之后的模型 critical 仍保留并阻断审核', () => {
  const deterministic = {
    status: 'warning',
    riskLevel: 'medium',
    summary: '规则发现大量提示',
    recommendation: '人工核对',
    issues: Array.from({ length: 300 }, (_, rowIndex) => ({
      rowIndex,
      field: 'website',
      code: 'url_value_invalid',
      severity: 'warning',
      message: '网址格式需要核对',
      source: 'rules',
    })),
    issueCount: 300,
  };
  const merged = mergeDatabaseReviews(deterministic, {
    approved: true,
    riskLevel: 'low',
    summary: '模型发现关键问题',
    recommendation: '修正后重试',
    issues: [{
      rowIndex: 299,
      field: 'name',
      code: 'semantic_integrity_failure',
      severity: 'critical',
      message: '语义一致性校验失败',
      source: 'model',
    }],
  });
  assert.equal(merged.status, 'blocked');
  assert.equal(merged.riskLevel, 'blocked');
  assert.ok(merged.issues.some((issue) => issue.code === 'semantic_integrity_failure'));
  assert.ok(merged.issues.length <= 300);
});

test('模型可见字段排除敏感、服务端时间戳和来源核验字段', () => {
  const writable = agentWritableColumns({
    columns: [
      column('name', { nullable: false }),
      column('id', { dataType: 'bigint', columnType: 'bigint unsigned', autoIncrement: true, primaryKey: true }),
      column('natural_key', { primaryKey: true }),
      column('password_hash', { sensitive: true }),
      column('created_at', { dataType: 'datetime', columnType: 'datetime', nullable: false }),
      column('source_document_id', { dataType: 'bigint', columnType: 'bigint unsigned' }),
      column('verification_status'),
      column('catalog_status'),
    ],
  });
  assert.deepEqual(writable.map((item) => item.name), ['name']);
});

test('自动表识别优先使用字段覆盖率和考研业务语义线索', () => {
  const metas = [
    {
      tableName: 'national_lines',
      columns: [
        column('year', { nullable: false }),
        column('degree', { nullable: false }),
        column('category', { nullable: false }),
        column('zone', { nullable: false }),
        column('score', { nullable: false }),
      ],
      primaryColumns: [],
      uniqueKeys: [{ name: 'uq_national_lines_lookup', fields: ['year', 'degree', 'category', 'zone'] }],
      foreignKeys: [],
    },
    {
      tableName: 'universities',
      columns: [
        column('name', { nullable: false }),
        column('province', { nullable: false }),
        column('zone', { nullable: false }),
        column('level', { nullable: false }),
        column('type'),
      ],
      primaryColumns: [],
      uniqueKeys: [{ name: 'uq_universities_name', fields: ['name'] }],
      foreignKeys: [],
    },
  ];
  const rows = [{ year: 2026, degree: '学硕', category: '工学', zone: 'A', score: 254 }];
  const ranked = rankDatabaseTableCandidates(metas, { instruction: '2026 年考研国家线', rows });
  const selected = selectDatabaseTableByHeuristic(metas, { instruction: '2026 年考研国家线', rows });

  assert.equal(ranked[0].table, 'national_lines');
  assert.equal(selected.table, 'national_lines');
  assert.ok(selected.confidence > 0.6);
});
