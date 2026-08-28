/**
 * 历年真题分卷索引
 *
 * 题目原文仍保存在 exam-data.js 的三个科目题库里，这里只做按年份切分，
 * 不复制题目内容。历年真题页按「年份 → 科目」取卷，专项练习页取完整题库。
 */
import {
  SAMPLE_MATH_QUESTIONS,
  SAMPLE_POLITICS_QUESTIONS,
  SAMPLE_ENGLISH_QUESTIONS,
} from './exam-data.js';

/** 历年真题页展示的年份，由新到旧 */
export const RECENT_EXAM_YEARS = ['2025', '2024', '2023'];

/** 完整题库（全部年份），专项练习使用 */
export const QUESTION_BANK = {
  math: SAMPLE_MATH_QUESTIONS,
  politics: SAMPLE_POLITICS_QUESTIONS,
  english: SAMPLE_ENGLISH_QUESTIONS,
};

export const PAPER_SUBJECTS = [
  { id: 'math', name: '数学', icon: '∑' },
  { id: 'politics', name: '政治', icon: '政' },
  { id: 'english', name: '英语', icon: 'A' },
];

/** 客观题题型：可判分、可即时出解析 */
const OBJECTIVE_TYPES = new Set(['选择', '单选', '多选', '阅读', '完形', '新题型']);

export function isObjective(question) {
  return OBJECTIVE_TYPES.has(question.type) && Array.isArray(question.options) && question.options.length > 0;
}

// year -> subject -> 题目数组，模块加载时构建一次
const PAPER_INDEX = (() => {
  const index = {};
  RECENT_EXAM_YEARS.forEach((year) => {
    index[year] = {};
    Object.entries(QUESTION_BANK).forEach(([subject, bank]) => {
      // 同年同科按 id 排序，保证每次进卷题序稳定
      index[year][subject] = bank
        .filter((q) => String(q.year) === year)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    });
  });
  return index;
})();

/** 取某年某科的整卷题目 */
export function getPaper(year, subject) {
  return PAPER_INDEX[year]?.[subject] || [];
}

/** 卷面概览：题量与题型分布，用于卷卡片 */
export function getPaperMeta(year, subject) {
  const questions = getPaper(year, subject);
  const byType = {};
  questions.forEach((q) => {
    byType[q.type] = (byType[q.type] || 0) + 1;
  });
  return {
    year,
    subject,
    count: questions.length,
    objectiveCount: questions.filter(isObjective).length,
    byType,
  };
}

/** 全部卷目录：3 年 × 3 科 */
export const EXAM_PAPERS = RECENT_EXAM_YEARS.flatMap((year) =>
  PAPER_SUBJECTS.map((s) => getPaperMeta(year, s.id)),
);

/** 近三年真题总量，用于入口副标题 */
export const RECENT_TOTAL = EXAM_PAPERS.reduce((sum, p) => sum + p.count, 0);

/** 完整题库总量 */
export const BANK_TOTAL = Object.values(QUESTION_BANK).reduce((sum, b) => sum + b.length, 0);
