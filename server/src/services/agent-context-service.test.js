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
      if (sql.includes('user_admission_plans')) return { plan_json: '{"school":"清华大学","major":"软件工程"}', revision: 1 };
      if (sql.includes('user_study_plans')) return { plan_json: '{"items":[]}', revision: 1 };
      if (sql.includes('FROM universities u')) return {
        id: 1001,
        name: '清华大学',
        official_name: '清华大学',
        province: '北京', city: '北京', zone: 'A', level: '985', type: '综合',
        institution_code: '10003', verification_status: 'verified', catalog_status: 'active',
        source_document_id: 9, source_title: '2026 年招生专业目录', source_url: 'https://example.test/catalog',
        source_effective_year: 2026, source_verification_status: 'verified',
      };
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
      if (sql.includes('FROM programs p')) {
        return [{
          id: 501, code: '083500', name: '软件工程', degree: '学硕', category: '工学', direction: '',
          discipline_code: '0835', discipline_name: '软件工程', study_mode: '全日制', program_type: 'academic',
          status: 'active', academic_unit_id: 88, academic_unit_name: '软件学院', academic_unit_type: 'college',
          source_document_id: 9, source_title: '2026 年招生专业目录', source_url: 'https://example.test/catalog',
          source_effective_year: 2026, source_verification_status: 'verified',
        }];
      }
      if (sql.includes('FROM program_offerings po')) {
        return [{
          id: 701, program_id: 501, year: 2026, admission_type: '统考', study_mode: '全日制', enrollment_plan: 20,
          recommended_exempt_plan: 5, duration_years: '3.0', tuition_fee: '8000.00', exam_mode: '全国统考',
          verification_status: 'verified', status: 'published', source_document_id: 9,
          source_title: '2026 年招生专业目录', source_url: 'https://example.test/catalog',
          source_effective_year: 2026, source_verification_status: 'verified',
        }];
      }
      if (sql.includes('FROM exam_subjects es')) {
        return [{
          program_offering_id: 701, sequence_no: 1, subject_code: '101', subject_name: '思想政治理论',
          subject_type: 'public', is_self_proposed: 0, full_score: 100, reference_books_json: '[]', source_document_id: 9,
          source_title: '2026 年招生专业目录', source_url: 'https://example.test/catalog',
          source_effective_year: 2026, source_verification_status: 'verified',
        }];
      }
      if (sql.includes('FROM score_lines sl')) {
        return [{
          scope: 'program', year: 2025, university_id: 1001, program_id: 501, degree: '学硕', category: '工学',
          candidate_type: '普通考生', total_score: 350, politics_line: 50, foreign_language_line: 50,
          business_1_line: 70, business_2_line: 70, verification_status: 'verified', source_document_id: 10,
          source_title: '2025 年复试录取办法', source_url: 'https://example.test/retest',
          source_effective_year: 2025, source_verification_status: 'verified',
        }];
      }
      if (sql.includes('FROM admission_statistics ast')) {
        return [{
          program_offering_id: 701, year: 2025, statistic_scope: 'program', applicant_count: 100, admitted_count: 20,
          recommended_exempt_count: 5, enrolled_count: 18, admission_ratio: '0.2', lowest_score: 350,
          average_score: 375, highest_score: 410, verification_status: 'verified', source_document_id: 10,
          source_title: '2025 年复试录取办法', source_url: 'https://example.test/retest',
          source_effective_year: 2025, source_verification_status: 'verified',
        }];
      }
      if (sql.includes('FROM retest_rules rr')) {
        return [{
          program_offering_id: 701, year: 2026, retest_mode: '面试', initial_exam_weight: 50, retest_weight: 50,
          written_test_weight: null, interview_weight: 50, computer_test_weight: null,
          foreign_language_test_required: 1, cross_major_allowed: 1, verification_status: 'verified', source_document_id: 9,
          source_title: '2026 年招生专业目录', source_url: 'https://example.test/catalog',
          source_effective_year: 2026, source_verification_status: 'verified',
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
  assert.equal(context.catalogReference.matchedUniversity.name, '清华大学');
  assert.equal(context.catalogReference.programs[0].code, '083500');
  assert.equal(context.catalogReference.offerings[0].enrollmentPlan, 20);
  assert.equal(context.catalogReference.examSubjects[0].name, '思想政治理论');
  assert.equal(context.catalogReference.scoreLines[0].totalScore, 350);
  assert.equal(context.catalogReference.admissionStatistics[0].admissionRatio, 0.2);
  assert.equal(context.catalogReference.retestRules[0].foreignLanguageTestRequired, true);

  const favoriteQuery = calls.find((call) => call.kind === 'all' && call.sql.includes('FROM user_favorites'));
  assert.ok(favoriteQuery);
  assert.match(favoriteQuery.sql, /WHERE f\.user_id=\?/);
  assert.match(favoriteQuery.sql, /COALESCE\(u\.catalog_status,'active'\)='active'/);
  assert.deepEqual(favoriteQuery.params, [42]);
});
