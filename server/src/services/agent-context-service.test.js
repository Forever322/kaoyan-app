import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentContext } from './agent-context-service.js';

test('Agent 上下文只汇总当前用户的收藏院校', async () => {
  const calls = [];
  const db = {
    one: async (sql, params = []) => {
      calls.push({ kind: 'one', sql, params });
      if (sql.includes('FROM users')) return { id: 42, username: '考生甲' };
      if (sql.includes('COALESCE(SUM(duration_s)')) return { duration_s: 7200, session_count: 2 };
      if (sql.includes('user_admission_plans')) return { plan_json: '{"school":"清华大学"}', revision: 1 };
      if (sql.includes('user_study_plans')) return { plan_json: '{"items":[]}', revision: 1 };
      throw new Error(`unexpected one query: ${sql}`);
    },
    all: async (sql, params = []) => {
      calls.push({ kind: 'all', sql, params });
      if (sql.includes('GROUP BY subject')) return [{ subject: '数学', duration_s: 7200, session_count: 2 }];
      if (sql.includes('FROM agent_memories')) return [{ memory_type: 'goal', content: '数学过线', metadata_json: '{"priority":"high"}' }];
      if (sql.includes('FROM user_favorites')) {
        return [{
          university_id: 1001,
          name: '清华大学',
          province: '北京',
          city: '北京',
          zone: 'A',
          level: '985',
          type: '综合',
          favorited_at: '2026-08-09 10:00:00.000',
        }];
      }
      throw new Error(`unexpected all query: ${sql}`);
    },
  };

  const context = await buildAgentContext(db, 42);

  assert.deepEqual(context.favoriteUniversities, [{
    universityId: 1001,
    name: '清华大学',
    province: '北京',
    city: '北京',
    zone: 'A',
    level: '985',
    type: '综合',
    favoritedAt: '2026-08-09 10:00:00.000',
  }]);
  assert.equal(context.plans.admissionPlan.school, '清华大学');

  const favoriteQuery = calls.find((call) => call.kind === 'all' && call.sql.includes('FROM user_favorites'));
  assert.ok(favoriteQuery);
  assert.match(favoriteQuery.sql, /WHERE f\.user_id=\?/);
  assert.deepEqual(favoriteQuery.params, [42]);
});
