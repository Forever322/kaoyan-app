import { Router } from 'express';
import { getDB, save } from '../db/index.js';
import { requireAuthenticatedUser } from '../services/auth-service.js';
import { buildAgentContext, getCurrentPlans, publicProposal } from '../services/agent-context-service.js';
import { AgentServiceError, generateChatReply, generateProposal } from '../services/agent-service.js';
import { getPlanState, getPlansState, replacePlan, validatePlan } from '../services/plan-service.js';
import { runAuditedAgentCall } from '../services/agent-run-service.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

const router = Router();
const MAX_QUESTION_LENGTH = 2_000;
const MAX_CONTEXT_BYTES = 20_000;
const MAX_MEMORY_METADATA_BYTES = 4_000;
const MEMORY_TYPES = new Set(['preference', 'goal', 'study-state', 'admission-state', 'feedback']);
const PROPOSAL_TTL_DAYS = Math.min(30, Math.max(1, Number(process.env.AGENT_PROPOSAL_TTL_DAYS || 7)));
const AGENT_REQUESTS_PER_MINUTE = Math.min(30, Math.max(1, Number(process.env.AGENT_REQUESTS_PER_MINUTE || 8)));
const agentGenerationRateLimiter = createRateLimiter({ windowMs: 60_000, max: AGENT_REQUESTS_PER_MINUTE });

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function validateObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error(`${label}必须是对象`);
    error.status = 400;
    throw error;
  }
  return value;
}

function safeClientContext(value) {
  const context = value === undefined ? {} : validateObject(value, 'context');
  const serialized = JSON.stringify(context);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTEXT_BYTES) {
    const error = new Error('context 不能超过 20KB');
    error.status = 413;
    throw error;
  }
  return context;
}

function normalizeExpiry(value) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    const error = new Error('expiresAt 必须是未来的有效时间');
    error.status = 400;
    throw error;
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function proposalExpiry() {
  const date = new Date(Date.now() + PROPOSAL_TTL_DAYS * 86400_000);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function isExpired(value) {
  if (!value) return false;
  const date = new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'));
  return !Number.isNaN(date.getTime()) && date.getTime() <= Date.now();
}

function allowedOperation(proposalType) {
  return proposalType === 'study' ? 'replace_study_plan' : 'replace_admission_plan';
}

function assertProposalChanges(proposalType, changes) {
  if (!Array.isArray(changes) || changes.length !== 1) {
    const error = new Error('提案必须包含且只包含一项变更');
    error.status = 422;
    throw error;
  }
  const change = changes[0];
  if (!change || change.operation !== allowedOperation(proposalType) || !change.data || typeof change.data !== 'object' || Array.isArray(change.data)) {
    const error = new Error('提案包含不允许的变更操作');
    error.status = 422;
    throw error;
  }
  return change;
}

function getProposalForUser(db, userId, id) {
  return db.prepare('SELECT * FROM agent_proposals WHERE id=? AND user_id=?').get(id, userId);
}

function getConversationForUser(db, userId, id) {
  return db.prepare('SELECT * FROM agent_conversations WHERE id=? AND user_id=?').get(id, userId);
}

function publicConversation(row) {
  return { id: row.id, agentType: row.agent_type, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

router.get('/context', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  return res.json({ context: buildAgentContext(getDB(), user.id) });
});

router.get('/memories', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  const rows = getDB().prepare(`SELECT id,memory_type,content,metadata_json,expires_at,created_at,updated_at FROM agent_memories WHERE user_id=? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now')) ORDER BY updated_at DESC LIMIT 50`).all(user.id);
  return res.json({ data: rows.map((row) => ({ id: row.id, memoryType: row.memory_type, content: row.content, metadata: parseJson(row.metadata_json, {}), expiresAt: row.expires_at || null, createdAt: row.created_at, updatedAt: row.updated_at })) });
});

router.post('/memories', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  const { memoryType = 'preference', content = '', metadata = {}, expiresAt = null } = req.body || {};
  if (!MEMORY_TYPES.has(memoryType) || !String(content).trim() || String(content).length > 1_000) return res.status(400).json({ error: '记忆类型或内容不合法' });
  validateObject(metadata, 'metadata');
  if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > MAX_MEMORY_METADATA_BYTES) return res.status(413).json({ error: 'metadata 不能超过 4KB' });
  const normalizedExpiry = normalizeExpiry(expiresAt);
  const db = getDB();
  db.prepare('INSERT INTO agent_memories(user_id,memory_type,content,metadata_json,expires_at) VALUES(?,?,?,?,?)')
    .run(user.id, memoryType, String(content).trim(), JSON.stringify(metadata), normalizedExpiry);
  const row = db.prepare('SELECT * FROM agent_memories WHERE id=last_insert_rowid()').get();
  save();
  return res.status(201).json({ memory: { id: row.id, memoryType: row.memory_type, content: row.content, metadata: parseJson(row.metadata_json, {}), expiresAt: row.expires_at || null } });
});

