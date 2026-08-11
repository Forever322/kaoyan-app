import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { getDB } from '../db/index.js';
import { isSuperAdministrator, requireAdministrator } from '../middleware/admin-auth.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import {
  checksumRows,
  insertRows,
  loadTableMetadata,
  normalizeDatabaseRow,
  normalizeImportRows,
  redactDatabaseRow,
  requireWritableDatabaseTable,
} from './admin-database.js';
import {
  DATABASE_REVIEW_SAMPLE_LIMIT,
  generateDatabaseRows,
  isAgentModelConfigured,
  reviewDatabaseContent,
} from '../services/agent-service.js';
import { runAuditedAgentCall } from '../services/agent-run-service.js';
import { assertAgentCapabilityEnabled } from '../services/agent-runtime-policy.js';
import {
  agentWritableColumns,
  databaseStateSnapshot,
  inspectDatabaseState,
  mergeDatabaseReviews,
  runDeterministicDatabaseReview,
} from '../services/database-manager-agent-service.js';
import { requestAuditMetadata, writeAdminAudit } from '../services/admin-audit-service.js';
import { adminAlertKey, publicAdminAlert, upsertAdminAlert } from '../services/admin-alert-service.js';

const DATABASE_MANAGER_AGENT_TYPE = 'database-manager';
const FILE_FORMATS = new Set(['csv', 'txt', 'json', 'sql', 'xlsx', 'db']);
const JOB_STATUSES = new Set(['reviewing', 'awaiting_confirmation', 'blocked', 'completed', 'rejected', 'failed', 'expired']);
const ALERT_STATUSES = new Set(['open', 'acknowledged', 'resolved']);
const ALERT_SEVERITIES = new Set(['info', 'warning', 'error', 'critical']);
const SOURCE_TYPES = new Set(['text', 'voice', 'file']);
const MAX_PAGE = 10_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_INSTRUCTION_LENGTH = 8_000;
const MAX_AGENT_ROWS = Math.min(1_000, Math.max(1, Number(process.env.ADMIN_AGENT_MAX_ROWS || 500)));
const DATABASE_REVIEW_POLICY_VERSION = '2026-08-11.3';
const STAGING_TTL_HOURS = Math.min(168, Math.max(1, Number(process.env.ADMIN_AGENT_STAGING_TTL_HOURS || 24)));
const ADMIN_AGENT_REQUESTS_PER_MINUTE = Math.min(30, Math.max(1, Number(process.env.ADMIN_AGENT_REQUESTS_PER_MINUTE || 6)));
const generationRateLimiter = createRateLimiter({ windowMs: 60_000, max: ADMIN_AGENT_REQUESTS_PER_MINUTE });

function requestError(message, status = 400, code = '') {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function isExpiredUtcTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const timestamp = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/u.test(iso) ? iso : `${iso}Z`);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function positiveInteger(value, field, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/u.test(text)) throw requestError(`${field} 必须是整数`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw requestError(`${field} 超出允许范围`);
  return number;
}

