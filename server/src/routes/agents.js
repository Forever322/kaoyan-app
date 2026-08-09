import { Router } from 'express';
import { getDB } from '../db/index.js';
import { requireAuthenticatedUser } from '../services/auth-service.js';
import { buildAgentContext, getCurrentPlans, publicProposal } from '../services/agent-context-service.js';
import { AgentServiceError, generateChatReply, generateProposal } from '../services/agent-service.js';
import { KAOYAN_COACH_POLICY_VERSION } from '../services/kaoyan-coach-policy.js';
import { getPlanState, getPlansState, replacePlan, validateAgentPlan } from '../services/plan-service.js';
import { runAuditedAgentCall } from '../services/agent-run-service.js';
import { assertAgentCapabilityEnabled } from '../services/agent-runtime-policy.js';
import { createRateLimiter } from '../middleware/rate-limit.js';

const router = Router();
const MAX_QUESTION_LENGTH = 2_000;
const MAX_CONTEXT_BYTES = 20_000;
const MAX_MEMORY_METADATA_BYTES = 4_000;
const MEMORY_TYPES = new Set(['preference', 'goal', 'study-state', 'admission-state', 'feedback']);
const AGENT_TYPES = new Set(['study-assistant', 'kaoyan-coach']);
const COACH_PROFILE = 'kaoyan-coach-zh';
const COACH_PROFILE_VERSION = KAOYAN_COACH_POLICY_VERSION;
const MAX_COACH_INTAKE_QUESTIONS = 6;
const MAX_COACH_INTAKE_QUESTION_LENGTH = 120;
const PROPOSAL_TTL_DAYS = Math.min(30, Math.max(1, Number(process.env.AGENT_PROPOSAL_TTL_DAYS || 7)));
const AGENT_REQUESTS_PER_MINUTE = Math.min(30, Math.max(1, Number(process.env.AGENT_REQUESTS_PER_MINUTE || 8)));
const agentGenerationRateLimiter = createRateLimiter({ windowMs: 60_000, max: AGENT_REQUESTS_PER_MINUTE });

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
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

function normalizeAgentType(value) {
  const agentType = String(value ?? '').trim();
  if (!AGENT_TYPES.has(agentType)) {
    const error = new Error('agentType 仅支持 study-assistant 或 kaoyan-coach');
    error.status = 400;
    throw error;
  }
  return agentType;
}

// Conversations made before agent types were constrained remain readable. New
// conversations can only persist the allowlisted values above.
function conversationAgentType(value) {
  const agentType = String(value ?? '').trim();
  return AGENT_TYPES.has(agentType) ? agentType : 'study-assistant';
}

function safeStringList(value, { limit, maxLength }) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => item.slice(0, maxLength));
}

function assistantMessageMetadata(agentType, reply) {
  const metadata = {
    agentType,
    suggestions: safeStringList(reply?.suggestions, { limit: 3, maxLength: 24 }),
    canCreateProposal: reply?.canCreateProposal !== false,
    model: String(process.env.AGENT_MODEL || 'deepseek-chat').slice(0, 80),
  };
  if (agentType === 'kaoyan-coach') {
    // Only persist a normalized subset of model output. Client context never
    // controls these fields; agent_type remains the source of truth.
    metadata.coach = {
      profile: COACH_PROFILE,
      version: COACH_PROFILE_VERSION,
      needsIntake: reply?.needsIntake === true,
      questions: safeStringList(reply?.questions, {
        limit: MAX_COACH_INTAKE_QUESTIONS,
        maxLength: MAX_COACH_INTAKE_QUESTION_LENGTH,
      }),
    };
  }
  return metadata;
}

function mysqlUtcDate(date) {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function normalizeExpiry(value) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    const error = new Error('expiresAt 必须是未来的有效时间');
    error.status = 400;
    throw error;
  }
  return mysqlUtcDate(date);
}

function proposalExpiry() {
  return mysqlUtcDate(new Date(Date.now() + PROPOSAL_TTL_DAYS * 86400_000));
}

