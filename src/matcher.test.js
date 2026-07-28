import { describe, it, expect, vi } from 'vitest';

vi.mock('./data/national-lines.js', () => ({
  getAllYearLines: vi.fn(() => [
    { year: '2025', score: 320 },
    { year: '2024', score: 315 },
    { year: '2023', score: 310 },
    { year: '2022', score: 305 },
  ]),
}));

vi.mock('./data/universities.js', () => ({
  getUniversitiesByZone: vi.fn(() => [
    { name: '北京大学', province: '北京', city: '北京', level: '985', zone: 'A' },
    { name: '清华大学', province: '北京', city: '北京', level: '985', zone: 'A' },
    { name: '普通大学', province: '广东', city: '广州', level: '双非', zone: 'A' },
  ]),
}));

vi.mock('./data/admission-scores.js', () => ({
  getAdmissionScores: vi.fn((name) => {
    if (name === '北京大学') {
      return [
        { year: '2025', score: 370 },
        { year: '2024', score: 365 },
        { year: '2023', score: 360 },
        { year: '2022', score: 355 },
      ];
    }
    if (name === '清华大学') {
      return [];
    }
    return null;
  }),
}));

import { evaluateMatch, sortResults, matchUniversities } from './matcher.js';

// ==================== evaluateMatch ====================
describe('evaluateMatch', () => {
  it('无数据时返回 nodata', () => {
    expect(evaluateMatch(350, null)).toEqual({
      verdict: 'nodata',
      label: '无数据',
      cssClass: '',
      avgScore: null,
      maxScore: null,
      minScore: null,
    });
  });

  it('空数组时返回 nodata', () => {
    expect(evaluateMatch(350, [])).toEqual({
      verdict: 'nodata',
      label: '无数据',
      cssClass: '',
      avgScore: null,
      maxScore: null,
      minScore: null,
    });
  });

  it('分数 >= 最高分+10 → 稳过', () => {
    const scores = [{ score: 340 }, { score: 360 }];
    const result = evaluateMatch(370, scores);
    expect(result.verdict).toBe('safe');
    expect(result.label).toBe('稳过');
    expect(result.cssClass).toBe('verdict-safe');
  });

  it('分数 >= 最高分 → 大概率', () => {
    const scores = [{ score: 340 }, { score: 360 }];
    const result = evaluateMatch(360, scores);
    expect(result.verdict).toBe('likely');
    expect(result.label).toBe('大概率');
  });

  it('分数 >= 最低分 → 冲刺', () => {
    const scores = [{ score: 340 }, { score: 360 }];
    const result = evaluateMatch(350, scores);
    expect(result.verdict).toBe('reach');
    expect(result.label).toBe('冲刺');
  });

  it('分数 < 最低分 → 差距较大', () => {
    const scores = [{ score: 340 }, { score: 360 }];
    const result = evaluateMatch(300, scores);
    expect(result.verdict).toBe('unmatched');
    expect(result.label).toBe('差距较大');
  });

  it('过滤掉 0 分', () => {
    const scores = [{ score: 0 }, { score: 360 }];
    const result = evaluateMatch(370, scores);
    expect(result.verdict).toBe('safe');
    expect(result.avgScore).toBe(360);
    expect(result.maxScore).toBe(360);
    expect(result.minScore).toBe(360);
  });

  it('正确计算均分', () => {
    const scores = [{ score: 300 }, { score: 320 }, { score: 340 }];
    const result = evaluateMatch(350, scores);
    expect(result.avgScore).toBe(320);
  });
});

// ==================== sortResults ====================
describe('sortResults', () => {
  const mockResults = [
    { university: { level: '双非' }, verdict: 'safe' },
    { university: { level: '985' }, verdict: 'reach' },
    { university: { level: '211' }, verdict: 'likely' },
    { university: { level: '双一流' }, verdict: 'safe' },
  ];

  it('按学校层次排序', () => {
    const sorted = sortResults(mockResults, 'level');
    expect(sorted.map((r) => r.university.level)).toEqual(['985', '211', '双一流', '双非']);
  });

  it('按匹配度排序', () => {
    const sorted = sortResults(mockResults, 'match');
    expect(sorted.map((r) => r.verdict)).toEqual(['safe', 'safe', 'likely', 'reach']);
  });

  it('未知排序类型返回原数组', () => {
    const sorted = sortResults(mockResults, 'unknown');
    expect(sorted).toBe(mockResults);
  });

  it('不修改原数组', () => {
    const original = mockResults.map((r) => ({ ...r }));
    sortResults(mockResults, 'level');
    expect(mockResults).toEqual(original);
  });
});

// ==================== matchUniversities ====================
describe('matchUniversities', () => {
  it('返回正确结构', () => {
    const result = matchUniversities(350, 'xueshuo', '工学', 'A', null);
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('nationalLine');
    expect(result).toHaveProperty('nationalLinesAll');
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('totalMatched');
    expect(result).toHaveProperty('totalShown');
  });

  it('分数 >= 国家线时 passed=true', () => {
    const result = matchUniversities(350, 'xueshuo', '工学', 'A', null);
    expect(result.passed).toBe(true);
  });

  it('分数 < 国家线时 passed=false', () => {
    const result = matchUniversities(300, 'xueshuo', '工学', 'A', null);
    expect(result.passed).toBe(false);
  });

  it('有录取数据的院校正确匹配', () => {
    const result = matchUniversities(380, 'xueshuo', '工学', 'A', null);
    const beida = result.results.find((r) => r.university.name === '北京大学');
    expect(beida).toBeDefined();
    expect(beida.verdict).toBe('safe');
  });

  it('无录取数据的院校标记为 nodata', () => {
    const result = matchUniversities(380, 'xueshuo', '工学', 'A', null);
    const tsinghua = result.results.find((r) => r.university.name === '清华大学');
    expect(tsinghua).toBeDefined();
    expect(tsinghua.verdict).toBe('nodata');
  });

  it('返回的院校数量正确（无数据院校被过滤）', () => {
    const result = matchUniversities(350, 'xueshuo', '工学', 'A', null);
    expect(result.totalShown).toBe(2); // 普通大学(null)被过滤，清华([])保留
  });
});