function pagination(query = {}) {
  const page = query.page ? positiveInteger(query.page, 'page', { max: MAX_PAGE }) : 1;
  const pageSize = query.pageSize ? positiveInteger(query.pageSize, 'pageSize', { max: MAX_PAGE_SIZE }) : DEFAULT_PAGE_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function bounded(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function mysqlUtcDate(date) {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function stagingExpiry() {
  return mysqlUtcDate(new Date(Date.now() + STAGING_TTL_HOURS * 3_600_000));
}

function databaseReviewModelVersion() {
  return `${bounded(process.env.LLM_PROVIDER || 'openai-compatible', 40)}:${bounded(process.env.AGENT_MODEL || 'deepseek-chat', 80)}`;
}

function sourceChecksum(body, sourceType) {
  const hash = createHash('sha256');
  if (sourceType === 'file' && Array.isArray(body.rows)) {
    return checksumRows(body.rows);
  }
  if (sourceType === 'file' && typeof body.contentBase64 === 'string') {
    hash.update(Buffer.from(body.contentBase64, 'base64'));
  } else if (sourceType === 'file' && typeof body.content === 'string') {
    hash.update(body.content, 'utf8');
  } else {
    hash.update(String(body.instruction || ''), 'utf8');
  }
  return hash.digest('hex');
}

function normalizeSourceType(value) {
  const sourceType = String(value || 'text').trim().toLowerCase();
  if (!SOURCE_TYPES.has(sourceType)) throw requestError('sourceType 必须是 text、voice 或 file');
  return sourceType;
}

function normalizeMode(value) {
  const mode = String(value || 'insert').trim().toLowerCase();
  if (!['insert', 'upsert'].includes(mode)) throw requestError('mode 必须是 insert 或 upsert');
  return mode;
}

function normalizeFormat(value) {
  const format = String(value || '').trim().toLowerCase();
  if (!FILE_FORMATS.has(format)) throw requestError(`format 必须是 ${[...FILE_FORMATS].join(' / ')}`);
  return format;
}

function requireSuperAdministrator(actor) {
  if (!isSuperAdministrator(actor)) throw requestError('只有超级管理员可以使用数据库管理 Agent', 403);
}

function assertAgentRowsWritable(meta, rows) {
  const allowed = new Set(agentWritableColumns(meta).map((column) => column.name));
  for (const row of rows) {
    for (const field of Object.keys(row)) {
      if (!allowed.has(field)) {
        throw requestError(`字段 ${field} 由系统管理，不能通过 Agent 导入`);
      }
    }
  }
}

function assertSafeAgentUpsert(meta, rows, mode) {
  if (mode !== 'upsert') return;
  const allowed = new Set(agentWritableColumns(meta).map((column) => column.name));
  const resolvableKeys = (meta.uniqueKeys || []).filter((key) => (
    Array.isArray(key.fields) && key.fields.length > 0 && key.fields.every((field) => allowed.has(field))
  ));
  if (!resolvableKeys.length) {
    throw requestError('目标表没有 Agent 可安全解析的业务唯一键，不能使用 upsert；请改为新增或使用领域更新接口', 400, 'unsafe_upsert_key');
  }
  const unresolvedRow = rows.findIndex((row) => !resolvableKeys.some((key) => key.fields.every((field) => (
    Object.prototype.hasOwnProperty.call(row, field) && row[field] !== null && row[field] !== undefined
  ))));
  if (unresolvedRow >= 0) {
    throw requestError(`upsert 第 ${unresolvedRow + 1} 行缺少完整业务唯一键，无法确定要更新的记录`, 400, 'unsafe_upsert_key');
  }
}

function repeatedExistingEntityRows(meta, states) {
  if (!meta.primaryColumns.length) return [];
  const seen = new Map();
  const repeated = [];
  states.forEach((state, rowIndex) => {
    if (!state.existingRecord) return;
    const identity = JSON.stringify(meta.primaryColumns.map((column) => state.existingRecord[column.name]));
    if (seen.has(identity)) repeated.push({ rowIndex, firstRowIndex: seen.get(identity) });
    else seen.set(identity, rowIndex);
  });
  return repeated;
}

function publicJob(row) {
  const rows = parseJson(row.normalized_rows_json, []);
  return {
    id: Number(row.id),
    targetTable: row.target_table || '',
    sourceType: row.source_type || 'text',
    sourceName: row.source_name || '',
    status: row.status || 'reviewing',
    reviewStatus: row.review_status || 'pending',
    mode: row.operation_mode || 'insert',
    format: row.input_format || '',
    rowCount: Number(row.row_count || 0),
    checksum: row.checksum || '',
    preview: Array.isArray(rows) ? rows.slice(0, 20) : [],
    review: parseJson(row.review_json, null),
    model: row.model || '',
    affectedRows: Number(row.affected_rows || 0),
    errorCode: row.error_code || '',
    errorMessage: row.error_message || '',
    actor: row.actor_user_id ? { id: Number(row.actor_user_id), username: row.actor_username || '' } : null,
    confirmedBy: row.confirmed_by_user_id ? {
      id: Number(row.confirmed_by_user_id), username: row.confirmer_username || '',
    } : null,
    expiresAt: row.expires_at || null,
    confirmedAt: row.confirmed_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function publicRun(row) {
  return {
    id: Number(row.id),
    jobId: row.admin_agent_job_id ? Number(row.admin_agent_job_id) : null,
    actor: row.username ? { id: Number(row.user_id), username: row.username } : null,
    runType: row.run_type,
    status: row.status,
    model: row.model || '',
    inputChars: Number(row.input_chars || 0),
    outputChars: Number(row.output_chars || 0),
    durationMs: Number(row.duration_ms || 0),
    errorCode: row.error_code || '',
    createdAt: row.created_at || null,
  };
}

function publicAccessLog(row) {
  return {
    id: Number(row.id),
    actor: row.actor_user_id ? { id: Number(row.actor_user_id), username: row.actor_username || '' } : null,
    method: row.method,
    path: row.path,
    statusCode: Number(row.status_code || 0),
    durationMs: Number(row.duration_ms || 0),
    requestId: row.request_id || '',
    ipAddress: row.ip_address || '',
    userAgent: row.user_agent || '',
    createdAt: row.created_at || null,
  };
}

export async function purgeExpiredAgentPayloads(db) {
  await db.transaction(async (tx) => {
    await tx.execute(`UPDATE data_import_batches b INNER JOIN admin_agent_jobs j ON j.import_batch_id=b.id
      SET b.status='expired',b.error_summary='审核任务已过期',b.finished_at=UTC_TIMESTAMP(3)
      WHERE j.expires_at<=UTC_TIMESTAMP(3) AND j.status IN ('reviewing','awaiting_confirmation','blocked') AND b.status='pending'`);
    await tx.execute(`UPDATE source_documents d INNER JOIN admin_agent_jobs j ON j.source_document_id=d.id
      SET d.status='archived',d.verification_note='关联审核任务已过期'
      WHERE j.expires_at<=UTC_TIMESTAMP(3) AND j.status IN ('reviewing','awaiting_confirmation','blocked') AND d.status='active'`);
    await tx.execute(`UPDATE admin_agent_jobs
      SET status=CASE WHEN status IN ('reviewing','awaiting_confirmation','blocked') THEN 'expired' ELSE status END,
          instruction_text=NULL,normalized_rows_json=NULL,error_message=''
      WHERE expires_at <= UTC_TIMESTAMP(3)
        AND (status IN ('reviewing','awaiting_confirmation','blocked') OR instruction_text IS NOT NULL
          OR normalized_rows_json IS NOT NULL OR error_message<>'')`);
  });
}

export async function reconcileAdminAgentAlerts(db) {
  const jobs = await db.all(`SELECT id,status,error_code,checksum FROM admin_agent_jobs
    WHERE status IN ('blocked','failed') ORDER BY id DESC LIMIT 1000`);
  for (const job of jobs || []) {
    const failed = job.status === 'failed';
    const stale = !failed && job.error_code === 'review_stale';
    const alert = {
      alertType: failed ? 'database_agent_job_failed' : stale ? 'database_agent_review_stale' : 'database_review_blocked',
      severity: failed ? 'error' : stale ? 'warning' : 'critical',
      title: failed ? '数据库管理 Agent 任务失败' : stale ? 'Agent 审核证据已过期' : '数据入库审核已阻断',
      message: `任务 #${job.id} ${failed ? '处理失败' : stale ? '需要重新审核' : '审核已阻断'}，请由超级管理员查看。`,
      resourceType: 'admin_agent_job',
      resourceId: String(job.id),
      fingerprint: failed ? bounded(job.error_code || 'agent_job_failed', 80)
        : bounded(stale ? 'review_stale' : job.checksum, 80),
      details: { jobId: Number(job.id), reconciled: true },
    };
    const key = adminAlertKey(alert);
    if (!(await db.one('SELECT id FROM admin_alerts WHERE alert_key=?', [key]))) {
      await upsertAdminAlert(db, alert);
    }
  }
}

async function createImportProvenance(db, { jobId, actor, targetTable, sourceType, sourceName, format, checksum }) {
  return db.transaction(async (tx) => {
    const batchKey = `admin-agent-job-${jobId}`;
    const batch = await tx.execute(`INSERT INTO data_import_batches(
      batch_key,display_name,source_system,source_version,checksum,status,started_at
    ) VALUES(?,?,?,?,?,'pending',UTC_TIMESTAMP(3))`, [
      batchKey,
      `数据库管理 Agent #${jobId}`,
      `admin_agent_${sourceType}`,
      '007-admin-agent-operations',
      checksum,
    ]);
    const document = await tx.execute(`INSERT INTO source_documents(
      import_batch_id,document_type,title,issuing_organization,content_hash,retrieved_at,verification_status,status,metadata_json
    ) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3),'pending','active',?)`, [
      batch.insertId,
      bounded(format || sourceType, 64) || 'other',
      bounded(sourceName, 500) || `管理员${sourceType === 'file' ? '导入文件' : '口述'} #${jobId}`,
      bounded(actor.username, 255) || '后台管理员',
      checksum,
      JSON.stringify({ jobId, targetTable, sourceType, actorUserId: actor.id }),
    ]);
    await tx.execute('UPDATE admin_agent_jobs SET import_batch_id=?,source_document_id=? WHERE id=?', [
      batch.insertId, document.insertId, jobId,
    ]);
    return { importBatchId: Number(batch.insertId), sourceDocumentId: Number(document.insertId) };
  });
}

function attachProvenance(rows, meta, provenance) {
  const names = new Set(meta.columns.map((column) => column.name));
  return rows.map((row) => {
    const next = { ...row };
    if (names.has('source_document_id')) next.source_document_id = provenance.sourceDocumentId;
    if (names.has('verification_status')) next.verification_status = 'pending';
    return normalizeDatabaseRow(next, meta, { importMode: true, allowSystemManaged: true });
  });
}

async function safeAlert(db, alert) {
  try { await upsertAdminAlert(db, alert); } catch (error) {
    console.warn('[DatabaseManagerAgent] 告警写入失败:', error?.code || error?.message || error);
  }
}

async function failJob(db, jobId, actor, error) {
  if (!jobId) return;
  const code = bounded(error?.code || error?.name || 'agent_job_failed', 80);
  const message = bounded(error?.message || '数据库管理 Agent 任务失败', 1000);
  const failed = await db.execute(`UPDATE admin_agent_jobs
    SET status='failed',review_status='blocked',error_code=?,error_message=? WHERE id=? AND status='reviewing'`, [code, message, jobId]);
  if (Number(failed.affectedRows || 0) !== 1) return;
  await db.execute(`UPDATE data_import_batches b INNER JOIN admin_agent_jobs j ON j.import_batch_id=b.id
    SET b.status='failed',b.error_summary=?,b.finished_at=UTC_TIMESTAMP(3) WHERE j.id=? AND j.status='failed'`, [`Agent 审核失败（${code}）`, jobId]);
  await db.execute(`UPDATE source_documents d INNER JOIN admin_agent_jobs j ON j.source_document_id=d.id
    SET d.status='archived',d.verification_note='关联 Agent 审核任务失败'
    WHERE j.id=? AND j.status='failed' AND d.status='active'`, [jobId]);
  await safeAlert(db, {
    alertType: 'database_agent_job_failed',
    severity: 'error',
    title: '数据库管理 Agent 任务失败',
    message: `任务 #${jobId} 处理失败，请由超级管理员查看任务错误码。`,
    resourceType: 'admin_agent_job',
    resourceId: String(jobId),
    fingerprint: code,
    details: { jobId, actorUserId: actor?.id || null, errorCode: code },
  });
}

function paginationPayload(page, pageSize, total) {
  return { page, pageSize, total, totalPages: total ? Math.ceil(total / pageSize) : 0 };
}

export function createAdminAgentRouter({
  database = getDB,
  authenticate = requireAdministrator,
  generateRows = generateDatabaseRows,
  reviewContent = reviewDatabaseContent,
  audit = writeAdminAudit,
} = {}) {
  const router = Router();

  router.post('/database-agent/reviews', generationRateLimiter, async (req, res, next) => {
    let db;
    let actor;
    let jobId = null;
    try {
      db = await database();
      actor = await authenticate(req, res, db);
      if (!actor) return;
      requireSuperAdministrator(actor);
      await assertAgentCapabilityEnabled(db, {
        userId: actor.id,
        agentType: DATABASE_MANAGER_AGENT_TYPE,
        capability: 'admin_review',
      });
      const sourceType = normalizeSourceType(req.body?.sourceType);
      const targetTable = bounded(req.body?.table, 64);
      if (!targetTable) throw requestError('请选择目标表');
      const meta = await loadTableMetadata(db, targetTable);
      requireWritableDatabaseTable(meta);
      const instruction = String(req.body?.instruction ?? '').trim();
      if (instruction.length > MAX_INSTRUCTION_LENGTH) {
        throw requestError(`instruction 不能超过 ${MAX_INSTRUCTION_LENGTH} 个字符`);
      }
      if (['text', 'voice'].includes(sourceType) && !instruction) throw requestError('请输入或口述要写入的数据');
      if (['text', 'voice'].includes(sourceType) && !isAgentModelConfigured()) {
        throw requestError('服务端尚未配置 LLM_API_KEY，暂时无法解析口述内容', 503, 'missing_llm_key');
      }
      const format = sourceType === 'file' ? normalizeFormat(req.body?.format) : '';
      const mode = normalizeMode(req.body?.mode);
      const sourceName = bounded(req.body?.sourceName, 255);
      const rawChecksum = sourceChecksum(req.body || {}, sourceType);
      const inserted = await db.execute(`INSERT INTO admin_agent_jobs(
        actor_user_id,target_table,source_type,source_name,instruction_text,input_format,operation_mode,expires_at
      ) VALUES(?,?,?,?,?,?,?,?)`, [
        actor.id, meta.tableName, sourceType, sourceName, instruction || null, format, mode, stagingExpiry(),
      ]);
      jobId = Number(inserted.insertId);

      let rows;
      let extractionSummary = '';
      if (sourceType === 'file') {
        rows = await normalizeImportRows(req.body || {}, format, meta);
        extractionSummary = `已从 ${sourceName || format.toUpperCase()} 解析 ${rows.length} 行`;
      } else {
        const draft = await runAuditedAgentCall(db, {
          userId: actor.id,
          adminAgentJobId: jobId,
          runType: 'admin_ingest',
          input: { targetTable: meta.tableName, sourceType, instruction },
          run: () => generateRows({
            instruction,
            table: meta.tableName,
            columns: agentWritableColumns(meta),
            mode,
          }),
        });
        rows = draft.rows.map((row) => normalizeDatabaseRow(row, meta, { importMode: true }));
        extractionSummary = draft.summary;
      }

      assertAgentRowsWritable(meta, rows);
      assertSafeAgentUpsert(meta, rows, mode);
      if (rows.length > MAX_AGENT_ROWS) {
        throw requestError(`单个 Agent 审核任务最多 ${MAX_AGENT_ROWS} 行，请拆分文件后重试`);
      }

      const provenance = await createImportProvenance(db, {
        jobId, actor, targetTable: meta.tableName, sourceType, sourceName, format, checksum: rawChecksum,
      });
      rows = attachProvenance(rows, meta, provenance);
      const normalizedChecksum = checksumRows(rows);
      // Unique-key evidence and deterministic duplicate findings must come from
      // one consistent snapshot. Otherwise a concurrent insert between two
      // independent reads could silently become the upsert baseline without
      // ever being disclosed in the review shown to the administrator.
      const { deterministic, databaseState } = await db.transaction(async (tx) => {
        const snapshot = await inspectDatabaseState(tx, meta, rows);
        const ruleReview = await runDeterministicDatabaseReview(tx, meta, rows, { mode, databaseState: snapshot });
        return { deterministic: ruleReview, databaseState: snapshot };
      });
      const conflictingState = databaseState.findIndex((state) => state.conflict);
      const repeatedEntities = repeatedExistingEntityRows(meta, databaseState);
      if (conflictingState >= 0 || repeatedEntities.length) {
        deterministic.status = 'blocked';
        deterministic.riskLevel = 'high';
        const stateIssues = [
          ...(conflictingState >= 0 ? [{
            rowIndex: conflictingState,
            field: '',
            code: 'unique_keys_resolve_to_different_rows',
            severity: 'error',
            message: '同一建议行的不同唯一键指向多条现有记录，不能自动合并。',
            source: 'rules',
          }] : []),
          ...repeatedEntities.map(({ rowIndex, firstRowIndex }) => ({
            rowIndex,
            field: '',
            code: 'multiple_rows_resolve_to_same_entity',
            severity: 'error',
            message: `与第 ${firstRowIndex + 1} 行指向同一现有记录，请先合并。`,
            source: 'rules',
          })),
        ];
        deterministic.issueCount = Number(deterministic.issueCount || deterministic.issues.length) + stateIssues.length;
        deterministic.issues.unshift(...stateIssues);
      }
      const databaseStateChecksum = checksumRows([databaseStateSnapshot(meta, databaseState)]);
      let modelReview = null;
      let modelFailure = null;
      if (isAgentModelConfigured()) {
        try {
          modelReview = await runAuditedAgentCall(db, {
            userId: actor.id,
            adminAgentJobId: jobId,
            runType: 'admin_review',
            input: { targetTable: meta.tableName, rowCount: rows.length, checksum: normalizedChecksum },
            run: () => reviewContent({
              table: meta.tableName,
              columns: agentWritableColumns(meta),
              rows: rows.map((row) => redactDatabaseRow(row, meta.columns)),
              deterministicIssues: deterministic.issues,
              instruction,
            }),
          });
        } catch (error) {
          modelFailure = error;
        }
      }
      const review = mergeDatabaseReviews(deterministic, modelReview);
      review.extractionSummary = extractionSummary;
      review.sourceChecksum = rawChecksum;
      review.databaseStateChecksum = databaseStateChecksum;
      review.policyVersion = DATABASE_REVIEW_POLICY_VERSION;
      review.modelVersion = modelReview ? databaseReviewModelVersion() : '';
      review.semanticReviewSample = {
        sampled: rows.length > DATABASE_REVIEW_SAMPLE_LIMIT,
        sampleSize: Math.min(rows.length, DATABASE_REVIEW_SAMPLE_LIMIT),
        totalRows: rows.length,
        strategy: 'evenly_spaced_with_edges',
      };
      if (modelFailure) {
        review.modelStatus = 'failed';
        review.status = 'blocked';
        review.riskLevel = 'high';
        review.issues.push({
          rowIndex: 0,
          field: '',
          code: 'model_review_unavailable',
          severity: 'warning',
          message: '模型语义审核暂不可用，本次任务已阻断，请稍后重新提交。',
          source: 'system',
        });
      }
      const jobStatus = review.status === 'blocked' ? 'blocked' : 'awaiting_confirmation';
      const created = await db.transaction(async (tx) => {
        await tx.execute(`UPDATE admin_agent_jobs SET
          status=?,review_status=?,row_count=?,checksum=?,normalized_rows_json=?,review_json=?,model=?,error_code='',error_message=''
          WHERE id=? AND status='reviewing'`, [
          jobStatus,
          review.status,
          rows.length,
          normalizedChecksum,
          JSON.stringify(rows),
          JSON.stringify(review),
          isAgentModelConfigured() ? bounded(process.env.AGENT_MODEL || 'deepseek-chat', 80) : '',
          jobId,
        ]);
        await tx.execute('UPDATE data_import_batches SET record_count=? WHERE id=?', [rows.length, provenance.importBatchId]);
        await audit(tx, {
          actorUserId: actor.id,
          action: 'database_agent.review',
          resourceType: 'admin_agent_job',
          resourceId: String(jobId),
          ...requestAuditMetadata(req),
          metadata: {
            targetTable: meta.tableName, sourceType, sourceName, mode, rowCount: rows.length,
            checksum: normalizedChecksum, reviewStatus: review.status,
            issueCount: review.deterministicIssueCount + review.modelIssueCount,
          },
        });
        return tx.one(`SELECT j.*,u.username AS actor_username,cu.username AS confirmer_username
          FROM admin_agent_jobs j LEFT JOIN users u ON u.id=j.actor_user_id
          LEFT JOIN users cu ON cu.id=j.confirmed_by_user_id WHERE j.id=?`, [jobId]);
      });
      if (review.status === 'blocked' || modelFailure) {
        await safeAlert(db, {
          alertType: review.status === 'blocked' ? 'database_review_blocked' : 'database_model_review_failed',
          severity: review.status === 'blocked' ? 'critical' : 'warning',
          title: review.status === 'blocked' ? '数据入库审核已阻断' : '数据语义审核降级',
          message: `任务 #${jobId} 的自动审核需要超级管理员处理。`,
          resourceType: 'admin_agent_job',
          resourceId: String(jobId),
          fingerprint: normalizedChecksum,
          details: {
            targetTable: meta.tableName,
            rowCount: rows.length,
            issueCount: review.deterministicIssueCount + review.modelIssueCount,
          },
        });
      }
      return res.status(201).json({ job: publicJob(created) });
    } catch (error) {
      if (db && jobId) {
        try { await failJob(db, jobId, actor, error); } catch (trackingError) {
          console.warn('[DatabaseManagerAgent] 失败状态写入失败:', trackingError?.code || trackingError?.message || trackingError);
        }
      }
      return next(error);
    }
  });

  router.get('/database-agent/jobs', async (req, res, next) => {
    try {
      const query = pagination(req.query || {});
      const requestedStatus = bounded(req.query?.status, 32);
      if (requestedStatus && !JOB_STATUSES.has(requestedStatus)) throw requestError('status 不合法');
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireSuperAdministrator(actor);
      await purgeExpiredAgentPayloads(db);
      const where = requestedStatus ? ' WHERE j.status=?' : '';
      const params = requestedStatus ? [requestedStatus] : [];
      const total = Number((await db.one(`SELECT COUNT(*) AS total FROM admin_agent_jobs j${where}`, params))?.total || 0);
      const rows = await db.all(`SELECT j.*,u.username AS actor_username,cu.username AS confirmer_username
        FROM admin_agent_jobs j LEFT JOIN users u ON u.id=j.actor_user_id
        LEFT JOIN users cu ON cu.id=j.confirmed_by_user_id${where}
        ORDER BY j.created_at DESC,j.id DESC LIMIT ${query.pageSize} OFFSET ${query.offset}`, params);
      return res.json({ ...paginationPayload(query.page, query.pageSize, total), data: rows.map(publicJob) });
    } catch (error) { return next(error); }
  });

  router.get('/database-agent/jobs/:id', async (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id, 'jobId');
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireSuperAdministrator(actor);
      await purgeExpiredAgentPayloads(db);
      const row = await db.one(`SELECT j.*,u.username AS actor_username,cu.username AS confirmer_username
        FROM admin_agent_jobs j LEFT JOIN users u ON u.id=j.actor_user_id
        LEFT JOIN users cu ON cu.id=j.confirmed_by_user_id WHERE j.id=?`, [id]);
      if (!row) throw requestError('审核任务不存在', 404);
      return res.json({ job: publicJob(row) });
    } catch (error) { return next(error); }
  });

  router.get('/database-agent/jobs/:id/export', async (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id, 'jobId');
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireSuperAdministrator(actor);
      await purgeExpiredAgentPayloads(db);
      const job = await db.one('SELECT id,target_table,row_count,checksum,normalized_rows_json FROM admin_agent_jobs WHERE id=?', [id]);
      if (!job) throw requestError('审核任务不存在', 404);
      const rows = parseJson(job.normalized_rows_json, null);
      if (!Array.isArray(rows)) throw requestError('审核数据已过期或已清理', 410, 'staged_payload_unavailable');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="database-agent-job-${id}.json"`);
      res.type('application/json; charset=utf-8');
      return res.send(JSON.stringify({
        jobId: id,
        targetTable: job.target_table,
        rowCount: Number(job.row_count || rows.length),
        checksum: job.checksum,
        rows,
      }, null, 2));
    } catch (error) { return next(error); }
  });

  router.post('/database-agent/jobs/:id/apply', async (req, res, next) => {
    const id = (() => {
      try { return positiveInteger(req.params.id, 'jobId'); } catch (error) { next(error); return null; }
    })();
    if (!id) return;
    let db;
    let actor;
    let applyingStarted = false;
    try {
      db = await database();
      actor = await authenticate(req, res, db);
      if (!actor) return;
      requireSuperAdministrator(actor);
      await assertAgentCapabilityEnabled(db, {
        userId: actor.id, agentType: DATABASE_MANAGER_AGENT_TYPE, capability: 'admin_apply',
      });
      const confirmationChecksum = bounded(req.body?.checksum, 64);
      if (!/^[a-f0-9]{64}$/u.test(confirmationChecksum)) throw requestError('必须提供完整的审核校验和');
      const confirmationRowCount = positiveInteger(req.body?.rowCount, 'rowCount', { max: MAX_AGENT_ROWS });
      const applied = await db.transaction(async (tx) => {
        const job = await tx.one('SELECT * FROM admin_agent_jobs WHERE id=? FOR UPDATE', [id]);
        if (!job) throw requestError('审核任务不存在', 404);
        if (job.status === 'completed') throw requestError('该任务已经写入，不能重复执行', 409, 'job_already_applied');
        if (job.status !== 'awaiting_confirmation') throw requestError('该任务当前不可写入，请先通过审核', 409, 'job_not_applicable');
        if (isExpiredUtcTimestamp(job.expires_at)) {
          throw requestError('审核任务已过期，请重新提交', 409, 'job_expired');
        }
        if (job.checksum !== confirmationChecksum) throw requestError('审核校验和不一致，请刷新后重新确认', 409, 'checksum_mismatch');
        if (Number(job.row_count) !== confirmationRowCount) {
          throw requestError('确认的数据行数不一致，请刷新后重新确认', 409, 'row_count_mismatch');
        }
        const stagedRows = parseJson(job.normalized_rows_json, null);
        if (!Array.isArray(stagedRows) || !stagedRows.length || checksumRows(stagedRows) !== job.checksum) {
          throw requestError('待审数据校验失败，请重新提交', 409, 'staged_payload_changed');
        }
        const meta = await loadTableMetadata(tx, job.target_table);
        requireWritableDatabaseTable(meta);
        const rows = stagedRows.map((row) => normalizeDatabaseRow(row, meta, { importMode: true, allowSystemManaged: true }));
        if (checksumRows(rows) !== job.checksum) throw requestError('规范化数据已变化，请重新审核', 409, 'normalized_payload_changed');
        const storedReview = parseJson(job.review_json, null);
        if (storedReview?.policyVersion !== DATABASE_REVIEW_POLICY_VERSION
          || (storedReview.modelVersion && storedReview.modelVersion !== databaseReviewModelVersion())) {
          throw requestError('审核策略或模型版本已更新，请重新提交审核', 409, 'review_stale');
        }
        if (!storedReview?.databaseStateChecksum) {
          throw requestError('审核任务缺少数据库版本证据，请重新提交审核', 409, 'review_stale');
        }
        const lockedDatabaseState = await inspectDatabaseState(tx, meta, rows, { lock: true });
        if (lockedDatabaseState.some((state) => state.conflict)
          || repeatedExistingEntityRows(meta, lockedDatabaseState).length
          || checksumRows([databaseStateSnapshot(meta, lockedDatabaseState)]) !== storedReview.databaseStateChecksum) {
          throw requestError('数据库当前状态已变化，请重新提交审核', 409, 'review_stale');
        }
        const freshReview = await runDeterministicDatabaseReview(tx, meta, rows, {
          mode: job.operation_mode,
          databaseState: lockedDatabaseState,
        });
        if (freshReview.status === 'blocked') {
          throw requestError('数据库当前状态已变化，重新检查发现阻断问题，请重新审核', 409, 'review_stale');
        }
        applyingStarted = true;
        const results = await insertRows(tx, meta, rows, job.operation_mode, {
          existingRows: lockedDatabaseState.map((state) => state.existingRecord),
        });
        const affectedRows = results.reduce((sum, result) => sum + Number(result.affectedRows || 0), 0);
        for (let index = 0; index < rows.length; index += 1) {
          const primary = meta.primaryColumns[0];
          const entityId = primary ? (rows[index][primary.name] ?? results[index]?.entityId ?? results[index]?.insertId) : null;
          const before = results[index]?.before ? redactDatabaseRow(results[index].before, meta.columns) : null;
          const after = redactDatabaseRow(results[index]?.after || rows[index], meta.columns);
          const changedFields = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
            .filter((field) => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]));
          await tx.execute(`INSERT INTO catalog_change_log(
            entity_type,entity_id,operation,changed_fields_json,before_json,after_json,source_document_id,import_batch_id,actor_user_id
          ) VALUES(?,?,?,?,?,?,?,?,?)`, [
            meta.tableName,
            bounded(entityId ?? `job-${id}-row-${index + 1}`, 128),
            before ? 'update' : 'insert',
            JSON.stringify(changedFields),
            before ? JSON.stringify(before) : null,
            JSON.stringify(after),
            job.source_document_id || null,
            job.import_batch_id || null,
            actor.id,
          ]);
        }
        await tx.execute(`UPDATE admin_agent_jobs SET
          status='completed',affected_rows=?,confirmed_by_user_id=?,
          confirmed_at=UTC_TIMESTAMP(3),completed_at=UTC_TIMESTAMP(3),error_code='',error_message=''
          WHERE id=?`, [affectedRows, actor.id, id]);
        if (job.import_batch_id) {
          await tx.execute(`UPDATE data_import_batches SET
            status='completed',record_count=?,finished_at=UTC_TIMESTAMP(3),error_summary=NULL WHERE id=?`, [rows.length, job.import_batch_id]);
        }
        await audit(tx, {
          actorUserId: actor.id,
          action: 'database_agent.apply',
          resourceType: 'admin_agent_job',
          resourceId: String(id),
          ...requestAuditMetadata(req),
          metadata: {
            targetTable: meta.tableName, mode: job.operation_mode, rowCount: rows.length,
            affectedRows, checksum: job.checksum, importBatchId: job.import_batch_id,
          },
        });
        return tx.one(`SELECT j.*,u.username AS actor_username,cu.username AS confirmer_username
          FROM admin_agent_jobs j LEFT JOIN users u ON u.id=j.actor_user_id
          LEFT JOIN users cu ON cu.id=j.confirmed_by_user_id WHERE j.id=?`, [id]);
      });
      return res.json({ job: publicJob(applied) });
    } catch (error) {
      if (db && error?.code === 'review_stale') {
        try {
          const blocked = await db.execute(`UPDATE admin_agent_jobs
            SET status='blocked',review_status='blocked',error_code='review_stale',error_message=?
            WHERE id=? AND status='awaiting_confirmation'`, [bounded(error.message, 1000), id]);
          if (Number(blocked.affectedRows || 0) === 1) {
            await safeAlert(db, {
              alertType: 'database_agent_review_stale', severity: 'warning', title: 'Agent 审核证据已过期',
              message: `任务 #${id} 的数据库状态或审核策略已变化，请重新提交审核。`,
              resourceType: 'admin_agent_job', resourceId: String(id), fingerprint: 'review_stale',
              details: { jobId: id, actorUserId: actor?.id || null },
            });
          }
        } catch (trackingError) {
          console.warn('[DatabaseManagerAgent] 过期审核状态写入失败:', trackingError?.code || trackingError?.message || trackingError);
        }
      }
      if (db && applyingStarted) {
        try {
          const markedFailed = await db.transaction(async (tx) => {
            const code = bounded(error?.code || 'apply_failed', 80);
            const message = bounded(error?.message, 1000);
            const failed = await tx.execute(`UPDATE admin_agent_jobs SET status='failed',review_status='blocked',error_code=?,error_message=?
              WHERE id=? AND status='awaiting_confirmation'`, [code, message, id]);
            if (Number(failed.affectedRows || 0) === 1) {
              await tx.execute(`UPDATE data_import_batches b INNER JOIN admin_agent_jobs j ON j.import_batch_id=b.id
                SET b.status='failed',b.error_summary=?,b.finished_at=UTC_TIMESTAMP(3) WHERE j.id=? AND j.status='failed'`, [`Agent 写入失败（${code}）`, id]);
              await tx.execute(`UPDATE source_documents d INNER JOIN admin_agent_jobs j ON j.source_document_id=d.id
                SET d.status='archived',d.verification_note='关联 Agent 写入任务失败'
                WHERE j.id=? AND j.status='failed' AND d.status='active'`, [id]);
              return true;
            }
            return false;
          });
          if (markedFailed) await safeAlert(db, {
            alertType: 'database_agent_apply_failed', severity: 'critical', title: 'Agent 数据写入失败',
            message: `任务 #${id} 写入失败，请由超级管理员查看任务错误码。`, resourceType: 'admin_agent_job', resourceId: String(id),
            fingerprint: bounded(error?.code || 'apply_failed', 80), details: { jobId: id, actorUserId: actor?.id || null },
          });
        } catch (trackingError) {
          console.warn('[DatabaseManagerAgent] 落库失败状态写入失败:', trackingError?.code || trackingError?.message || trackingError);
        }
      }
      return next(error);
    }
  });

  router.post('/database-agent/jobs/:id/reject', async (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id, 'jobId');
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireSuperAdministrator(actor);
      const rejected = await db.transaction(async (tx) => {
        const job = await tx.one('SELECT * FROM admin_agent_jobs WHERE id=? FOR UPDATE', [id]);
        if (!job) throw requestError('审核任务不存在', 404);
        if (!['awaiting_confirmation', 'blocked'].includes(job.status)) throw requestError('该任务当前不能驳回', 409);
        await tx.execute(`UPDATE admin_agent_jobs SET status='rejected',confirmed_by_user_id=?,confirmed_at=UTC_TIMESTAMP(3) WHERE id=?`, [actor.id, id]);
        if (job.import_batch_id) {
          await tx.execute(`UPDATE data_import_batches SET status='rejected',finished_at=UTC_TIMESTAMP(3),error_summary='管理员驳回' WHERE id=?`, [job.import_batch_id]);
        }
        if (job.source_document_id) {
          await tx.execute(`UPDATE source_documents SET status='archived',verification_note='关联 Agent 审核任务已被管理员驳回'
            WHERE id=? AND status='active'`, [job.source_document_id]);
        }
        await audit(tx, {
          actorUserId: actor.id,
          action: 'database_agent.reject',
          resourceType: 'admin_agent_job',
          resourceId: String(id),
          ...requestAuditMetadata(req),
          metadata: { targetTable: job.target_table, checksum: job.checksum },
        });
        return tx.one(`SELECT j.*,u.username AS actor_username,cu.username AS confirmer_username
          FROM admin_agent_jobs j LEFT JOIN users u ON u.id=j.actor_user_id
          LEFT JOIN users cu ON cu.id=j.confirmed_by_user_id WHERE j.id=?`, [id]);
      });
      return res.json({ job: publicJob(rejected) });
    } catch (error) { return next(error); }
  });

  router.get('/database-agent/runs', async (req, res, next) => {
    try {
      const query = pagination(req.query || {});
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireSuperAdministrator(actor);
      const total = Number((await db.one("SELECT COUNT(*) AS total FROM agent_runs WHERE run_type IN ('admin_ingest','admin_review')"))?.total || 0);
      const rows = await db.all(`SELECT r.*,u.username FROM agent_runs r LEFT JOIN users u ON u.id=r.user_id
        WHERE r.run_type IN ('admin_ingest','admin_review') ORDER BY r.created_at DESC,r.id DESC LIMIT ${query.pageSize} OFFSET ${query.offset}`);
      return res.json({ ...paginationPayload(query.page, query.pageSize, total), data: rows.map(publicRun) });
    } catch (error) { return next(error); }
  });

  router.get('/access-logs', async (req, res, next) => {
    try {
      const query = pagination(req.query || {});
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireSuperAdministrator(actor);
      const total = Number((await db.one('SELECT COUNT(*) AS total FROM admin_access_logs'))?.total || 0);
      const rows = await db.all(`SELECT l.*,u.username AS actor_username FROM admin_access_logs l
        LEFT JOIN users u ON u.id=l.actor_user_id ORDER BY l.created_at DESC,l.id DESC
        LIMIT ${query.pageSize} OFFSET ${query.offset}`);
      return res.json({ ...paginationPayload(query.page, query.pageSize, total), data: rows.map(publicAccessLog) });
    } catch (error) { return next(error); }
  });

  router.get('/alerts', async (req, res, next) => {
    try {
      const query = pagination(req.query || {});
      const status = bounded(req.query?.status, 24);
      const severity = bounded(req.query?.severity, 16);
      if (status && !ALERT_STATUSES.has(status)) throw requestError('status 不合法');
      if (severity && !ALERT_SEVERITIES.has(severity)) throw requestError('severity 不合法');
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireSuperAdministrator(actor);
      const clauses = [];
      const params = [];
      if (status) { clauses.push('status=?'); params.push(status); }
      if (severity) { clauses.push('severity=?'); params.push(severity); }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const total = Number((await db.one(`SELECT COUNT(*) AS total FROM admin_alerts${where}`, params))?.total || 0);
      const rows = await db.all(`SELECT * FROM admin_alerts${where}
        ORDER BY FIELD(severity,'critical','error','warning','info'),last_detected_at DESC,id DESC
        LIMIT ${query.pageSize} OFFSET ${query.offset}`, params);
      return res.json({ ...paginationPayload(query.page, query.pageSize, total), data: rows.map(publicAdminAlert) });
    } catch (error) { return next(error); }
  });

  router.patch('/alerts/:id', async (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id, 'alertId');
      const status = bounded(req.body?.status, 24);
      if (!ALERT_STATUSES.has(status)) throw requestError('status 必须是 open、acknowledged 或 resolved');
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireSuperAdministrator(actor);
      const updated = await db.transaction(async (tx) => {
        const current = await tx.one('SELECT * FROM admin_alerts WHERE id=? FOR UPDATE', [id]);
        if (!current) throw requestError('告警不存在', 404);
        await tx.execute(`UPDATE admin_alerts SET status=?,
          acknowledged_by_user_id=CASE WHEN ?='open' THEN NULL WHEN ?='acknowledged' THEN ? ELSE COALESCE(acknowledged_by_user_id,?) END,
          acknowledged_at=CASE WHEN ?='open' THEN NULL WHEN ?='acknowledged' THEN UTC_TIMESTAMP(3) ELSE COALESCE(acknowledged_at,UTC_TIMESTAMP(3)) END,
          resolved_by_user_id=CASE WHEN ?='resolved' THEN ? ELSE NULL END,
          resolved_at=CASE WHEN ?='resolved' THEN UTC_TIMESTAMP(3) ELSE NULL END
          WHERE id=?`, [status, status, status, actor.id, actor.id, status, status, status, actor.id, status, id]);
        const fresh = await tx.one('SELECT * FROM admin_alerts WHERE id=?', [id]);
        await audit(tx, {
          actorUserId: actor.id,
          action: 'admin_alert.update_status',
          resourceType: 'admin_alert',
          resourceId: String(id),
          ...requestAuditMetadata(req),
          before: publicAdminAlert(current),
          after: publicAdminAlert(fresh),
        });
        return fresh;
      });
      return res.json({ alert: publicAdminAlert(updated) });
    } catch (error) { return next(error); }
  });

  return router;
}

export default createAdminAgentRouter();
