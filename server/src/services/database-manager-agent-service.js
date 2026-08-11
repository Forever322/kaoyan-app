const MAX_REVIEW_ISSUES = 300;
const CHUNK_SIZE = 200;
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);
const SEVERITY_WEIGHT = Object.freeze({ info: 0, warning: 1, error: 2, critical: 3 });

function quoteIdentifier(value) {
  const identifier = String(value || '');
  if (!/^[A-Za-z0-9_]{1,64}$/u.test(identifier)) throw new Error('审核元数据包含非法标识符');
  return `\`${identifier}\``;
}

function empty(value) {
  return value === undefined || value === null || value === '';
}

function reviewIssue(rowIndex, field, code, severity, message, source = 'rules') {
  return { rowIndex, field, code, severity, message, source };
}

function enumValues(columnType) {
  const match = String(columnType || '').match(/^enum\((.*)\)$/iu);
  if (!match) return [];
  return [...match[1].matchAll(/'((?:[^'\\]|\\.)*)'/gu)].map((item) => item[1].replaceAll("\\'", "'"));
}

function deterministicFieldIssues(meta, rows) {
  const issues = [];
  const required = meta.columns.filter((column) => (
    !column.nullable && column.defaultValue === null && !column.autoIncrement
  ));
  const columns = new Map(meta.columns.map((column) => [column.name, column]));

  rows.forEach((row, rowIndex) => {
    for (const column of required) {
      if (empty(row[column.name])) {
        issues.push(reviewIssue(rowIndex, column.name, 'required_field_missing', 'error', `缺少必填字段 ${column.name}`));
      }
    }
    for (const [field, value] of Object.entries(row)) {
      const column = columns.get(field);
      if (!column || empty(value)) continue;
      const allowedEnumValues = enumValues(column.columnType);
      if (allowedEnumValues.length && !allowedEnumValues.includes(String(value))) {
        issues.push(reviewIssue(rowIndex, field, 'enum_value_invalid', 'error', `${field} 不在允许枚举值中`));
      }
      if (/\bunsigned\b/iu.test(column.columnType || '') && Number(value) < 0) {
        issues.push(reviewIssue(rowIndex, field, 'unsigned_value_negative', 'error', `${field} 不能是负数`));
      }
      if (DATE_TYPES.has(column.dataType) && Number.isNaN(new Date(String(value)).getTime())) {
        issues.push(reviewIssue(rowIndex, field, 'date_value_invalid', 'error', `${field} 不是有效日期`));
      }
      if (/(?:^|_)(?:url|uri|website)$/iu.test(field)) {
        try {
          const url = new URL(String(value));
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
        } catch {
          issues.push(reviewIssue(rowIndex, field, 'url_value_invalid', 'warning', `${field} 不是有效的 HTTP(S) 地址`));
        }
      }
      if (/(?:^|_)(?:year)$/iu.test(field)) {
        const year = Number(value);
        if (!Number.isInteger(year) || year < 1978 || year > new Date().getUTCFullYear() + 3) {
          issues.push(reviewIssue(rowIndex, field, 'year_out_of_range', 'warning', `${field} 年份超出合理范围`));
        }
      }
      if (/(?:score|total_score|line)$/iu.test(field)) {
        const score = Number(value);
        if (Number.isFinite(score) && (score < 0 || score > 750)) {
          issues.push(reviewIssue(rowIndex, field, 'score_out_of_range', 'error', `${field} 分数应在 0–750 之间`));
        }
      }
    }
  });
  return issues;
}

function uniqueKeyParts(uniqueKey) {
  if (Array.isArray(uniqueKey.parts) && uniqueKey.parts.length) return uniqueKey.parts;
  return (uniqueKey.fields || []).map((field) => ({ field, prefixLength: null }));
}

function canonicalUniqueValue(value, prefixLength) {
  let normalized = String(value)
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase('und')
    .trimEnd();
  if (prefixLength) normalized = [...normalized].slice(0, prefixLength).join('');
  return normalized;
}

function tupleKey(row, uniqueKey) {
  const parts = uniqueKeyParts(uniqueKey);
  if (!parts.length || parts.some(({ field }) => row[field] === undefined || row[field] === null)) return '';
  return JSON.stringify(parts.map(({ field, prefixLength }) => canonicalUniqueValue(row[field], prefixLength)));
}

