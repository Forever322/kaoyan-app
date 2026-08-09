import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAgentPlan } from './plan-service.js';

test('考研教练学习提案只接受可渲染的量化任务', () => {
  const result = validateAgentPlan('study', {
    stage: '强化阶段',
    items: [{ subject: '数学', title: '极限专项', hours: '2.5h', note: '完成 20 道错题复盘' }],
  });

  assert.equal(result.plan.items.length, 1);
  assert.doesNotThrow(() => validateAgentPlan('study', {
    items: [{ subject: '英语', title: '阅读精练', duration: '1小时30分' }],
  }));
});

test('考研教练学习提案拒绝缺少时长的任务', () => {
  assert.throws(() => validateAgentPlan('study', {
    items: [{ subject: '英语', title: '阅读精练' }],
  }), (error) => error.status === 422 && /时长/u.test(error.message));
});

test('考研教练报考提案至少提供目标或候选院校', () => {
  assert.throws(() => validateAgentPlan('admission', {
    score: 365,
    category: '工学',
  }), (error) => error.status === 422 && /目标院校/u.test(error.message));

  assert.doesNotThrow(() => validateAgentPlan('admission', {
    university: '北京邮电大学',
    major: '软件工程',
    targetScore: 365,
  }));
});
