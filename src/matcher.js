// 匹配引擎：根据分数、学位、门类、专业、分区匹配院校并排序

import { getAllYearLines } from './data/national-lines.js';
import { getUniversitiesByZone } from './data/universities.js';
import { getAdmissionScores } from './data/admission-scores.js';

export function matchUniversities(score, degree, category, zone, major) {
  // 1. 查国家线
  const allNL = getAllYearLines(degree, category, zone === 'all' ? 'A' : zone);

  // 2. 获取该分区院校
  const universities = getUniversitiesByZone(zone);

  // 3. 对每个院校计算匹配度
  const results = [];
  for (const uni of universities) {
    const admissionScores = getAdmissionScores(uni.name, category, degree, major);
    const matchResult = evaluateMatch(score, admissionScores);

    if (matchResult) {
      results.push({
        university: uni,
        admissionScores: admissionScores,
        verdict: matchResult.verdict,
        verdictLabel: matchResult.label,
        verdictClass: matchResult.cssClass,
        avgScore: matchResult.avgScore,
        maxScore: matchResult.maxScore,
        minScore: matchResult.minScore,
      });
    }
  }

  // 4. 排序: 先 match level, 再学校层次
  results.sort((a, b) => {
    const verdictOrder = { safe: 0, likely: 1, reach: 2, unmatched: 3, nodata: 4 };
    const va = verdictOrder[a.verdict] ?? 5;
    const vb = verdictOrder[b.verdict] ?? 5;
    if (va !== vb) return va - vb;

    const levelOrder = { 985: 0, 211: 1, 双一流: 2, 双非: 3 };
    const la = levelOrder[a.university.level] ?? 4;
    const lb = levelOrder[b.university.level] ?? 4;
    if (la !== lb) return la - lb;

    return (b.avgScore || 0) - (a.avgScore || 0);
  });

  // 5. 最新国家线
  const latestNL = allNL.length > 0 ? allNL[0] : null;
  const passed = latestNL ? score >= latestNL.score : null;

  return {
    passed,
    nationalLine: latestNL,
    nationalLinesAll: allNL,
    results,
    totalMatched: results.filter((r) => r.verdict !== 'unmatched' && r.verdict !== 'nodata').length,
    totalShown: results.length,
  };
}

export function evaluateMatch(userScore, admissionScores) {
  if (!admissionScores || admissionScores.length === 0) {
    return {
      verdict: 'nodata',
      label: '无数据',
      cssClass: '',
      avgScore: null,
      maxScore: null,
      minScore: null,
    };
  }

  const scores = admissionScores.map((s) => s.score).filter((s) => s > 0);
  if (scores.length === 0) {
    return {
      verdict: 'nodata',
      label: '无数据',
      cssClass: '',
      avgScore: null,
      maxScore: null,
      minScore: null,
    };
  }

  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  if (userScore >= maxScore + 10) {
    return {
      verdict: 'safe',
      label: '稳过',
      cssClass: 'verdict-safe',
      avgScore,
      maxScore,
      minScore,
    };
  } else if (userScore >= maxScore) {
    return {
      verdict: 'likely',
      label: '大概率',
      cssClass: 'verdict-likely',
      avgScore,
      maxScore,
      minScore,
    };
  } else if (userScore >= minScore) {
    return {
      verdict: 'reach',
      label: '冲刺',
      cssClass: 'verdict-reach',
      avgScore,
      maxScore,
      minScore,
    };
  } else {
    return {
      verdict: 'unmatched',
      label: '差距较大',
      cssClass: 'verdict-fail',
      avgScore,
      maxScore,
      minScore,
    };
  }
}

export function sortResults(results, sortType) {
  switch (sortType) {
    case 'level': {
      const levelOrder = { 985: 0, 211: 1, 双一流: 2, 双非: 3 };
      return [...results].sort((a, b) => {
        const la = levelOrder[a.university.level] ?? 4;
        const lb = levelOrder[b.university.level] ?? 4;
        return la - lb;
      });
    }
    case 'match': {
      const vOrder = { safe: 0, likely: 1, reach: 2, unmatched: 3, nodata: 4 };
      return [...results].sort((a, b) => {
        return (vOrder[a.verdict] ?? 5) - (vOrder[b.verdict] ?? 5);
      });
    }
    default:
      return results;
  }
}