async function queryUniqueKeyMatches(db, meta, rows, uniqueKey, { includeRecords = false, lock = false } = {}) {
  const parts = uniqueKeyParts(uniqueKey);
  const fields = parts.map((part) => part.field);
  const candidates = rows
    .map((row, rowIndex) => ({ row, rowIndex, key: tupleKey(row, uniqueKey) }))
    .filter((item) => item.key);
  const matches = [];
  for (let offset = 0; offset < candidates.length; offset += CHUNK_SIZE) {
    const chunk = candidates.slice(offset, offset + CHUNK_SIZE);
    const incomingRows = chunk.map(() => `SELECT ? AS row_index,${fields.map((field) => `? AS ${quoteIdentifier(field)}`).join(',')}`);
    const params = chunk.flatMap((item) => [item.rowIndex, ...fields.map((field) => item.row[field])]);
    const comparisons = parts.map(({ field, prefixLength }) => {
      const existing = `existing.${quoteIdentifier(field)}`;
      const incoming = `incoming.${quoteIdentifier(field)}`;
      return prefixLength
        ? `LEFT(${existing},${Number(prefixLength)})=LEFT(${incoming},${Number(prefixLength)})`
        : `${existing}=${incoming}`;
    });
    const selected = includeRecords ? ',existing.*' : '';
    const records = await db.all(`SELECT incoming.row_index AS __agent_row_index${selected}
      FROM (${incomingRows.join(' UNION ALL ')}) AS incoming
      INNER JOIN ${quoteIdentifier(meta.tableName)} AS existing ON ${comparisons.join(' AND ')}${lock ? ' FOR UPDATE' : ''}`, params);
    matches.push(...(records || []));
  }
  return { candidates, matches };
}

export async function inspectDatabaseState(db, meta, rows, { lock = false } = {}) {
  const states = rows.map(() => ({ keys: [], existingRecord: null, conflict: false }));
  for (const uniqueKey of meta.uniqueKeys || []) {
    const { candidates, matches } = await queryUniqueKeyMatches(db, meta, rows, uniqueKey, { includeRecords: true, lock });
    for (const candidate of candidates) states[candidate.rowIndex].keys.push({ name: uniqueKey.name, record: null });
    for (const match of matches) {
      const rowIndex = Number(match.__agent_row_index ?? match.row_index ?? match.ROW_INDEX);
      if (!Number.isInteger(rowIndex) || !states[rowIndex]) continue;
      const record = Object.fromEntries(Object.entries(match).filter(([key]) => !['__agent_row_index', 'row_index', 'ROW_INDEX'].includes(key)));
      const keyState = states[rowIndex].keys.find((item) => item.name === uniqueKey.name);
      if (keyState) keyState.record = record;
    }
  }
  for (const state of states) {
    const records = state.keys.filter((item) => item.record).map((item) => item.record);
    const identities = new Set(records.map((record) => JSON.stringify(
      meta.primaryColumns.length
        ? meta.primaryColumns.map((column) => record[column.name])
        : record,
    )));
    state.conflict = identities.size > 1;
    state.existingRecord = records[0] || null;
  }
  return states;
}

export function databaseStateSnapshot(meta, states) {
  return {
    table: meta.tableName,
    rows: states.map((state, rowIndex) => ({
      rowIndex,
      conflict: state.conflict,
      keys: state.keys.map((key) => ({ name: key.name, record: key.record })),
    })),
  };
}

function batchDuplicateIssues(meta, rows, mode) {
  const issues = [];
  for (const uniqueKey of meta.uniqueKeys || []) {
    const seen = new Map();
    rows.forEach((row, rowIndex) => {
      const key = tupleKey(row, uniqueKey);
      if (!key) return;
      if (seen.has(key)) {
        issues.push(reviewIssue(
          rowIndex,
          uniqueKey.fields.join(','),
          'duplicate_in_batch',
          'error',
          `与第 ${seen.get(key) + 1} 行的唯一键 ${uniqueKey.name} 重复`,
        ));
      } else seen.set(key, rowIndex);
    });
  }
  return issues;
}

