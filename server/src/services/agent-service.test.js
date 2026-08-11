import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentServiceError,
  getChatSystemPrompt,
  isAgentModelConfigured,
  normalizeChatAgentType,
  validateChatReplyPayload,
  validateDatabaseTableSelectionPayload,
  validateProposalPayload,
} from './agent-service.js';
import { KAOYAN_COACH_POLICY_VERSION } from './kaoyan-coach-policy.js';

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

test('考研教练使用静态、版本化的服务端策略', () => {
  const prompt = getChatSystemPrompt('kaoyan-coach');

  assert.equal(normalizeChatAgentType('kaoyan-coach'), 'kaoyan-coach');
  assert.match(prompt, new RegExp(KAOYAN_COACH_POLICY_VERSION.replaceAll('.', '\\.'), 'u'));
  assert.match(prompt, /只输出一个合法 JSON 对象/u);
  assert.match(prompt, /不能执行 SQL、调用工具、写入计划/u);
});

test('考研教练在信息不足时只接受受限的结构化追问', () => {
  const reply = validateChatReplyPayload({
    reply: '先补齐目标与时间信息，我再给你安排。',
    suggestions: ['填写目标院校'],
    canCreateProposal: false,
    needsIntake: true,
    questions: ['目标院校和专业是什么？', '计划参加哪一年的考试？', '每天平均可学习多久？'],
  }, 'kaoyan-coach');

  assert.equal(reply.needsIntake, true);
  assert.equal(reply.questions.length, 3);
  assert.equal(reply.canCreateProposal, false);
});

test('考研教练追问不能绕过提案确认边界', () => {
  assert.throws(() => validateChatReplyPayload({
    reply: '补充信息后再安排。',
    canCreateProposal: true,
    needsIntake: true,
    questions: ['目标院校？', '目标专业？', '考试年份？'],
  }, 'kaoyan-coach'), (error) => error instanceof AgentServiceError && error.code === 'invalid_model_response');
});

test('考研教练拒绝没有 needsIntake 标记的追问字段', () => {
  assert.throws(() => validateChatReplyPayload({
    reply: '先回答几个问题。',
    questions: ['目标院校？'],
  }, 'kaoyan-coach'), (error) => error instanceof AgentServiceError && error.code === 'invalid_model_response');
});

test('未知智能体类型不会降级为未审核提示词', () => {
  assert.throws(() => normalizeChatAgentType('system-admin'), (error) => (
    error instanceof AgentServiceError && error.code === 'invalid_agent_type'
  ));
});

test('后台解析出的模型凭据优先于进程环境回退', () => {
  assert.equal(isAgentModelConfigured({ apiKey: 'db-managed-key' }), true);
  assert.equal(isAgentModelConfigured({ apiKey: '' }), false);
});

test('数据库表识别结果只能选择服务器允许的表且必须有最低置信度', () => {
  const selection = validateDatabaseTableSelectionPayload({
    table: 'universities',
    confidence: 0.72,
    reason: '字段匹配 name/province/zone',
  }, ['universities', 'programs']);

  assert.equal(selection.table, 'universities');
  assert.equal(selection.confidence, 0.72);
  assert.throws(() => validateDatabaseTableSelectionPayload({
    table: 'users',
    confidence: 0.9,
  }, ['universities']), (error) => error instanceof AgentServiceError && error.code === 'invalid_model_operation');
  assert.throws(() => validateDatabaseTableSelectionPayload({
    table: 'universities',
    confidence: 0.2,
  }, ['universities']), (error) => error instanceof AgentServiceError && error.code === 'database_table_ambiguous');
});
