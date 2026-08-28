import { describe, it, expect } from 'vitest';
import {
  RECENT_EXAM_YEARS,
  PAPER_SUBJECTS,
  QUESTION_BANK,
  EXAM_PAPERS,
  RECENT_TOTAL,
  BANK_TOTAL,
  getPaper,
  getPaperMeta,
  isObjective,
} from './exam-papers.js';

const ALL_QUESTIONS = Object.values(QUESTION_BANK).flat();

describe('近三年分卷', () => {
  it('覆盖 3 个年份 × 3 个科目', () => {
    expect(RECENT_EXAM_YEARS).toHaveLength(3);
    expect(EXAM_PAPERS).toHaveLength(RECENT_EXAM_YEARS.length * PAPER_SUBJECTS.length);
  });

  it('每张卷都有题，不存在空卷', () => {
    EXAM_PAPERS.forEach((paper) => {
      expect(paper.count, `${paper.year} ${paper.subject} 无试题`).toBeGreaterThan(0);
    });
  });

  it('分卷题目全部属于该年份该科目', () => {
    RECENT_EXAM_YEARS.forEach((year) => {
      PAPER_SUBJECTS.forEach(({ id }) => {
        getPaper(year, id).forEach((q) => {
          expect(String(q.year)).toBe(year);
          expect(QUESTION_BANK[id]).toContain(q);
        });
      });
    });
  });

  it('题序稳定：重复取卷结果一致', () => {
    const a = getPaper('2024', 'math').map(q => q.id);
    const b = getPaper('2024', 'math').map(q => q.id);
    expect(a).toEqual(b);
  });

  it('近三年题量小于题库总量（其余年份留给专项练习）', () => {
    expect(RECENT_TOTAL).toBeLessThan(BANK_TOTAL);
    expect(RECENT_TOTAL).toBe(EXAM_PAPERS.reduce((s, p) => s + p.count, 0));
  });

  it('未收录的年份取不到卷', () => {
    expect(getPaper('2019', 'math')).toEqual([]);
    expect(getPaperMeta('2019', 'math').count).toBe(0);
  });
});

describe('解析覆盖', () => {
  it('近三年每道真题都有非空解析', () => {
    RECENT_EXAM_YEARS.forEach((year) => {
      PAPER_SUBJECTS.forEach(({ id }) => {
        getPaper(year, id).forEach((q) => {
          expect(typeof q.solution, `${q.id} 解析类型错误`).toBe('string');
          expect(q.solution.trim().length, `${q.id} 缺少解析`).toBeGreaterThan(0);
        });
      });
    });
  });

  it('整个题库也没有缺解析的题', () => {
    const missing = ALL_QUESTIONS.filter(q => !q.solution || !String(q.solution).trim());
    expect(missing.map(q => q.id)).toEqual([]);
  });
});

describe('题目结构', () => {
  it('题目 id 全局唯一', () => {
    const ids = ALL_QUESTIONS.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('客观题的正确答案落在选项范围内', () => {
    const LABELS = 'ABCDEF';
    ALL_QUESTIONS.filter(isObjective).forEach((q) => {
      const answer = String(q.answer).trim().toUpperCase();
      // 多选题答案可能是 "AB" 之类的组合
      answer.split('').forEach((letter) => {
        const idx = LABELS.indexOf(letter);
        expect(idx, `${q.id} 答案 ${answer} 非法`).toBeGreaterThanOrEqual(0);
        expect(idx, `${q.id} 答案 ${answer} 超出 ${q.options.length} 个选项`).toBeLessThan(q.options.length);
      });
    });
  });

  it('主观题不带选项，由「查看解析」流程兜底', () => {
    ALL_QUESTIONS.filter(q => !isObjective(q)).forEach((q) => {
      expect(q.options == null || q.options.length === 0, `${q.id} 被判为主观题却带选项`).toBe(true);
    });
  });

  it('每张卷的客观题数量不超过总题数', () => {
    EXAM_PAPERS.forEach((paper) => {
      expect(paper.objectiveCount).toBeLessThanOrEqual(paper.count);
    });
  });
});
