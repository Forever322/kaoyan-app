import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAgentCapabilityEnabled, enabledForRollout } from './agent-runtime-policy.js';

test('智能体运行策略在配置或功能开关关闭时拒绝模型调用', async () => {
  const disabledConfigDb = { one: async () => ({ enabled: 0 }) };
  await assert.rejects(
    assertAgentCapabilityEnabled(disabledConfigDb, { userId: 1, agentType: 'study-assistant', capability: 'chat' }),
    (error) => error.status === 403 && error.code === 'agent_disabled',
  );

  const disabledFlagDb = {
    one: async (sql, [key]) => (sql.includes('agent_configurations')
      ? { enabled: 1 }
      : key === 'agent-kaoyan-coach' ? { enabled: 0, rollout_percentage: 100 } : { enabled: 1, rollout_percentage: 100 }),
  };
  await assert.rejects(
    assertAgentCapabilityEnabled(disabledFlagDb, { userId: 1, agentType: 'kaoyan-coach', capability: 'chat' }),
    (error) => error.status === 403 && error.code === 'agent_feature_disabled',
  );
});

test('灰度桶对同一用户稳定，百分比边界正确', () => {
  assert.equal(enabledForRollout('agent-kaoyan-coach', 0, 1), false);
  assert.equal(enabledForRollout('agent-kaoyan-coach', 100, 1), true);
  assert.equal(
    enabledForRollout('agent-kaoyan-coach', 37, 123456),
    enabledForRollout('agent-kaoyan-coach', 37, 123456),
  );
});
