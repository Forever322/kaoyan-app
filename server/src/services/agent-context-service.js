import { getLegacyCurrentPlans } from './plan-service.js';

const MAX_CONTEXT_FAVORITES = 12;

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

export async function getCurrentPlans(db, userId) {
  return getLegacyCurrentPlans(db, userId);
}

export async function buildAgentContext(db, userId) {
  const [user, subjectStats, totals, memoryRows, favoriteRows] = await Promise.all([
    db.one('SELECT id,username,email FROM users WHERE id=?', [userId]),
    db.all(`SELECT subject, SUM(duration_s) AS duration_s, COUNT(*) AS session_count
      FROM study_sessions
      WHERE user_id=? AND started_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
      GROUP BY subject ORDER BY duration_s DESC LIMIT 8`, [userId]),
    db.one(`SELECT COALESCE(SUM(duration_s),0) AS duration_s, COUNT(*) AS session_count
      FROM study_sessions WHERE user_id=? AND started_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)`, [userId]),
    db.all(`SELECT memory_type,content,metadata_json,updated_at FROM agent_memories
      WHERE user_id=? AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
      ORDER BY updated_at DESC LIMIT 12`, [userId]),
    // The model only receives this small, server-built summary. It never gets
    // database credentials or the ability to construct/run SQL itself.
    db.all(`SELECT
        f.university_id,
        f.created_at AS favorited_at,
        u.name,
        u.province,
        u.city,
        u.zone,
        u.level,
        u.type
      FROM user_favorites f
      INNER JOIN universities u ON u.id=f.university_id
      WHERE f.user_id=?
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ${MAX_CONTEXT_FAVORITES}`, [userId]),
  ]);

  return {
    user: user ? { id: Number(user.id), username: user.username } : null,
    plans: await getCurrentPlans(db, userId),
    study30d: {
      duration_s: Number(totals?.duration_s || 0),
      session_count: Number(totals?.session_count || 0),
      bySubject: subjectStats.map((row) => ({
        ...row,
        duration_s: Number(row.duration_s || 0),
        session_count: Number(row.session_count || 0),
      })),
    },
    memories: memoryRows.map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) })),
    favoriteUniversities: favoriteRows.map((row) => ({
      universityId: Number(row.university_id),
      name: row.name || '',
      province: row.province || '',
      city: row.city || '',
      zone: row.zone || '',
      level: row.level || '',
      type: row.type || '',
      favoritedAt: row.favorited_at || null,
    })),
  };
}

export function publicProposal(row) {
  return {
    id: Number(row.id),
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
