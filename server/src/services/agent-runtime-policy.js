import { createHash } from 'node:crypto';

function policyError(message, code) {
  const error = new Error(message);
  error.status = 403;
  error.code = code;
  return error;
}

function enabled(value) {
  return value === true || Number(value) === 1;
}

function enabledForRollout(key, rolloutPercentage, userId) {
  const percentage = Math.max(0, Math.min(100, Number(rolloutPercentage ?? 100)));
  if (percentage >= 100) return true;
  if (percentage <= 0) return false;
  // Stable, non-secret rollout bucket: a user consistently sees the same
  // result without storing any extra personal data or exposing a random seed.
  const bucket = createHash('sha256').update(`${key}:${userId}`).digest().readUInt32BE(0) % 100;
  return bucket < percentage;
}

async function requireEnabledAgentConfiguration(db, agentType) {
  const configuration = await db.one('SELECT enabled FROM agent_configurations WHERE config_key=?', [agentType]);
  if (!configuration || !enabled(configuration.enabled)) {
    throw policyError('该智能体当前已被管理员暂停', 'agent_disabled');
  }
}

async function requireEnabledFeatureFlag(db, key, userId) {
  const flag = await db.one('SELECT enabled,rollout_percentage FROM feature_flags WHERE flag_key=?', [key]);
  if (!flag || !enabled(flag.enabled) || !enabledForRollout(key, flag.rollout_percentage, userId)) {
    throw policyError('该智能体功能当前未向你的账号开放', 'agent_feature_disabled');
  }
}

/**
 * Enforces reviewed, non-secret controls stored by the admin console. The
 * LLM provider and credentials remain environment-only. A disabled agent or
 * feature flag stops the request before any model context is built or billed.
 */
export async function assertAgentCapabilityEnabled(db, { userId, agentType, capability }) {
  await requireEnabledAgentConfiguration(db, agentType);
  if (agentType === 'kaoyan-coach') await requireEnabledFeatureFlag(db, 'agent-kaoyan-coach', userId);
  if (agentType === 'database-manager') await requireEnabledFeatureFlag(db, 'agent-database-manager', userId);
  if (capability === 'proposal') await requireEnabledFeatureFlag(db, 'agent-proposals', userId);
}

export { enabledForRollout };