function isExpired(value) {
  if (!value) return false;
  const normalized = String(value).replace(' ', 'T');
  const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
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

async function getProposalForUser(db, userId, id) {
  return db.one('SELECT * FROM agent_proposals WHERE id=? AND user_id=?', [id, userId]);
}

async function getConversationForUser(db, userId, id) {
  return db.one('SELECT * FROM agent_conversations WHERE id=? AND user_id=?', [id, userId]);
}

function publicConversation(row) {
  return { id: Number(row.id), agentType: row.agent_type, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

router.get('/context', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    return res.json({ context: await buildAgentContext(db, user.id) });
  } catch (error) { return next(error); }
});

router.get('/memories', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const rows = await db.all(`SELECT id,memory_type,content,metadata_json,expires_at,created_at,updated_at FROM agent_memories
      WHERE user_id=? AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
      ORDER BY updated_at DESC LIMIT 50`, [user.id]);
    return res.json({ data: rows.map((row) => ({
      id: Number(row.id), memoryType: row.memory_type, content: row.content,
      metadata: parseJson(row.metadata_json, {}), expiresAt: row.expires_at || null,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })) });
  } catch (error) { return next(error); }
});

router.post('/memories', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const { memoryType = 'preference', content = '', metadata = {}, expiresAt = null } = req.body || {};
    if (!MEMORY_TYPES.has(memoryType) || !String(content).trim() || String(content).length > 1_000) {
      return res.status(400).json({ error: '记忆类型或内容不合法' });
    }
    validateObject(metadata, 'metadata');
    if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > MAX_MEMORY_METADATA_BYTES) {
      return res.status(413).json({ error: 'metadata 不能超过 4KB' });
    }
    const normalizedExpiry = normalizeExpiry(expiresAt);
    const result = await db.execute('INSERT INTO agent_memories(user_id,memory_type,content,metadata_json,expires_at) VALUES(?,?,?,?,?)', [
      user.id, memoryType, String(content).trim(), JSON.stringify(metadata), normalizedExpiry,
    ]);
    const row = await db.one('SELECT * FROM agent_memories WHERE id=?', [result.insertId]);
    return res.status(201).json({ memory: {
      id: Number(row.id), memoryType: row.memory_type, content: row.content,
      metadata: parseJson(row.metadata_json, {}), expiresAt: row.expires_at || null,
    } });
  } catch (error) { return next(error); }
});

router.delete('/memories/:id', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const memory = await db.one('SELECT id FROM agent_memories WHERE id=? AND user_id=?', [req.params.id, user.id]);
    if (!memory) return res.status(404).json({ error: '记忆不存在' });
    await db.execute('DELETE FROM agent_memories WHERE id=?', [memory.id]);
    return res.status(204).end();
  } catch (error) { return next(error); }
});

router.post('/conversations', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const { agentType = 'study-assistant', title = '', context = {} } = req.body || {};
    const normalizedAgentType = normalizeAgentType(agentType);
    await assertAgentCapabilityEnabled(db, { userId: user.id, agentType: normalizedAgentType, capability: 'chat' });
    if (String(title).length > 100) return res.status(400).json({ error: '会话参数不合法' });
    const clientContext = safeClientContext(context);
    const result = await db.execute('INSERT INTO agent_conversations(user_id,agent_type,title,context_json) VALUES(?,?,?,?)', [
      user.id, normalizedAgentType, String(title), JSON.stringify(clientContext),
    ]);
    const conversation = await db.one('SELECT * FROM agent_conversations WHERE id=?', [result.insertId]);
    return res.status(201).json({ conversation: publicConversation(conversation) });
  } catch (error) { return next(error); }
});

router.get('/conversations', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const rows = await db.all(`SELECT c.*, (
      SELECT content FROM agent_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1
    ) AS last_message FROM agent_conversations c
    WHERE c.user_id=? ORDER BY c.updated_at DESC, c.id DESC LIMIT 50`, [user.id]);
    return res.json({ data: rows.map((row) => ({ ...publicConversation(row), lastMessage: row.last_message || '' })) });
  } catch (error) { return next(error); }
});

router.get('/conversations/:id', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const conversation = await getConversationForUser(db, user.id, req.params.id);
    if (!conversation) return res.status(404).json({ error: '会话不存在' });
    const messages = await db.all('SELECT id,role,content,metadata_json,created_at FROM agent_messages WHERE conversation_id=? ORDER BY id ASC LIMIT 200', [conversation.id]);
    return res.json({ conversation: publicConversation(conversation), messages: messages.map((row) => ({
      id: Number(row.id), role: row.role, content: row.content,
      metadata: parseJson(row.metadata_json, {}), createdAt: row.created_at,
    })) });
  } catch (error) { return next(error); }
});