async function existingDuplicateIssues(db, meta, rows, mode) {
  const issues = [];
  for (const uniqueKey of meta.uniqueKeys || []) {
    const fields = uniqueKeyParts(uniqueKey).map((part) => part.field);
    const { candidates, matches } = await queryUniqueKeyMatches(db, meta, rows, uniqueKey);
    const existingRows = new Set(matches.map((row) => Number(row.__agent_row_index ?? row.row_index ?? row.ROW_INDEX)));
    for (const item of candidates) {
      if (!existingRows.has(item.rowIndex)) continue;
      issues.push(reviewIssue(
        item.rowIndex,
        fields.join(','),
        'duplicate_in_database',
        mode === 'upsert' ? 'warning' : 'error',
        mode === 'upsert' ? `唯一键 ${uniqueKey.name} 已存在，确认后会更新该记录` : `唯一键 ${uniqueKey.name} 已存在`,
      ));
    }
  }
  return issues;
}

function databaseStateDuplicateIssues(meta, mode, states) {
  const keyByName = new Map((meta.uniqueKeys || []).map((key) => [key.name, key]));
  const issues = [];
  (states || []).forEach((state, rowIndex) => {
    for (const keyState of state?.keys || []) {
      if (!keyState.record) continue;
      const uniqueKey = keyByName.get(keyState.name);
      const fields = uniqueKeyParts(uniqueKey || {}).map((part) => part.field);
      issues.push(reviewIssue(
        rowIndex,
        fields.join(','),
        'duplicate_in_database',
        mode === 'upsert' ? 'warning' : 'error',
        mode === 'upsert' ? `唯一键 ${keyState.name} 已存在，确认后会更新该记录` : `唯一键 ${keyState.name} 已存在`,
      ));
    }
  });
  return issues;
}

