import { describe, it, expect } from 'vitest';
import {
  getCategories,
  hasSubMajors,
  getMajorsForCategory,
  getAllYearLines,
  getLatestNationalLine,
  getNationalLine,
} from './national-lines.js';

// ==================== getCategories ====================
describe('getCategories', () => {
  it('返回学硕门类列表', () => {
    const cats = getCategories('xueshuo');
    expect(cats).toContain('工学');
    expect(cats).toContain('理学');
    expect(cats).toContain('文学');
    expect(cats.length).toBeGreaterThan(5);
  });

  it('返回专硕门类列表', () => {
    const cats = getCategories('zhuanshuo');
    expect(cats.length).toBeGreaterThan(5);
  });

  it('无效学位返回空数组', () => {
    expect(getCategories('invalid')).toEqual([]);
  });
});

// ==================== hasSubMajors ====================
describe('hasSubMajors', () => {
  it('工学有子专业', () => {
    expect(hasSubMajors('工学')).toBe(true);
  });

  it('专硕组合类有子专业', () => {
    expect(hasSubMajors('电子信息/机械/材料与化工/资源与环境/能源动力/土木水利/生物与医药/交通运输')).toBe(true);
  });

  it('普通门类无子专业', () => {
    expect(hasSubMajors('理学')).toBe(false);
    expect(hasSubMajors('文学')).toBe(false);
  });
});

// ==================== getMajorsForCategory ====================
describe('getMajorsForCategory', () => {
  it('工学返回工学二级专业列表', () => {
    const majors = getMajorsForCategory('工学');
    expect(majors).toContain('不限专业');
    expect(majors).toContain('计算机科学与技术(0812)');
    expect(majors.length).toBeGreaterThan(10);
  });

  it('专硕组合类返回格式化的专业列表', () => {
    const majors = getMajorsForCategory('电子信息/机械/材料与化工/资源与环境/能源动力/土木水利/生物与医药/交通运输');
    expect(majors).toContain('不限专业');
    expect(majors.some((m) => m.includes('0854'))).toBe(true);
  });

  it('普通门类只返回不限专业', () => {
    expect(getMajorsForCategory('理学')).toEqual(['不限专业']);
    expect(getMajorsForCategory('文学')).toEqual(['不限专业']);
  });
});

// ==================== getNationalLine ====================
describe('getNationalLine', () => {
  it('获取正确的国家线', () => {
    const score = getNationalLine('xueshuo', '工学', 'A', '2025');
    expect(score).toBe(260);
  });

  it('无效门类返回 null', () => {
    expect(getNationalLine('xueshuo', '不存在的门类', 'A', '2025')).toBeNull();
  });

  it('无效分区返回 null', () => {
    expect(getNationalLine('xueshuo', '工学', 'C', '2025')).toBeNull();
  });
});

// ==================== getAllYearLines ====================
describe('getAllYearLines', () => {
  it('返回有效的年份和分数', () => {
    const lines = getAllYearLines('xueshuo', '工学', 'A');
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.year).toBeDefined();
      expect(l.score).toBeGreaterThan(0);
    }
  });

  it('过滤掉 0 分', () => {
    const lines = getAllYearLines('xueshuo', '交叉学科', 'A');
    // 2022年交叉学科为0，应被过滤
    const has2022 = lines.some((l) => l.year === '2022');
    expect(has2022).toBe(false);
  });
});

// ==================== getLatestNationalLine ====================
describe('getLatestNationalLine', () => {
  it('返回最新年份', () => {
    const latest = getLatestNationalLine('xueshuo', '工学', 'A');
    expect(latest).not.toBeNull();
    expect(latest.year).toBe('2025');
    expect(latest.score).toBe(260);
  });

  it('无效门类返回 null', () => {
    expect(getLatestNationalLine('xueshuo', '不存在', 'A')).toBeNull();
  });
});
