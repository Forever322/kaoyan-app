const MAX_AUDIT_JSON_BYTES = 24 * 1024;
const MAX_AUDIT_METADATA_BYTES = 8 * 1024;
const SENSITIVE_KEY = /(pass(?:word)?|secret|token|api[_-]?key|authorization|credential|cookie|private[_-]?key)/iu;

function boundedText(value, length) {
  return String(value ?? '').trim().slice(0, length);
}

function redactValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactValue(item, seen));
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, child]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[redacted]' : redactValue(child, seen),
  ]));
}

function toJson(value, maxBytes, field) {
  if (value === undefined || value === null) return null;
  const serialized = JSON.stringify(redactValue(value));
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    const error = new Error(`${field} 超过允许大小`);
    error.status = 400;
    throw error;
  }
  return serialized;
}

export function safeAuditSnapshot(value) {
  return redactValue(value);
}

/**
 * Records only deliberate, non-secret administration events.  Callers should
 * pass DTO-shaped before/after values rather than raw request bodies.
 */
export async function writeAdminAudit(db, {
  actorUserId = null,
  action,
  resourceType,
  resourceId = '',
  requestId = '',
  ipAddress = '',
  userAgent = '',
  before = null,
  after = null,
  metadata = null,
} = {}) {
  const normalizedAction = boundedText(action, 96);
  const normalizedResourceType = boundedText(resourceType, 64);
  if (!normalizedAction || !normalizedResourceType) throw new Error('审计日志缺少 action 或 resourceType');
  const normalizedActor = Number(actorUserId);
  const actor = Number.isSafeInteger(normalizedActor) && normalizedActor > 0 ? normalizedActor : null;
  await db.execute(`INSERT INTO admin_audit_logs(
    actor_user_id,action,resource_type,resource_id,request_id,ip_address,user_agent,before_json,after_json,metadata_json
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`, [
    actor,
    normalizedAction,
    normalizedResourceType,
    boundedText(resourceId, 128),
    boundedText(requestId, 128),
    boundedText(ipAddress, 64),
    boundedText(userAgent, 512),
    toJson(before, MAX_AUDIT_JSON_BYTES, 'before'),
    toJson(after, MAX_AUDIT_JSON_BYTES, 'after'),
    toJson(metadata, MAX_AUDIT_METADATA_BYTES, 'metadata'),
  ]);
}

export function requestAuditMetadata(req) {
  const forwarded = String(req.get?.('x-forwarded-for') || '').split(',').at(-1).trim();
  return {
    requestId: boundedText(req.requestId || req.get?.('x-request-id') || '', 128),
    ipAddress: boundedText(forwarded || req.ip || req.socket?.remoteAddress || '', 64),
    userAgent: boundedText(req.get?.('user-agent') || '', 512),
  };
}

export function parseAuditJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return safeAuditSnapshot(value);
  try { return safeAuditSnapshot(JSON.parse(value)); } catch { return null; }
}