async function foreignKeyIssues(db, meta, rows) {
  const issues = [];
  for (const foreignKey of meta.foreignKeys || []) {
    const values = [...new Set(rows.map((row) => row[foreignKey.field]).filter((value) => !empty(value)))];
    if (!values.length) continue;
    const existingValues = new Set();
    for (let offset = 0; offset < values.length; offset += CHUNK_SIZE) {
      const chunk = values.slice(offset, offset + CHUNK_SIZE);
      const records = await db.all(
        `SELECT ${quoteIdentifier(foreignKey.referencedField)} AS value FROM ${quoteIdentifier(foreignKey.referencedTable)} WHERE ${quoteIdentifier(foreignKey.referencedField)} IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      );
      for (const record of records || []) existingValues.add(String(record.value));
    }
    rows.forEach((row, rowIndex) => {
      const value = row[foreignKey.field];
      if (empty(value) || existingValues.has(String(value))) return;
      issues.push(reviewIssue(
        rowIndex,
        foreignKey.field,
        'foreign_key_missing',
        'error',
        `${foreignKey.field} 在关联表 ${foreignKey.referencedTable} 中不存在`,
      ));
    });
  }
  return issues;
}

function highestSeverity(issues) {
  return issues.reduce((highest, issue) => (
    SEVERITY_WEIGHT[issue.severity] > SEVERITY_WEIGHT[highest] ? issue.severity : highest
  ), 'info');
}

function visibleIssues(issues) {
  return [...issues]
    .sort((left, right) => SEVERITY_WEIGHT[right.severity] - SEVERITY_WEIGHT[left.severity])
    .slice(0, MAX_REVIEW_ISSUES);
}

const TABLE_HINTS = Object.freeze({
  universities: ['院校', '学校', '大学', '学院', '985', '211', '双一流', '分区', 'province', 'institution_code'],
  uni_details: ['简介', '官网', '地址', '电话', '优势', '劣势', '排名', 'english_name', 'website', 'description'],
  uni_photos: ['照片', '图片', '校园', 'filename', 'source_url', 'license_url', 'attribution'],
  national_lines: ['国家线', '国家分数线', 'a区线', 'b区线', 'degree', 'category', 'zone', 'score'],
  admission_scores: ['录取分数', '院线', '录取线', '历年分数', 'university_id', 'year', 'score'],
  uni_requirements: ['报考要求', '招生要求', '同等学力', '跨考', '加试', 'requirement'],
  university_aliases: ['别名', '曾用名', '历史名称', 'alias_name', 'alias_type'],
  campuses: ['校区', '校园地址', '邮编', '经纬度', 'campus', 'postal_code', 'latitude', 'longitude'],
  academic_units: ['学院', '院系', '研究院', '学部', 'academic_unit', 'unit_type', 'parent_id'],
  programs: ['专业目录', '专业代码', '研究方向', 'discipline_code', 'program_type', 'direction'],
  program_offerings: ['招生计划', '招生人数', '推免', '学制', '学费', '统考', 'enrollment_plan', 'tuition_fee'],
  exam_subjects: ['考试科目', '参考书', '科目代码', 'subject_code', 'full_score', 'reference_books'],
  admission_statistics: ['报录比', '录取人数', '报名人数', '平均分', '最高分', '最低分', 'admitted_count', 'average_score'],
  score_lines: ['复试线', '分数线', '单科线', '总分线', 'politics_line', 'foreign_language_line', 'total_score'],
  retest_rules: ['复试办法', '复试比例', '初试权重', '面试权重', '调剂政策', 'retest_mode', 'interview_weight'],
});

function normalizedSearchText(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function tableHintMatches(tableName, text) {
  const hints = TABLE_HINTS[tableName] || [];
  return hints.filter((hint) => text.includes(normalizedSearchText(hint))).length;
}

function requiredColumnNames(meta) {
  return new Set(meta.columns
    .filter((column) => !column.nullable && column.defaultValue === null && !column.autoIncrement)
    .map((column) => column.name));
}

export function describeDatabaseTable(meta) {
  const writable = agentWritableColumns(meta);
  const writableNames = new Set(writable.map((column) => column.name));
  return {
    table: meta.tableName,
    description: TABLE_HINTS[meta.tableName]?.slice(0, 8) || [],
    primaryKey: meta.primaryColumns.map((column) => column.name),
    uniqueKeys: (meta.uniqueKeys || []).map((key) => ({ name: key.name, fields: key.fields })),
    foreignKeys: (meta.foreignKeys || []).map((key) => ({
      field: key.field,
      references: `${key.referencedTable}.${key.referencedField}`,
    })),
    columns: meta.columns
      .filter((column) => writableNames.has(column.name))
      .map((column) => ({
        name: column.name,
        type: column.columnType || column.dataType,
        required: !column.nullable && column.defaultValue === null && !column.autoIncrement,
        unique: (meta.uniqueKeys || []).some((key) => key.fields.length === 1 && key.fields[0] === column.name),
      })),
  };
}

export function rankDatabaseTableCandidates(metas, { instruction = '', rows = [] } = {}) {
  const inputRows = Array.isArray(rows) ? rows.slice(0, 50) : [];
  const inputFields = new Set(inputRows.flatMap((row) => (
    row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : []
  )));
  const inputText = normalizedSearchText([
    instruction,
    ...inputRows.slice(0, 5).flatMap((row) => Object.values(row || {})),
  ].join(' '));

  return metas.map((meta) => {
    const writable = agentWritableColumns(meta);
    const writableNames = new Set(writable.map((column) => column.name));
    const allNames = new Set(meta.columns.map((column) => column.name));
    const required = requiredColumnNames(meta);
    const matchedFields = [...inputFields].filter((field) => writableNames.has(field));
    const knownFields = [...inputFields].filter((field) => allNames.has(field));
    const unknownFields = [...inputFields].filter((field) => !allNames.has(field));
    const uniqueFields = new Set((meta.uniqueKeys || []).flatMap((key) => key.fields));
    const matchedRequired = [...required].filter((field) => inputFields.has(field)).length;
    const hints = tableHintMatches(meta.tableName, inputText);
    const coverage = inputFields.size ? matchedFields.length / inputFields.size : 0;
    const unknownRatio = inputFields.size ? unknownFields.length / inputFields.size : 0;

    let score = matchedFields.length * 5
      + knownFields.length * 2
      + matchedRequired * 3
      + matchedFields.filter((field) => uniqueFields.has(field)).length * 2
      + hints * 4
      + (inputText.includes(normalizedSearchText(meta.tableName)) ? 8 : 0);
    score += Math.round(coverage * 30);
    score -= Math.round(unknownRatio * 20);

    return {
      table: meta.tableName,
      score,
      matchedFields,
      matchedRequired,
      hints,
      coverage: Number(coverage.toFixed(3)),
      unknownRatio: Number(unknownRatio.toFixed(3)),
    };
  }).sort((left, right) => right.score - left.score || right.coverage - left.coverage || left.table.localeCompare(right.table));
}

export function selectDatabaseTableByHeuristic(metas, options = {}) {
  const candidates = rankDatabaseTableCandidates(metas, options);
  const top = candidates[0];
  const second = candidates[1];
  if (!top) return null;
  const margin = top.score - (second?.score || 0);
  const reliable = top.score >= 8
    && (margin >= 4 || top.coverage >= 0.6 || top.hints >= 2)
    && top.unknownRatio <= 0.6;
  if (!reliable) return null;
  return {
    table: top.table,
    confidence: Math.min(0.96, Number((0.45 + Math.max(0, margin) / 30 + top.coverage * 0.35 + top.hints * 0.03).toFixed(3))),
    reason: `字段覆盖 ${Math.round(top.coverage * 100)}%，命中 ${top.hints} 个语义线索`,
    candidates: candidates.slice(0, 5),
  };
}

export function agentWritableColumns(meta) {
  const excluded = new Set([
    'created_at', 'updated_at', 'deleted_at', 'applied_at', 'confirmed_at', 'completed_at',
    'source_document_id', 'import_batch_id', 'verification_status', 'catalog_status', 'status',
  ]);
  return meta.columns.filter((column) => (
    !column.sensitive && !column.autoIncrement && !column.primaryKey && !excluded.has(column.name)
  ));
}

export async function runDeterministicDatabaseReview(db, meta, rows, { mode = 'insert', databaseState = null } = {}) {
  const allIssues = [
    ...deterministicFieldIssues(meta, rows),
    ...batchDuplicateIssues(meta, rows, mode),
    ...(databaseState
      ? databaseStateDuplicateIssues(meta, mode, databaseState)
      : await existingDuplicateIssues(db, meta, rows, mode)),
    ...await foreignKeyIssues(db, meta, rows),
  ];
  const highest = highestSeverity(allIssues);
  const issues = visibleIssues(allIssues);
  return {
    status: ['error', 'critical'].includes(highest) ? 'blocked' : issues.length ? 'warning' : 'passed',
    riskLevel: highest === 'critical' ? 'blocked' : highest === 'error' ? 'high' : highest === 'warning' ? 'medium' : 'low',
    summary: allIssues.length ? `规则审核发现 ${allIssues.length} 个问题` : `规则审核通过，共 ${rows.length} 行`,
    recommendation: ['error', 'critical'].includes(highest) ? '修正阻断问题后重新提交审核。' : '请核对预览内容和来源，确认后再写入。',
    issues,
    issueCount: allIssues.length,
    highestSeverity: highest,
  };
}

export function mergeDatabaseReviews(deterministic, modelReview = null) {
  const modelIssues = modelReview?.issues || [];
  const combinedIssues = [...deterministic.issues, ...modelIssues];
  const issues = visibleIssues(combinedIssues);
  const highest = highestSeverity(combinedIssues);
  const modelBlocks = modelReview && (modelReview.approved === false || ['high', 'blocked'].includes(modelReview.riskLevel));
  const blocked = deterministic.status === 'blocked' || ['error', 'critical'].includes(highest) || modelBlocks;
  return {
    status: blocked ? 'blocked' : issues.length ? 'warning' : 'passed',
    riskLevel: blocked ? (highest === 'critical' || modelReview?.riskLevel === 'blocked' ? 'blocked' : 'high')
      : highest === 'warning' || modelReview?.riskLevel === 'medium' ? 'medium' : 'low',
    summary: modelReview?.summary || deterministic.summary,
    recommendation: blocked
      ? (modelReview?.recommendation || '修正阻断问题后重新提交审核。')
      : (modelReview?.recommendation || deterministic.recommendation),
    issues,
    deterministicIssueCount: deterministic.issueCount ?? deterministic.issues.length,
    modelIssueCount: modelIssues.length,
    modelStatus: modelReview ? 'completed' : 'not_configured',
  };
}
