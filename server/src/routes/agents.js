import { Router } from 'express';
import { getDB, save } from '../db/index.js';
import { generateProposal } from '../services/agent-service.js';

const router = Router();

function userIdFrom(req) {
  const userId = Number(req.get('x-user-id'));
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function requireUser(req, res) {
  const userId = userIdFrom(req);
  if (!userId) { res.status(401).json({ error: '需要用户身份；接入登录后由 JWT 提供 user_id' }); return null; }
  const user = getDB().prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) { res.status(404).json({ error: '用户不存在' }); return null; }
  return userId;
}

function currentState(db, userId) {
  return {
    admissionPlan: JSON.parse(db.prepare('SELECT plan_json FROM user_admission_plans WHERE user_id = ?').get(userId)?.plan_json || '{}'),
    studyPlan: JSON.parse(db.prepare('SELECT plan_json FROM user_study_plans WHERE user_id = ?').get(userId)?.plan_json || '{}'),
  };
}

router.post('/proposals', async (req, res, next) => {
  try {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { proposalType, question = '', context = {} } = req.body || {};
    if (!['admission', 'study'].includes(proposalType)) return res.status(400).json({ error: 'proposalType 必须为 admission 或 study' });

    const db = getDB();
    const sourceContext = { ...context, currentState: currentState(db, userId) };
    const proposal = await generateProposal({ proposalType, question, context: sourceContext });
    db.prepare('INSERT INTO agent_proposals(user_id,proposal_type,summary,rationale,changes_json,source_context_json,previous_state_json) VALUES(?,?,?,?,?,?,?)')
      .run(userId, proposalType, proposal.summary, proposal.rationale, JSON.stringify(proposal.changes), JSON.stringify(sourceContext), JSON.stringify(currentState(db, userId)));
    const created = db.prepare('SELECT * FROM agent_proposals WHERE id = last_insert_rowid()').get();
    save();
    res.status(201).json({ proposal: { ...created, changes: JSON.parse(created.changes_json) } });
  } catch (error) { next(error); }
});

router.get('/proposals', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const rows = getDB().prepare('SELECT * FROM agent_proposals WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  res.json({ data: rows.map(row => ({ ...row, changes: JSON.parse(row.changes_json) })) });
});

router.post('/proposals/:id/apply', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const db = getDB();
  const proposal = db.prepare("SELECT * FROM agent_proposals WHERE id = ? AND user_id = ? AND status = 'pending'").get(req.params.id, userId);
  if (!proposal) return res.status(404).json({ error: '待确认提案不存在' });

  const changes = JSON.parse(proposal.changes_json);
  const previousState = currentState(db, userId);
  db.transaction(() => {
    for (const change of changes) {
      if (change.operation === 'replace_admission_plan') {
        db.prepare("INSERT INTO user_admission_plans(user_id,plan_json,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET plan_json=excluded.plan_json,updated_at=excluded.updated_at")
          .run(userId, JSON.stringify(change.data || {}));
      }
      if (change.operation === 'replace_study_plan') {
        db.prepare("INSERT INTO user_study_plans(user_id,plan_json,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET plan_json=excluded.plan_json,updated_at=excluded.updated_at")
          .run(userId, JSON.stringify(change.data || {}));
      }
    }
    db.prepare("UPDATE agent_proposals SET status='applied',previous_state_json=?,applied_at=datetime('now'),updated_at=datetime('now') WHERE id=?")
      .run(JSON.stringify(previousState), proposal.id);
  })();
  save();
  res.json({ status: 'applied', currentState: currentState(db, userId) });
});

router.post('/proposals/:id/reject', (req, res) => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const db = getDB();
  db.prepare("UPDATE agent_proposals SET status='rejected',updated_at=datetime('now') WHERE id=? AND user_id=? AND status='pending'").run(req.params.id, userId);
  save();
  res.json({ status: 'rejected' });
});

export default router;
