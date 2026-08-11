import { Router } from 'express';
import { getDB } from '../db/index.js';
import { requireAdministrator, isSuperAdministrator } from '../middleware/admin-auth.js';
import { parseAuditJson, requestAuditMetadata, safeAuditSnapshot, writeAdminAudit } from '../services/admin-audit-service.js';

const USER_ROLES = new Set(['user', 'admin', 'super_admin']);
const USER_STATUSES = new Set(['active', 'suspended', 'disabled']);
const MAX_PAGE = 10_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const FORBIDDEN_CONFIG_KEY = /(pass(?:word)?|secret|token|api[_-]?key|authorization|credential|cookie|private[_-]?key|base[_-]?url|provider|model)/iu;

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function scalar(value, field) {
  if (Array.isArray(value)) throw requestError(`${field} 只能传一个值`);
  return value;
}

function parsePositiveInteger(value, field, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/u.test(text)) throw requestError(`${field} 必须是 ${min}–${max} 的整数`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw requestError(`${field} 必须是 ${min}–${max} 的整数`);
  }
  return number;
}

function parsePagination(query = {}) {
  const page = query.page === undefined || String(query.page).trim() === ''
    ? 1
    : parsePositiveInteger(scalar(query.page, 'page'), 'page', { min: 1, max: MAX_PAGE });
  const pageSize = query.pageSize === undefined || String(query.pageSize).trim() === ''
    ? DEFAULT_PAGE_SIZE
    : parsePositiveInteger(scalar(query.pageSize, 'pageSize'), 'pageSize', { min: 1, max: MAX_PAGE_SIZE });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function parseOptionalText(value, field, maxLength) {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  const text = String(scalar(value, field)).trim();
  if (text.length > maxLength) throw requestError(`${field} 不能超过 ${maxLength} 个字符`);
  return text;
}

function parseOptionalId(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return parsePositiveInteger(scalar(value, field), field);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function plainObject(value, field, { allowNull = false } = {}) {
  if (allowNull && value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw requestError(`${field} 必须是对象`);
  }
  return value;
}

function assertSafeConfigurationValue(value, path = 'settings', seen = new WeakSet()) {
  if (value === null) return;
  const type = typeof value;
  if (['string', 'number', 'boolean'].includes(type)) return;
  if (type !== 'object') throw requestError(`${path} 只能包含 JSON 数据`);
  if (seen.has(value)) throw requestError(`${path} 不能包含循环引用`);
  seen.add(value);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  let count = 0;
  for (const [key, child] of entries) {
    count += 1;
    if (count > 100) throw requestError(`${path} 项目过多`);
    const stringKey = String(key);
    if (['__proto__', 'prototype', 'constructor'].includes(stringKey) || FORBIDDEN_CONFIG_KEY.test(stringKey)) {
      throw requestError(`${path} 不允许包含敏感或运行时连接配置`);
    }
    assertSafeConfigurationValue(child, `${path}.${stringKey}`, seen);
  }
}

function parseSafeObject(value, field, { allowNull = false } = {}) {
  const object = plainObject(value, field, { allowNull });
  if (object === null) return null;
  assertSafeConfigurationValue(object, field);
  const serialized = JSON.stringify(object);
  if (Buffer.byteLength(serialized, 'utf8') > 16 * 1024) throw requestError(`${field} 不能超过 16KB`);
  return object;
}

function assertKnownPatch(body, allowed, resourceName) {
  const object = plainObject(body, '请求体');
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw requestError(`${resourceName} 不支持字段 ${key}`);
  }
  if (Object.keys(object).length === 0) throw requestError(`请至少提供一个要更新的 ${resourceName} 字段`);
  return object;
}

function parseRequiredString(value, field, maxLength) {
  if (typeof value !== 'string') throw requestError(`${field} 必须是字符串`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw requestError(`${field} 长度需为 1–${maxLength}`);
  return normalized;
}

function parseOptionalStringPatch(value, field, maxLength) {
  if (typeof value !== 'string') throw requestError(`${field} 必须是字符串`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw requestError(`${field} 不能超过 ${maxLength} 个字符`);
  return normalized;
}

function parseConfigKey(value, field = 'key') {
  const key = String(value ?? '').trim();
  if (!/^[a-z][a-z0-9._-]{1,95}$/u.test(key)) throw requestError(`${field} 格式不正确`);
  return key;
}

function publicAdminUser(row) {
  return {
    id: toNumber(row.id),
    username: row.username || '',
    email: row.email || '',
    avatarUrl: row.avatar_url || '',
    role: row.role || 'user',
    status: row.status || 'active',
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    favoriteCount: toNumber(row.favorite_count),
    studySessionCount: toNumber(row.study_session_count),
    agentRunCount: toNumber(row.agent_run_count),
  };
}

function publicAgentConfiguration(row) {
  return {
    key: row.config_key,
    displayName: row.display_name,
    description: row.description || '',
    enabled: Boolean(Number(row.enabled)),
    settings: safeAuditSnapshot(parseJson(row.settings_json, {})),
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by_user_id ? {
      id: toNumber(row.updated_by_user_id),
      username: row.updated_by_username || '',
    } : null,
  };
}

function publicFeatureFlag(row) {
  return {
    key: row.flag_key,
    displayName: row.display_name,
    description: row.description || '',
    enabled: Boolean(Number(row.enabled)),
    rolloutPercentage: toNumber(row.rollout_percentage, 100),
    audience: safeAuditSnapshot(parseJson(row.audience_json, null)),
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by_user_id ? {
      id: toNumber(row.updated_by_user_id),
      username: row.updated_by_username || '',
    } : null,
  };
}

function publicAuditLog(row) {
  return {
    id: toNumber(row.id),
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id || '',
    actor: row.actor_user_id ? { id: toNumber(row.actor_user_id), username: row.actor_username || '' } : null,
    requestId: row.request_id || '',
    ipAddress: row.ip_address || '',
    userAgent: row.user_agent || '',
    before: parseAuditJson(row.before_json),
    after: parseAuditJson(row.after_json),
    metadata: parseAuditJson(row.metadata_json),
    createdAt: row.created_at,
  };
}

function paginationPayload({ page, pageSize, total }) {
  return { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) };
}

function userWhere(query) {
  const clauses = [];
  const params = [];
  if (query.status) { clauses.push('u.status=?'); params.push(query.status); }
  if (query.role) { clauses.push('u.role=?'); params.push(query.role); }
  if (query.keyword) {
    clauses.push('(u.username LIKE ? OR u.email LIKE ?)');
    const like = `%${query.keyword}%`;
    params.push(like, like);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

export function parseAdminUsersQuery(query = {}) {
  const pagination = parsePagination(query);
  const role = parseOptionalText(query.role, 'role', 32);
  const status = parseOptionalText(query.status, 'status', 32);
  if (role && !USER_ROLES.has(role)) throw requestError('role 不合法');
  if (status && !USER_STATUSES.has(status)) throw requestError('status 不合法');
  return { ...pagination, role, status, keyword: parseOptionalText(query.keyword, 'keyword', 64) };
}

export function parseAdminAuditQuery(query = {}) {
  const pagination = parsePagination(query);
  return {
    ...pagination,
    actorUserId: parseOptionalId(query.actorUserId, 'actorUserId'),
    action: parseOptionalText(query.action, 'action', 96),
    resourceType: parseOptionalText(query.resourceType, 'resourceType', 64),
  };
}

function auditWhere(query) {
  const clauses = [];
  const params = [];
  if (query.actorUserId !== null) { clauses.push('l.actor_user_id=?'); params.push(query.actorUserId); }
  if (query.action) { clauses.push('l.action=?'); params.push(query.action); }
  if (query.resourceType) { clauses.push('l.resource_type=?'); params.push(query.resourceType); }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

async function withTransaction(db, callback) {
  return typeof db.transaction === 'function' ? db.transaction(callback) : callback(db);
}

const ADMIN_USER_SELECT = `SELECT
  u.id,u.username,u.email,u.avatar_url,u.role,u.status,u.last_login_at,u.created_at,u.updated_at,
  (SELECT COUNT(*) FROM user_favorites f WHERE f.user_id=u.id) AS favorite_count,
  (SELECT COUNT(*) FROM study_sessions s WHERE s.user_id=u.id) AS study_session_count,
  (SELECT COUNT(*) FROM agent_runs ar WHERE ar.user_id=u.id) AS agent_run_count
FROM users u`;

const AGENT_CONFIGURATION_SELECT = `SELECT c.*, u.username AS updated_by_username
FROM agent_configurations c
LEFT JOIN users u ON u.id=c.updated_by_user_id`;

const FEATURE_FLAG_SELECT = `SELECT f.*, u.username AS updated_by_username
FROM feature_flags f
LEFT JOIN users u ON u.id=f.updated_by_user_id`;

function assertUserUpdateAllowed(actor, target, patch) {
  if (Number(actor.id) === Number(target.id)) throw requestError('不能在管理后台修改自己的角色或账号状态', 403);
  if (String(target.role || 'user') === 'super_admin') {
    throw requestError('超级管理员只能通过受控运维流程调整', 403);
  }
  if (!isSuperAdministrator(actor)) {
    if (String(target.role || 'user') !== 'user' || Object.hasOwn(patch, 'role')) {
      throw requestError('普通管理员不能调整管理员角色', 403);
    }
  }
  if (patch.role === 'super_admin') throw requestError('超级管理员只能通过受控运维流程初始化', 403);
}

function validateUserPatch(body) {
  const patch = assertKnownPatch(body, new Set(['role', 'status']), '用户');
  if (Object.hasOwn(patch, 'role') && !['user', 'admin'].includes(patch.role)) {
    throw requestError('role 仅可调整为 user 或 admin');
  }
  if (Object.hasOwn(patch, 'status') && !USER_STATUSES.has(patch.status)) {
    throw requestError('status 不合法');
  }
  return patch;
}

function validateAgentConfigurationPatch(body) {
  const patch = assertKnownPatch(body, new Set(['displayName', 'description', 'enabled', 'settings']), '智能体配置');
  const values = {};
  if (Object.hasOwn(patch, 'displayName')) values.display_name = parseRequiredString(patch.displayName, 'displayName', 128);
  if (Object.hasOwn(patch, 'description')) values.description = parseOptionalStringPatch(patch.description, 'description', 1000);
  if (Object.hasOwn(patch, 'enabled')) {
    if (typeof patch.enabled !== 'boolean') throw requestError('enabled 必须是布尔值');
    values.enabled = patch.enabled;
  }
  if (Object.hasOwn(patch, 'settings')) values.settings_json = parseSafeObject(patch.settings, 'settings');
  return values;
}

function assertAgentConfigurationSafety(key, settings) {
  if (key !== 'database-manager') return;
  if (settings?.writeAccess !== false || settings?.requiresHumanConfirmation !== true) {
    throw requestError('数据库管理 Agent 必须保持 writeAccess=false 且 requiresHumanConfirmation=true', 403);
  }
}

function validateFeatureFlagPatch(body) {
  const patch = assertKnownPatch(body, new Set(['displayName', 'description', 'enabled', 'rolloutPercentage', 'audience']), '功能开关');
  const values = {};
  if (Object.hasOwn(patch, 'displayName')) values.display_name = parseRequiredString(patch.displayName, 'displayName', 128);
  if (Object.hasOwn(patch, 'description')) values.description = parseOptionalStringPatch(patch.description, 'description', 1000);
  if (Object.hasOwn(patch, 'enabled')) {
    if (typeof patch.enabled !== 'boolean') throw requestError('enabled 必须是布尔值');
    values.enabled = patch.enabled;
  }
  if (Object.hasOwn(patch, 'rolloutPercentage')) {
    if (!Number.isInteger(patch.rolloutPercentage) || patch.rolloutPercentage < 0 || patch.rolloutPercentage > 100) {
      throw requestError('rolloutPercentage 必须是 0–100 的整数');
    }
    values.rollout_percentage = patch.rolloutPercentage;
  }
  if (Object.hasOwn(patch, 'audience')) values.audience_json = parseSafeObject(patch.audience, 'audience', { allowNull: true });
  return values;
}

/**
 * Server-side administrative API.  It has no create/delete route for agents
 * or flags: only reviewed migration-seeded keys can be changed, and secrets
 * are not a supported configuration field.
 */
export function createAdminRouter({
  database = getDB,
  authenticate = requireAdministrator,
  audit = writeAdminAudit,
} = {}) {
  const router = Router();

  router.get('/dashboard', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const [users, catalog, agents, agentRuns, agentOperations] = await Promise.all([
        db.one(`SELECT COUNT(*) AS total,
          SUM(status='active') AS active,
          SUM(status='suspended') AS suspended,
          SUM(status='disabled') AS disabled,
          SUM(created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)) AS new_last_7_days
          FROM users`),
        db.one(`SELECT
          (SELECT COUNT(*) FROM universities) AS universities,
          (SELECT COUNT(*) FROM programs) AS programs,
          (SELECT COUNT(*) FROM catalog_data_issues WHERE status='open') AS open_catalog_issues`),
        db.one(`SELECT
          (SELECT COUNT(*) FROM agent_configurations) AS configurations,
          (SELECT COUNT(*) FROM agent_configurations WHERE enabled=TRUE) AS enabled_configurations,
          (SELECT COUNT(*) FROM feature_flags) AS feature_flags,
          (SELECT COUNT(*) FROM feature_flags WHERE enabled=TRUE) AS enabled_feature_flags`),
        db.one(`SELECT COUNT(*) AS total,
          SUM(status='failed') AS failed
          FROM agent_runs WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)`),
        db.one(`SELECT
          (SELECT COUNT(*) FROM admin_agent_jobs WHERE status='awaiting_confirmation') AS awaiting_confirmation,
          (SELECT COUNT(*) FROM admin_agent_jobs WHERE status IN ('blocked','failed')) AS blocked_or_failed,
          (SELECT COUNT(*) FROM admin_alerts WHERE status='open') AS open_alerts,
          (SELECT COUNT(*) FROM admin_alerts WHERE status='open' AND severity='critical') AS critical_alerts`),
      ]);
      return res.json({
        generatedAt: new Date().toISOString(),
        currentUser: { id: Number(actor.id), username: actor.username || '', role: actor.role || 'admin' },
        users: {
          total: toNumber(users?.total), active: toNumber(users?.active), suspended: toNumber(users?.suspended),
          disabled: toNumber(users?.disabled), newLast7Days: toNumber(users?.new_last_7_days),
        },
        catalog: {
          universities: toNumber(catalog?.universities), programs: toNumber(catalog?.programs),
          openCatalogIssues: toNumber(catalog?.open_catalog_issues),
        },
        agents: {
          configurations: toNumber(agents?.configurations), enabledConfigurations: toNumber(agents?.enabled_configurations),
          featureFlags: toNumber(agents?.feature_flags), enabledFeatureFlags: toNumber(agents?.enabled_feature_flags),
          runsLast24Hours: toNumber(agentRuns?.total), failedRunsLast24Hours: toNumber(agentRuns?.failed),
          awaitingConfirmation: toNumber(agentOperations?.awaiting_confirmation),
          blockedOrFailedJobs: toNumber(agentOperations?.blocked_or_failed),
          openAlerts: toNumber(agentOperations?.open_alerts),
          criticalAlerts: toNumber(agentOperations?.critical_alerts),
        },
      });
    } catch (error) { return next(error); }
  });

  router.get('/users', async (req, res, next) => {
    try {
      const query = parseAdminUsersQuery(req.query || {});
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const where = userWhere(query);
      const total = toNumber((await db.one(`SELECT COUNT(*) AS total FROM users u${where.sql}`, where.params))?.total);
      const rows = await db.all(
        `${ADMIN_USER_SELECT}${where.sql} ORDER BY u.created_at DESC, u.id DESC LIMIT ${query.pageSize} OFFSET ${query.offset}`,
        where.params,
      );
      return res.json({ ...paginationPayload({ ...query, total }), data: rows.map(publicAdminUser) });
    } catch (error) { return next(error); }
  });

  router.patch('/users/:id', async (req, res, next) => {
    try {
      const userId = parsePositiveInteger(req.params.id, 'userId');
      const patch = validateUserPatch(req.body || {});
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      if (!isSuperAdministrator(actor)) throw requestError('只有超级管理员可以修改全局智能体配置', 403);
      const updated = await withTransaction(db, async (tx) => {
        const target = await tx.one(`${ADMIN_USER_SELECT} WHERE u.id=? FOR UPDATE`, [userId]);
        if (!target) throw requestError('用户不存在', 404);
        assertUserUpdateAllowed(actor, target, patch);
        const nextRole = Object.hasOwn(patch, 'role') ? patch.role : (target.role || 'user');
        const nextStatus = Object.hasOwn(patch, 'status') ? patch.status : (target.status || 'active');
        if (nextRole === target.role && nextStatus === target.status) throw requestError('没有需要变更的字段');
        await tx.execute('UPDATE users SET role=?,status=? WHERE id=?', [nextRole, nextStatus, userId]);
        const sessionsRevoked = nextStatus !== 'active' && nextStatus !== target.status;
        if (sessionsRevoked) await tx.execute('DELETE FROM auth_tokens WHERE user_id=?', [userId]);
        const fresh = await tx.one(`${ADMIN_USER_SELECT} WHERE u.id=?`, [userId]);
        await audit(tx, {
          actorUserId: actor.id,
          action: 'user.update_access',
          resourceType: 'user',
          resourceId: String(userId),
          ...requestAuditMetadata(req),
          before: publicAdminUser(target),
          after: publicAdminUser(fresh),
          metadata: { sessionsRevoked },
        });
        return fresh;
      });
      return res.json({ user: publicAdminUser(updated) });
    } catch (error) { return next(error); }
  });

  router.get('/agent-configurations', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const rows = await db.all(`${AGENT_CONFIGURATION_SELECT} ORDER BY c.display_name ASC, c.id ASC`);
      return res.json({ data: rows.map(publicAgentConfiguration) });
    } catch (error) { return next(error); }
  });

  router.patch('/agent-configurations/:key', async (req, res, next) => {
    try {
      const key = parseConfigKey(req.params.key, 'configKey');
      const patch = validateAgentConfigurationPatch(req.body || {});
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      if (!isSuperAdministrator(actor)) throw requestError('只有超级管理员可以修改全局功能开关', 403);
      const updated = await withTransaction(db, async (tx) => {
        const current = await tx.one(`${AGENT_CONFIGURATION_SELECT} WHERE c.config_key=? FOR UPDATE`, [key]);
        if (!current) throw requestError('智能体配置不存在；仅支持修改已审核的固定配置', 404);
        const next = {
          display_name: Object.hasOwn(patch, 'display_name') ? patch.display_name : current.display_name,
          description: Object.hasOwn(patch, 'description') ? patch.description : current.description,
          enabled: Object.hasOwn(patch, 'enabled') ? patch.enabled : Boolean(Number(current.enabled)),
          settings_json: Object.hasOwn(patch, 'settings_json') ? patch.settings_json : parseJson(current.settings_json, {}),
        };
        assertAgentConfigurationSafety(key, next.settings_json);
        await tx.execute(`UPDATE agent_configurations
          SET display_name=?,description=?,enabled=?,settings_json=?,updated_by_user_id=? WHERE config_key=?`, [
          next.display_name, next.description, next.enabled, JSON.stringify(next.settings_json), actor.id, key,
        ]);
        const fresh = await tx.one(`${AGENT_CONFIGURATION_SELECT} WHERE c.config_key=?`, [key]);
        await audit(tx, {
          actorUserId: actor.id,
          action: 'agent_configuration.update',
          resourceType: 'agent_configuration',
          resourceId: key,
          ...requestAuditMetadata(req),
          before: publicAgentConfiguration(current),
          after: publicAgentConfiguration(fresh),
        });
        return fresh;
      });
      return res.json({ configuration: publicAgentConfiguration(updated) });
    } catch (error) { return next(error); }
  });

  router.get('/feature-flags', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const rows = await db.all(`${FEATURE_FLAG_SELECT} ORDER BY f.display_name ASC, f.id ASC`);
      return res.json({ data: rows.map(publicFeatureFlag) });
    } catch (error) { return next(error); }
  });

  router.patch('/feature-flags/:key', async (req, res, next) => {
    try {
      const key = parseConfigKey(req.params.key, 'flagKey');
      if (key === 'admin-console') throw requestError('管理后台紧急开关只能通过服务器运维流程恢复', 403);
      const patch = validateFeatureFlagPatch(req.body || {});
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      if (!isSuperAdministrator(actor)) throw requestError('只有超级管理员可以修改全局功能开关', 403);
      const updated = await withTransaction(db, async (tx) => {
        const current = await tx.one(`${FEATURE_FLAG_SELECT} WHERE f.flag_key=? FOR UPDATE`, [key]);
        if (!current) throw requestError('功能开关不存在；仅支持修改已审核的固定开关', 404);
        const next = {
          display_name: Object.hasOwn(patch, 'display_name') ? patch.display_name : current.display_name,
          description: Object.hasOwn(patch, 'description') ? patch.description : current.description,
          enabled: Object.hasOwn(patch, 'enabled') ? patch.enabled : Boolean(Number(current.enabled)),
          rollout_percentage: Object.hasOwn(patch, 'rollout_percentage') ? patch.rollout_percentage : toNumber(current.rollout_percentage, 100),
          audience_json: Object.hasOwn(patch, 'audience_json') ? patch.audience_json : parseJson(current.audience_json, null),
        };
        await tx.execute(`UPDATE feature_flags
          SET display_name=?,description=?,enabled=?,rollout_percentage=?,audience_json=?,updated_by_user_id=? WHERE flag_key=?`, [
          next.display_name, next.description, next.enabled, next.rollout_percentage,
          next.audience_json === null ? null : JSON.stringify(next.audience_json), actor.id, key,
        ]);
        const fresh = await tx.one(`${FEATURE_FLAG_SELECT} WHERE f.flag_key=?`, [key]);
        await audit(tx, {
          actorUserId: actor.id,
          action: 'feature_flag.update',
          resourceType: 'feature_flag',
          resourceId: key,
          ...requestAuditMetadata(req),
          before: publicFeatureFlag(current),
          after: publicFeatureFlag(fresh),
        });
        return fresh;
      });
      return res.json({ featureFlag: publicFeatureFlag(updated) });
    } catch (error) { return next(error); }
  });

  router.get('/audit', async (req, res, next) => {
    try {
      const query = parseAdminAuditQuery(req.query || {});
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const where = auditWhere(query);
      const total = toNumber((await db.one(`SELECT COUNT(*) AS total FROM admin_audit_logs l${where.sql}`, where.params))?.total);
      const rows = await db.all(`SELECT l.*,u.username AS actor_username
        FROM admin_audit_logs l LEFT JOIN users u ON u.id=l.actor_user_id${where.sql}
        ORDER BY l.created_at DESC,l.id DESC LIMIT ${query.pageSize} OFFSET ${query.offset}`, where.params);
      return res.json({ ...paginationPayload({ ...query, total }), data: rows.map(publicAuditLog) });
    } catch (error) { return next(error); }
  });

  return router;
}

export default createAdminRouter();
