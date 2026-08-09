import { Router } from 'express';
import { getDB, save } from '../db/index.js';
import { requireAuthenticatedUser } from '../services/auth-service.js';

const router = Router();
const MAX_SESSION_SECONDS = 24 * 60 * 60;

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function toDatabaseDate(value, field) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) throw invalid(`${field}格式不正确`);
  if (date.getTime() > Date.now() + 5 * 60_000) throw invalid(`${field}不能晚于当前时间 5 分钟`);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

router.post('/sessions', (req, res, next) => {
  try {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;
    const { subject = '', content = '', startedAt, endedAt = null, durationS } = req.body || {};
    const duration = Number(durationS);
    if (!String(subject).trim() || !startedAt || !Number.isInteger(duration) || duration < 0 || duration > MAX_SESSION_SECONDS) {
      return res.status(400).json({ error: '请提供学科、开始时间与 0–86400 秒的学习时长' });
    }
    const normalizedStartedAt = toDatabaseDate(startedAt, 'startedAt');
    const normalizedEndedAt = endedAt ? toDatabaseDate(endedAt, 'endedAt') : null;
    if (normalizedEndedAt && normalizedEndedAt < normalizedStartedAt) {
      return res.status(400).json({ error: 'endedAt 不能早于 startedAt' });
    }
    const db = getDB();
    db.prepare('INSERT INTO study_sessions(user_id,subject,content,started_at,ended_at,duration_s) VALUES(?,?,?,?,?,?)')
      .run(user.id, String(subject).trim().slice(0, 40), String(content).slice(0, 200), normalizedStartedAt, normalizedEndedAt, duration);
    const session = db.prepare('SELECT * FROM study_sessions WHERE id=last_insert_rowid()').get();
    save();
    return res.status(201).json({ session });
  } catch (error) {
    next(error);
  }
});

router.get('/summary', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
  const db = getDB();
  const total = db.prepare(`SELECT COALESCE(SUM(duration_s),0) AS duration_s, COUNT(*) AS session_count FROM study_sessions WHERE user_id=? AND datetime(started_at) >= datetime('now', ?)`)
    .get(user.id, `-${days} days`);
  const bySubject = db.prepare(`SELECT subject,COALESCE(SUM(duration_s),0) AS duration_s,COUNT(*) AS session_count FROM study_sessions WHERE user_id=? AND datetime(started_at) >= datetime('now', ?) GROUP BY subject ORDER BY duration_s DESC`)
    .all(user.id, `-${days} days`);
  return res.json({ days, durationS: Number(total.duration_s || 0), sessionCount: Number(total.session_count || 0), bySubject: bySubject.map((row) => ({ subject: row.subject, durationS: Number(row.duration_s || 0), sessionCount: Number(row.session_count || 0) })) });
});

export default router;