router.delete('/memories/:id', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  const db = getDB();
  const memory = db.prepare('SELECT id FROM agent_memories WHERE id=? AND user_id=?').get(req.params.id, user.id);
  if (!memory) return res.status(404).json({ error: '记忆不存在' });
  db.prepare('DELETE FROM agent_memories WHERE id=?').run(memory.id);
  save();
  return res.status(204).end();
});

router.post('/conversations', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  const { agentType = 'study-assistant', title = '', context = {} } = req.body || {};
  if (String(agentType).length > 40 || String(title).length > 100) return res.status(400).json({ error: '会话参数不合法' });
  const clientContext = safeClientContext(context);
  const db = getDB();
  db.prepare('INSERT INTO agent_conversations(user_id,agent_type,title,context_json) VALUES(?,?,?,?)')
    .run(user.id, String(agentType), String(title), JSON.stringify(clientContext));
  const conversation = db.prepare('SELECT * FROM agent_conversations WHERE id=last_insert_rowid()').get();
  save();
  return res.status(201).json({ conversation: publicConversation(conversation) });
});

router.get('/conversations', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  const rows = getDB().prepare(`SELECT c.*, (SELECT content FROM agent_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message FROM agent_conversations c WHERE c.user_id=? ORDER BY c.updated_at DESC, c.id DESC LIMIT 50`).all(user.id);
  return res.json({ data: rows.map((row) => ({ ...publicConversation(row), lastMessage: row.last_message || '' })) });
});

router.get('/conversations/:id', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  const db = getDB();
  const conversation = getConversationForUser(db, user.id, req.params.id);
  if (!conversation) return res.status(404).json({ error: '会话不存在' });
  const messages = db.prepare('SELECT id,role,content,metadata_json,created_at FROM agent_messages WHERE conversation_id=? ORDER BY id ASC LIMIT 200').all(conversation.id);
  return res.json({ conversation: publicConversation(conversation), messages: messages.map((row) => ({ id: row.id, role: row.role, content: row.content, metadata: parseJson(row.metadata_json, {}), createdAt: row.created_at })) });
});

router.delete('/conversations/:id', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  const db = getDB();
  const conversation = getConversationForUser(db, user.id, req.params.id);
  if (!conversation) return res.status(404).json({ error: '会话不存在' });
  db.prepare('DELETE FROM agent_conversations WHERE id=?').run(conversation.id);
  save();
  return res.status(204).end();
});

router.post('/conversations/:id/messages', agentGenerationRateLimiter, async (req, res, next) => {
  try {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;
    const message = String(req.body?.message || '').trim();
    if (!message || message.length > MAX_QUESTION_LENGTH) return res.status(400).json({ error: `消息长度需为 1–${MAX_QUESTION_LENGTH} 个字符` });
    const db = getDB();
    const conversation = getConversationForUser(db, user.id, req.params.id);
    if (!conversation) return res.status(404).json({ error: '会话不存在' });
    const history = db.prepare('SELECT role,content FROM agent_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 16').all(conversation.id).reverse();
    const context = { ...buildAgentContext(db, user.id), conversation: parseJson(conversation.context_json, {}) };
    const reply = await runAuditedAgentCall(db, {
      userId: user.id,
      runType: 'conversation',
      input: { message, context, history },
      run: () => generateChatReply({ message, context, history }),
    });
    db.transaction(() => {
      db.prepare('INSERT INTO agent_messages(conversation_id,role,content) VALUES(?,?,?)').run(conversation.id, 'user', message);
      db.prepare('INSERT INTO agent_messages(conversation_id,role,content,metadata_json) VALUES(?,?,?,?)').run(conversation.id, 'assistant', reply.reply, JSON.stringify({ suggestions: reply.suggestions, canCreateProposal: reply.canCreateProposal, model: process.env.AGENT_MODEL || 'deepseek-chat' }));
      db.prepare("UPDATE agent_conversations SET title=CASE WHEN title='' THEN ? ELSE title END,updated_at=datetime('now') WHERE id=?").run(message.slice(0, 32), conversation.id);
    })();
    const assistantMessage = db.prepare('SELECT id,role,content,metadata_json,created_at FROM agent_messages WHERE id=last_insert_rowid()').get();
    save();
    return res.status(201).json({ message: { id: assistantMessage.id, role: assistantMessage.role, content: assistantMessage.content, metadata: parseJson(assistantMessage.metadata_json, {}), createdAt: assistantMessage.created_at } });
  } catch (error) { next(error); }
});

