import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentServiceError, validateProposalPayload } from './agent-service.js';

test('学习计划提案只接受一个 replace_study_plan 操作', () => {
  const proposal = validateProposalPayload('study', {
    summary: '下周先完成极限专项。',
    rationale: '数学学习时长不足。',
    changes: [{ operation: 'replace_study_plan', data: { items: [{ subject: '数学' }] } }],
  });

  assert.equal(proposal.changes.length, 1);
  assert.equal(proposal.changes[0].operation, 'replace_study_plan');
});

test('学习计划提案不能借模型输出修改报考方案', () => {
  assert.throws(() => validateProposalPayload('study', {
    summary: '不安全的提案',
    changes: [{ operation: 'replace_admission_plan', data: { school: '示例大学' } }],
  }), (error) => error instanceof AgentServiceError && error.code === 'invalid_model_operation');
});

test('多项变更不会被静默截断为第一项', () => {
  assert.throws(() => validateProposalPayload('admission', {
    summary: '不安全的提案',
    changes: [
      { operation: 'replace_admission_plan', data: { school: '示例大学' } },
      { operation: 'replace_study_plan', data: { items: [] } },
    ],
  }), (error) => error instanceof AgentServiceError && error.code === 'invalid_model_response');
});