router.delete('/conversations/:id', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const conversation = await getConversationForUser(db, user.id, req.params.id);
    if (!conversation) return res.status(404).json({ error: '会话不存在' });
    await db.execute('DELETE FROM agent_conversations WHERE id=?', [conversation.id]);
    return res.status(204).end();
  } catch (error) { return next(error); }
});

router.post('/conversations/:id/messages', agentGenerationRateLimiter, async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const message = String(req.body?.message || '').trim();
    if (!message || message.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({ error: `消息长度需为 1–${MAX_QUESTION_LENGTH} 个字符` });
    }
    const conversation = await getConversationForUser(db, user.id, req.params.id);
    if (!conversation) return res.status(404).json({ error: '会话不存在' });
    const agentType = conversationAgentType(conversation.agent_type);
    await assertAgentCapabilityEnabled(db, { userId: user.id, agentType, capability: 'chat' });
    const history = (await db.all('SELECT role,content FROM agent_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 16', [conversation.id])).reverse();
    const context = { ...await buildAgentContext(db, user.id), conversation: parseJson(conversation.context_json, {}) };
    const reply = await runAuditedAgentCall(db, {
      userId: user.id,
      runType: 'conversation',
      input: { agentType, message, context, history },
      run: () => generateChatReply({ agentType, message, context, history }),
    });
    const messageMetadata = assistantMessageMetadata(agentType, reply);
    const assistantMessage = await db.transaction(async (tx) => {
      await tx.execute('INSERT INTO agent_messages(conversation_id,role,content,metadata_json) VALUES(?,?,?,?)', [
        conversation.id, 'user', message, '{}',
      ]);
      const inserted = await tx.execute('INSERT INTO agent_messages(conversation_id,role,content,metadata_json) VALUES(?,?,?,?)', [
        conversation.id,
        'assistant',
        reply.reply,
        JSON.stringify(messageMetadata),
      ]);
      await tx.execute("UPDATE agent_conversations SET title=CASE WHEN title='' THEN ? ELSE title END,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [message.slice(0, 32), conversation.id]);
      return tx.one('SELECT id,role,content,metadata_json,created_at FROM agent_messages WHERE id=?', [inserted.insertId]);
    });
    return res.status(201).json({ message: {
      id: Number(assistantMessage.id), role: assistantMessage.role, content: assistantMessage.content,
      metadata: parseJson(assistantMessage.metadata_json, {}), createdAt: assistantMessage.created_at,
    } });
  } catch (error) { return next(error); }
});

router.post('/proposals', agentGenerationRateLimiter, async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const { proposalType, question = '', context = {}, agentType = 'study-assistant' } = req.body || {};
    if (!['admission', 'study'].includes(proposalType)) return res.status(400).json({ error: 'proposalType 必须为 admission 或 study' });
    if (String(question).length > MAX_QUESTION_LENGTH) return res.status(400).json({ error: `question 不能超过 ${MAX_QUESTION_LENGTH} 个字符` });
    const normalizedAgentType = normalizeAgentType(agentType);
    await assertAgentCapabilityEnabled(db, { userId: user.id, agentType: normalizedAgentType, capability: 'proposal' });
    const sourceContext = {
      agentType: normalizedAgentType,
      agentContext: await buildAgentContext(db, user.id),
      clientContext: safeClientContext(context),
    };
    const proposal = await runAuditedAgentCall(db, {
      userId: user.id,
      runType: 'proposal',
      input: { agentType: normalizedAgentType, proposalType, question, context: sourceContext },
      run: () => generateProposal({ agentType: normalizedAgentType, proposalType, question, context: sourceContext }),
    });
    assertProposalChanges(proposalType, proposal.changes);
    validateAgentPlan(proposalType, proposal.changes[0].data);
    const before = await getPlansState(db, user.id);
    const targetPlan = await getPlanState(db, user.id, proposalType);
    const result = await db.execute(`INSERT INTO agent_proposals(
      user_id,proposal_type,summary,rationale,changes_json,source_context_json,previous_state_json,base_revision,expires_at,model
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`, [
      user.id, proposalType, proposal.summary, proposal.rationale, JSON.stringify(proposal.changes),
      JSON.stringify(sourceContext), JSON.stringify(before), targetPlan.revision, proposalExpiry(),
      String(process.env.AGENT_MODEL || 'deepseek-chat').slice(0, 80),
    ]);
    const created = await db.one('SELECT * FROM agent_proposals WHERE id=?', [result.insertId]);
    return res.status(201).json({ proposal: publicProposal(created) });
  } catch (error) { return next(error); }
});