router.post('/proposals', agentGenerationRateLimiter, async (req, res, next) => {
  try {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;
    const { proposalType, question = '', context = {} } = req.body || {};
    if (!['admission', 'study'].includes(proposalType)) return res.status(400).json({ error: 'proposalType 必须为 admission 或 study' });
    if (String(question).length > MAX_QUESTION_LENGTH) return res.status(400).json({ error: `question 不能超过 ${MAX_QUESTION_LENGTH} 个字符` });
    const db = getDB();
    const sourceContext = { agentContext: buildAgentContext(db, user.id), clientContext: safeClientContext(context) };
    const proposal = await runAuditedAgentCall(db, {
      userId: user.id,
      runType: 'proposal',
      input: { proposalType, question, context: sourceContext },
      run: () => generateProposal({ proposalType, question, context: sourceContext }),
    });
    assertProposalChanges(proposalType, proposal.changes);
    validatePlan(proposal.changes[0].data);
    const before = getPlansState(db, user.id);
    const targetPlan = getPlanState(db, user.id, proposalType);
    db.prepare('INSERT INTO agent_proposals(user_id,proposal_type,summary,rationale,changes_json,source_context_json,previous_state_json,base_revision,expires_at,model) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(user.id, proposalType, proposal.summary, proposal.rationale, JSON.stringify(proposal.changes), JSON.stringify(sourceContext), JSON.stringify(before), targetPlan.revision, proposalExpiry(), String(process.env.AGENT_MODEL || 'deepseek-chat').slice(0, 80));
    const created = db.prepare('SELECT * FROM agent_proposals WHERE id = last_insert_rowid()').get();
    save();
    return res.status(201).json({ proposal: publicProposal(created) });
  } catch (error) { next(error); }
});

router.get('/proposals', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  const db = getDB();
  const expiredRows = db.prepare("SELECT id FROM agent_proposals WHERE user_id=? AND status='pending' AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')").all(user.id);
  if (expiredRows.length) {
    db.prepare("UPDATE agent_proposals SET status='expired',updated_at=datetime('now') WHERE user_id=? AND status='pending' AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')").run(user.id);
    save();
  }
  const rows = db.prepare('SELECT * FROM agent_proposals WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(user.id);
  return res.json({ data: rows.map(publicProposal) });
});

router.post('/proposals/:id/apply', (req, res, next) => {
  try {
    const user = requireAuthenticatedUser(req, res);
    if (!user) return;
    const db = getDB();
    const proposal = getProposalForUser(db, user.id, req.params.id);
    if (!proposal) return res.status(404).json({ error: '提案不存在' });
    if (proposal.status !== 'pending') return res.status(409).json({ error: `该提案当前状态为 ${proposal.status}，不能重复应用` });
    if (isExpired(proposal.expires_at)) {
      db.prepare("UPDATE agent_proposals SET status='expired',updated_at=datetime('now') WHERE id=?").run(proposal.id);
      save();
      return res.status(409).json({ error: '该提案已过期，请重新生成建议' });
    }
    const changes = parseJson(proposal.changes_json, null);
    const change = assertProposalChanges(proposal.proposal_type, changes);
    validatePlan(change.data);
    const targetPlan = getPlanState(db, user.id, proposal.proposal_type);
    if (Number(proposal.base_revision || 0) !== targetPlan.revision) {
      return res.status(409).json({
        error: '计划已在生成建议后发生变化，请重新生成或手动合并',
        currentRevision: targetPlan.revision,
      });
    }
    const previousState = getPlansState(db, user.id);
    let appliedPlan;
    db.transaction(() => {
      appliedPlan = replacePlan(db, user.id, proposal.proposal_type, change.data, Number(proposal.base_revision || 0));
      db.prepare("UPDATE agent_proposals SET status='applied',previous_state_json=?,applied_at=datetime('now'),updated_at=datetime('now') WHERE id=?")
        .run(JSON.stringify(previousState), proposal.id);
    })();
    save();
    return res.json({ status: 'applied', planType: proposal.proposal_type, plan: appliedPlan, currentState: getCurrentPlans(db, user.id) });
  } catch (error) { next(error); }
});

router.post('/proposals/:id/reject', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  const db = getDB();
  const proposal = getProposalForUser(db, user.id, req.params.id);
  if (!proposal) return res.status(404).json({ error: '提案不存在' });
  if (proposal.status !== 'pending') return res.status(409).json({ error: `该提案当前状态为 ${proposal.status}，不能拒绝` });
  db.prepare("UPDATE agent_proposals SET status='rejected',updated_at=datetime('now') WHERE id=?").run(proposal.id);
  save();
  return res.json({ status: 'rejected' });
});

export function agentErrorHandler(error, _req, res, _next) {
  if (error instanceof AgentServiceError) return res.status(502).json({ error: error.message, code: error.code });
  if (error.status) return res.status(error.status).json({ error: error.message || '请求参数不合法' });
  return res.status(500).json({ error: '服务器内部错误' });
}

export default router;
