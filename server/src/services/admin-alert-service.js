import { createHash } from 'node:crypto';
import { parseAuditJson, safeAuditSnapshot } from './admin-audit-service.js';

const SEVERITIES = new Set(['info', 'warning', 'error', 'critical']);

function bounded(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function severity(value) {
  const normalized = bounded(value, 16).toLowerCase();
  return SEVERITIES.has(normalized) ? normalized : 'warning';
}

function detailsJson(value) {
  if (value === undefined || value === null) return null;
  const serialized = JSON.stringify(safeAuditSnapshot(value));
  if (Buffer.byteLength(serialized, 'utf8') > 16 * 1024) {
    return JSON.stringify({ truncated: true, reason: 'alert_details_too_large' });
  }
  return serialized;
}

export function adminAlertKey({ alertType, resourceType = '', resourceId = '', fingerprint = '' }) {
  return createHash('sha256')
    .update([alertType, resourceType, resourceId, fingerprint].map((value) => String(value || '')).join('\u0000'))
    .digest('hex');
}

/**
 * Creates an alert or refreshes the existing alert with the same stable key.
 * A newly detected occurrence reopens a resolved incident so it cannot be
 * hidden by an earlier acknowledgement.
 */
export async function upsertAdminAlert(db, {
  alertType,
  severity: requestedSeverity = 'warning',
  title,
  message = '',
  resourceType = '',
  resourceId = '',
  fingerprint = '',
  details = null,
} = {}) {
  const normalizedType = bounded(alertType, 64);
  const normalizedTitle = bounded(title, 255);
  if (!normalizedType || !normalizedTitle) throw new Error('告警缺少 alertType 或 title');
  const key = adminAlertKey({
    alertType: normalizedType,
    resourceType: bounded(resourceType, 64),
    resourceId: bounded(resourceId, 128),
    fingerprint: bounded(fingerprint, 255),
  });
  await db.execute(`INSERT INTO admin_alerts(
      alert_key,alert_type,severity,title,message,resource_type,resource_id,details_json
    ) VALUES(?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      severity=VALUES(severity),title=VALUES(title),message=VALUES(message),details_json=VALUES(details_json),
      occurrence_count=occurrence_count+1,last_detected_at=UTC_TIMESTAMP(3),
      acknowledged_by_user_id=NULL,acknowledged_at=NULL,
      resolved_by_user_id=NULL,resolved_at=NULL,status='open'`, [
    key,
    normalizedType,
    severity(requestedSeverity),
    normalizedTitle,
    bounded(message, 1000),
    bounded(resourceType, 64),
    bounded(resourceId, 128),
    detailsJson(details),
  ]);
  return key;
}

export function publicAdminAlert(row) {
  return {
    id: Number(row.id),
    alertType: row.alert_type || '',
    severity: row.severity || 'warning',
    title: row.title || '',
    message: row.message || '',
    resourceType: row.resource_type || '',
    resourceId: row.resource_id || '',
    details: parseAuditJson(row.details_json),
    status: row.status || 'open',
    occurrenceCount: Number(row.occurrence_count || 0),
    firstDetectedAt: row.first_detected_at || null,
    lastDetectedAt: row.last_detected_at || null,
    acknowledgedAt: row.acknowledged_at || null,
    resolvedAt: row.resolved_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}
