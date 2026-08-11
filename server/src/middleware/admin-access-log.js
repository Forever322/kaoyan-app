import { createHash, randomUUID } from 'node:crypto';
import { getDB } from '../db/index.js';
import { requestAuditMetadata } from '../services/admin-audit-service.js';
import { upsertAdminAlert } from '../services/admin-alert-service.js';

function boundedPath(req) {
  return `${req.baseUrl || ''}${req.path || ''}`.slice(0, 500) || '/api/admin';
}

const RETENTION_DAYS = Math.min(365, Math.max(7, Number(process.env.ADMIN_ACCESS_LOG_RETENTION_DAYS || 90)));
let lastCleanupAt = 0;

function minimizedIp(value) {
  const ip = String(value || '').trim();
  if (!ip) return '';
  const salt = String(process.env.ADMIN_LOG_IP_HASH_SALT || '');
  if (salt) return createHash('sha256').update(`${salt}\u0000${ip}`).digest('hex');
  const ipv4 = ip.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/u);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0`;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 4).join(':')}::`;
  return ip.slice(0, 64);
}

async function maybePurgeOldLogs(db) {
  const now = Date.now();
  if (now - lastCleanupAt < 6 * 3_600_000) return;
  lastCleanupAt = now;
  await db.execute(`DELETE FROM admin_access_logs
    WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ${RETENTION_DAYS} DAY)`);
}

/**
 * Stores metadata-only read/write access history.  Query strings, request
 * bodies and Authorization headers are deliberately excluded.
 */
export function createAdminAccessLogger({ database = getDB, alert = upsertAdminAlert } = {}) {
  return function adminAccessLogger(req, res, next) {
    const suppliedRequestId = String(req.get?.('x-request-id') || '').trim();
    req.requestId = /^[A-Za-z0-9._:-]{1,128}$/u.test(suppliedRequestId) ? suppliedRequestId : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const startedAt = process.hrtime.bigint();
    res.once('finish', () => {
      const actor = req.adminActor;
      if (!actor?.id) return;
      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      const metadata = requestAuditMetadata(req);
      void Promise.resolve(database()).then(async (db) => {
        await maybePurgeOldLogs(db);
        await db.execute(`INSERT INTO admin_access_logs(
          actor_user_id,method,path,status_code,duration_ms,request_id,ip_address,user_agent
        ) VALUES(?,?,?,?,?,?,?,?)`, [
          actor.id,
          String(req.method || 'GET').slice(0, 12),
          boundedPath(req),
          Number(res.statusCode || 0),
          Math.max(0, durationMs),
          metadata.requestId,
          minimizedIp(metadata.ipAddress),
          metadata.userAgent,
        ]);
        if (Number(res.statusCode || 0) >= 500) {
          await alert(db, {
            alertType: 'admin_api_error',
            severity: 'error',
            title: '管理接口出现服务器错误',
            message: `${String(req.method || 'GET')} ${boundedPath(req)} 返回 ${res.statusCode}`,
            resourceType: 'admin_api',
            resourceId: boundedPath(req),
            fingerprint: String(res.statusCode),
            details: { method: req.method, path: boundedPath(req), statusCode: res.statusCode, durationMs },
          });
        }
      }).catch((error) => {
        console.warn('[AdminAccessLog] 写入失败:', error?.code || error?.message || error);
      });
    });
    next();
  };
}

export default createAdminAccessLogger();
