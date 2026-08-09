import { getLegacyCurrentPlans } from './plan-service.js';

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

export function getCurrentPlans(db, userId) {
  return getLegacyCurrentPlans(db, userId);
}

export function buildAgentContext(db, userId) {
  const user = db.prepare('SELECT id,username,email FROM users WHERE id=?').get(userId);
  const subjectStats = db.prepare(`
    SELECT subject, SUM(duration_s) AS duration_s, COUNT(*) AS session_count
    FROM study_sessions
    WHERE user_id=? AND datetime(started_at) >= datetime('now', '-30 days')
    GROUP BY subject ORDER BY duration_s DESC LIMIT 8
  `).all(userId).map((row) => ({ ...row, duration_s: Number(row.duration_s || 0), session_count: Number(row.session_count || 0) }));
  const totals = db.prepare(`
    SELECT COALESCE(SUM(duration_s),0) AS duration_s, COUNT(*) AS session_count
    FROM study_sessions WHERE user_id=? AND datetime(started_at) >= datetime('now', '-30 days')
  `).get(userId);
  const memories = db.prepare(`
    SELECT memory_type,content,metadata_json,updated_at FROM agent_memories
    WHERE user_id=? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    ORDER BY updated_at DESC LIMIT 12
  `).all(userId).map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) }));

  return {
    user: user ? { id: user.id, username: user.username } : null,
    plans: getCurrentPlans(db, userId),
    study30d: { duration_s: Number(totals?.duration_s || 0), session_count: Number(totals?.session_count || 0), bySubject: subjectStats },
    memories,
  };
}

export function publicProposal(row) {
  return {
    id: row.id,
    proposalType: row.proposal_type,
    status: row.status,
    summary: row.summary,
    rationale: row.rationale,
    changes: parseJson(row.changes_json, []),
    baseRevision: Number(row.base_revision || 0),
    expiresAt: row.expires_at || null,
    appliedAt: row.applied_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
