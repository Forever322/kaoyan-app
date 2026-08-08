const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const AGENT_USER_ID_KEY = 'agent_user_id';

export class AgentApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = 'AgentApiError';
    this.status = status;
    this.payload = payload;
  }
}

export function setAgentUserId(userId) {
  const value = Number(userId);
  if (!Number.isInteger(value) || value <= 0) throw new Error('Agent 用户 ID 必须为正整数');
  localStorage.setItem(AGENT_USER_ID_KEY, String(value));
}

export function getAgentUserId() {
  const value = Number(localStorage.getItem(AGENT_USER_ID_KEY));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function clearAgentUserId() {
  localStorage.removeItem(AGENT_USER_ID_KEY);
}

async function agentRequest(path, { method = 'GET', body } = {}) {
  const userId = getAgentUserId();
  if (!userId) throw new AgentApiError('尚未设置 Agent 用户身份，请先登录或配置用户 ID', 401);

  const response = await fetch(`${API_BASE}/api/agents${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(userId),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new AgentApiError(payload?.error || 'Agent 服务请求失败', response.status, payload);
  return payload;
}

/**
 * 生成待确认提案。该调用不会修改院校方案或学习计划。
 * @param {{proposalType: 'admission'|'study', question?: string, context?: object}} input
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
  if (!getAgentUserId()) return false;
  try {
    await listAgentProposals();
    return true;
  } catch {
    return false;
  }
}
