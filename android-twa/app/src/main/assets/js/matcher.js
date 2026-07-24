/**
 * 匹配引擎
 * 根据用户输入（分数、学位、门类、分区）匹配院校并排序
 */

/**
 * 核心匹配函数
 * @param {number} score - 用户考研总分
 * @param {string} degree - 'xueshuo' | 'zhuanshuo'
 * @param {string} category - 学科门类名
 * @param {string} zone - 'A' | 'B' | 'all'
 * @returns {object} { passed: bool, nationalLine: {...}, results: [...] }
 */
function matchUniversities(score, degree, category, zone) {
  // 1. 查国家线
  const nlInfo = getLatestNationalLine(degree, category, zone === 'all' ? 'A' : zone);
  const allNL = getAllYearLines(degree, category, zone === 'all' ? 'A' : zone);

  // 2. 获取该分区院校
  let universities = getUniversitiesByZone(zone);

  // 3. 对每个院校计算匹配度
  const results = [];
  for (const uni of universities) {
    const admissionScores = getAdmissionScores(uni.name, category, degree);
    const matchResult = evaluateMatch(score, admissionScores, uni.level);

    if (matchResult) {
      results.push({
        university: uni,
        admissionScores: admissionScores,
        verdict: matchResult.verdict,
        verdictLabel: matchResult.label,
        verdictClass: matchResult.cssClass,
        avgScore: matchResult.avgScore,
        maxScore: matchResult.maxScore,
        minScore: matchResult.minScore
      });
    }
  }

  // 4. 排序: 默认按院校层次 + 匹配度
  results.sort((a, b) => {
    // 先按 verdict 分组排序
    const verdictOrder = { 'safe': 0, 'likely': 1, 'reach': 2, 'unmatched': 3, 'nodata': 4 };
    const va = verdictOrder[a.verdict] ?? 5;
    const vb = verdictOrder[b.verdict] ?? 5;
    if (va !== vb) return va - vb;

    // 同组内按院校层次
    const levelOrder = { '985': 0, '211': 1, '双一流': 2, '双非': 3 };
    const la = levelOrder[a.university.level] ?? 4;
    const lb = levelOrder[b.university.level] ?? 4;
    if (la !== lb) return la - lb;

    // 同层次按平均录取分降序
    return (b.avgScore || 0) - (a.avgScore || 0);
  });

  return {
    passed: nlInfo ? score >= nlInfo.score : null,
    nationalLine: nlInfo,
    nationalLinesAll: allNL,
    results,
    totalMatched: results.filter(r => r.verdict !== 'unmatched' && r.verdict !== 'nodata').length,
    totalShown: results.length
  };
}

/**
 * 评估用户分数与院校录取线的匹配程度
 */
function evaluateMatch(userScore, admissionScores, level) {
  if (!admissionScores || admissionScores.length === 0) {
    return {
      verdict: 'nodata',
      label: '无数据',
      cssClass: '',
      avgScore: null,
      maxScore: null,
      minScore: null
    };
  }

  const scores = admissionScores.map(s => s.score).filter(s => s > 0);
  if (scores.length === 0) {
    return {
      verdict: 'nodata',
      label: '无数据',
      cssClass: '',
      avgScore: null,
      maxScore: null,
      minScore: null
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
      avgScore, maxScore, minScore
    };
  } else if (userScore >= maxScore) {
    return {
      verdict: 'likely',
      label: '大概率',
      cssClass: 'verdict-likely',
      avgScore, maxScore, minScore
    };
  } else if (userScore >= minScore) {
    return {
      verdict: 'reach',
      label: '冲刺',
      cssClass: 'verdict-reach',
      avgScore, maxScore, minScore
    };
  } else {
    return {
      verdict: 'unmatched',
      label: '差距较大',
      cssClass: 'verdict-fail',
      avgScore, maxScore, minScore
    };
  }
}

/**
 * 按不同维度排序
 */
function sortResults(results, sortType) {
  switch (sortType) {
    case 'level':
      const levelOrder = { '985': 0, '211': 1, '双一流': 2, '双非': 3 };
      return [...results].sort((a, b) => {
        const la = levelOrder[a.university.level] ?? 4;
        const lb = levelOrder[b.university.level] ?? 4;
        return la - lb;
      });
    case 'match':
      const vOrder = { 'safe': 0, 'likely': 1, 'reach': 2, 'unmatched': 3, 'nodata': 4 };
      return [...results].sort((a, b) => {
        return (vOrder[a.verdict] ?? 5) - (vOrder[b.verdict] ?? 5);
      });
    default:
      return results; // 保持默认排序
  }
}
