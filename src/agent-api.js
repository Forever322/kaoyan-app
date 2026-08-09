import { ApiError, apiRequest, getAccessToken } from './auth-api.js';

export class AgentApiError extends ApiError {
  constructor(message, status = 0, payload = null) {
    super(message, status, payload);
    this.name = 'AgentApiError';
  }
}

async function agentRequest(path, { method = 'GET', body } = {}) {
  try {
    return await apiRequest(`/api/agents${path}`, { method, body, requiresAuth: true });
  } catch (error) {
    if (error instanceof AgentApiError) throw error;
    if (error instanceof ApiError) throw new AgentApiError(error.message, error.status, error.payload);
    throw new AgentApiError('Agent 服务请求失败，请稍后重试', 0, null);
  }
}

function pathId(value, label) {
  const id = String(value ?? '').trim();
  if (!id) throw new AgentApiError(`${label}不能为空`, 400);
  return encodeURIComponent(id);
}

/** 返回后端根据当前登录用户数据构建的 Agent 上下文。 */
export function getAgentContext() {
  return agentRequest('/context');
}

/** 返回当前用户最近的 Agent 对话列表。 */
export function listAgentConversations() {
  return agentRequest('/conversations');
}

/**
 * 创建一个持久化对话。
 * @param {{agentType?: string, title?: string, context?: object}} input
 */
export function createAgentConversation(input = {}) {
  return agentRequest('/conversations', { method: 'POST', body: input });
}

/** 返回一个对话及其已持久化消息。 */
export function getAgentConversation(conversationId) {
  return agentRequest(`/conversations/${pathId(conversationId, '会话 ID')}`);
}

/**
 * 向一个对话发送消息并等待模型回复。
 * 第二个参数可直接传文本，也可传 { message }，便于页面逐步接入。
 */
export function sendAgentConversationMessage(conversationId, input) {
  const message = typeof input === 'string' ? input : input?.message;
  if (!String(message || '').trim()) throw new AgentApiError('请输入要发送的消息', 400);
  return agentRequest(`/conversations/${pathId(conversationId, '会话 ID')}/messages`, {
    method: 'POST',
    body: { message: String(message).trim() },
  });
}

/** 删除当前用户的一个对话及其消息。 */
export function deleteAgentConversation(conversationId) {
  return agentRequest(`/conversations/${pathId(conversationId, '会话 ID')}`, { method: 'DELETE' });
}

/** 返回当前用户可用的长期记忆。 */
export function listAgentMemories() {
  return agentRequest('/memories');
}

/**
 * 保存用户明确确认的长期记忆。
 * @param {{memoryType: 'preference'|'goal'|'study-state'|'admission-state'|'feedback', content: string, metadata?: object, expiresAt?: string|null}} input
 */
export function createAgentMemory(input) {
  if (!String(input?.content || '').trim()) throw new AgentApiError('记忆内容不能为空', 400);
  return agentRequest('/memories', { method: 'POST', body: input });
}

/** 删除当前用户的一条长期记忆。 */
export function deleteAgentMemory(memoryId) {
  return agentRequest(`/memories/${pathId(memoryId, '记忆 ID')}`, { method: 'DELETE' });
}

/**
 * 生成待确认提案。该调用不会修改院校方案或学习计划。
 * @param {{proposalType: 'admission'|'study', agentType?: 'study-assistant'|'kaoyan-coach', question?: string, context?: object}} input
 */
export function createAgentProposal(input) {
  if (!['admission', 'study'].includes(input?.proposalType)) {
    throw new AgentApiError('proposalType 必须为 admission 或 study', 400);
  }
  return agentRequest('/proposals', { method: 'POST', body: input });
}

export function listAgentProposals() {
  return agentRequest('/proposals');
}

/** 用户确认后才会将对应提案写入后端的院校/学习计划。 */
export function applyAgentProposal(proposalId) {
  return agentRequest(`/proposals/${encodeURIComponent(proposalId)}/apply`, { method: 'POST' });
}

export function rejectAgentProposal(proposalId) {
  return agentRequest(`/proposals/${encodeURIComponent(proposalId)}/reject`, { method: 'POST' });
}

export async function isAgentApiAvailable() {
  if (!getAccessToken()) return false;
  try {
    await listAgentProposals();
    return true;
  } catch {
    return false;
  }
}