router.get('/proposals', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    await db.execute(`UPDATE agent_proposals SET status='expired',updated_at=UTC_TIMESTAMP(3)
      WHERE user_id=? AND status='pending' AND expires_at IS NOT NULL AND expires_at <= UTC_TIMESTAMP(3)`, [user.id]);
    const rows = await db.all('SELECT * FROM agent_proposals WHERE user_id=? ORDER BY created_at DESC, id DESC', [user.id]);
    return res.json({ data: rows.map(publicProposal) });
  } catch (error) { return next(error); }
});

router.post('/proposals/:id/apply', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const proposal = await getProposalForUser(db, user.id, req.params.id);
    if (!proposal) return res.status(404).json({ error: '提案不存在' });
    if (proposal.status !== 'pending') return res.status(409).json({ error: `该提案当前状态为 ${proposal.status}，不能重复应用` });
    if (isExpired(proposal.expires_at)) {
      await db.execute("UPDATE agent_proposals SET status='expired',updated_at=UTC_TIMESTAMP(3) WHERE id=?", [proposal.id]);
      return res.status(409).json({ error: '该提案已过期，请重新生成建议' });
    }
    const changes = parseJson(proposal.changes_json, null);
    const change = assertProposalChanges(proposal.proposal_type, changes);
    validateAgentPlan(proposal.proposal_type, change.data);
    const targetPlan = await getPlanState(db, user.id, proposal.proposal_type);
    if (Number(proposal.base_revision || 0) !== targetPlan.revision) {
      return res.status(409).json({ error: '计划已在生成建议后发生变化，请重新生成或手动合并', currentRevision: targetPlan.revision });
    }
    const previousState = await getPlansState(db, user.id);
    const appliedPlan = await db.transaction(async (tx) => {
      // Lock the proposal row before applying it so a double-click or parallel
      // client request cannot turn one proposal into two plan revisions.
      const locked = await tx.one('SELECT * FROM agent_proposals WHERE id=? AND user_id=? FOR UPDATE', [proposal.id, user.id]);
      if (!locked || locked.status !== 'pending') {
        const error = new Error('该提案已被处理，请刷新后重试');
        error.status = 409;
        throw error;
      }
      const plan = await replacePlan(tx, user.id, locked.proposal_type, change.data, Number(locked.base_revision || 0));
      await tx.execute(`UPDATE agent_proposals
        SET status='applied',previous_state_json=?,applied_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
        WHERE id=?`, [JSON.stringify(previousState), locked.id]);
      return plan;
    });
    return res.json({ status: 'applied', planType: proposal.proposal_type, plan: appliedPlan, currentState: await getCurrentPlans(db, user.id) });
  } catch (error) { return next(error); }
});

router.post('/proposals/:id/reject', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    const proposal = await getProposalForUser(db, user.id, req.params.id);
    if (!proposal) return res.status(404).json({ error: '提案不存在' });
    if (proposal.status !== 'pending') return res.status(409).json({ error: `该提案当前状态为 ${proposal.status}，不能拒绝` });
    await db.execute("UPDATE agent_proposals SET status='rejected',updated_at=UTC_TIMESTAMP(3) WHERE id=?", [proposal.id]);
    return res.json({ status: 'rejected' });
  } catch (error) { return next(error); }
});

export function agentErrorHandler(error, _req, res, _next) {
  if (error instanceof AgentServiceError) return res.status(502).json({ error: error.message, code: error.code });
  if (error.status) return res.status(error.status).json({ error: error.message || '请求参数不合法' });
  return res.status(500).json({ error: '服务器内部错误' });
}

export default router;
