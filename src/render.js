//渲染模块：结果列表、国家线卡片、院校卡片

import { ADMISSION_SCORES, mapCategoryToScoreKey } from './data/admission-scores.js';
import { getAllYearLines, hasSubMajors } from './data/national-lines.js';
import { escapeHtml } from './utils.js';

/** 构建分数对比表格行（结果卡片和详情页共用） */
export function buildScoreTableRows(
  admissionScores,
  nationalLines,
  userScore,
  { showDiff = false } = {},
) {
  const scoreMap = {};
  if (admissionScores) admissionScores.forEach((s) => (scoreMap[s.year] = s.score));

  const nlMap = {};
  if (nationalLines) nationalLines.forEach((n) => (nlMap[n.year] = n.score));

  const years = ['2025', '2024', '2023', '2022'];
  let rows = '';

  for (const y of years) {
    const nl = nlMap[y];
    const ul = scoreMap[y];
    if (!nl && !ul) continue;

    const refScore = ul || nl;
    const ok = userScore >= refScore;

    let resultCell;
    if (showDiff && userScore > 0) {
      const diff = userScore - refScore;
      resultCell = diff >= 0 ? `✅ +${diff}` : `❌ ${diff}`;
    } else {
      resultCell = ok ? '✅' : '❌';
    }

    rows += `<tr>
      <td>${y}年</td>
      <td class="td-nl">${nl || '-'}</td>
      <td class="td-ul">${ul || '-'}</td>
      <td class="td-you">${userScore || '-'}</td>
      <td class="${ok ? 'td-ok' : 'td-fail'}">${userScore > 0 ? resultCell : '-'}</td>
    </tr>`;
  }
  return rows;
}

/** 渲染国家线卡片 */
export function renderNationalLine(result, { userScore, category, degree, zone }) {
  const card = document.getElementById('nationalLineCard');
  const info = document.getElementById('nationalLineInfo');

  if (!result.nationalLine || result.nationalLinesAll.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  const allLines = result.nationalLinesAll;

  info.innerHTML = `
    <p class="nl-title"> ${degree === 'xueshuo' ? '学硕' : '专硕'} · ${escapeHtml(category)} · ${escapeHtml(zone)}区</p>
    <div class="nl-table-wrap">
      <table class="nl-table">
        <thead><tr>
          <th>年份</th>${allLines.map((l) => `<th>${l.year}年</th>`).join('')}
        </tr></thead>
        <tbody><tr>
          <td><strong>国家线</strong></td>
          ${allLines
            .map(
              (l) => `
            <td><span class="nl-val ${userScore >= l.score ? 'nl-above' : 'nl-below'}">${l.score}</span>
            <div class="nl-diff">${userScore >= l.score ? '✅' : '❌'}</div></td>
          `,
            )
            .join('')}
        </tr></tbody>
      </table>
    </div>
    <p class="nl-note">💡 你的分数: <strong>${userScore}</strong> | 差值: ${allLines.map((l) => `${l.year}年 ${userScore >= l.score ? '+' : ''}${userScore - l.score}`).join(' / ')}</p>
  `;
}

/** 渲染搜索结果列表 */
export function renderResults(results, { degree, zone }) {
  const list = document.getElementById('resultsList');
  const count = document.getElementById('resultCount');
  const section = document.getElementById('resultsSection');

  if (!results || results.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  count.textContent = `共${results.length}所`;

  const userScore = parseInt(document.getElementById('scoreInput').value, 10);
  const category = document.getElementById('categorySelect').value;
  const allNL = getAllYearLines(degree, category, zone === 'all' ? 'A' : zone);

  list.innerHTML = results
    .map((r, i) => renderResultCard(r, userScore, allNL, i, { degree, category }))
    .join('');
}

/** 渲染单张院校卡片 */
function renderResultCard(result, userScore, nationalLines, index, { degree, category }) {
  const { university: uni, verdict, verdictLabel, verdictClass, admissionScores } = result;

  const levelBadgeClass = `level-${uni.level === '985' ? '985' : uni.level === '211' ? '211' : uni.level === '双一流' ? 'l1' : 'normal'}`;

  const uniData = ADMISSION_SCORES[uni.name];
  const majorEl = document.getElementById('majorSelect');
  const major = hasSubMajors(category) && majorEl.style.display !== 'none' ? majorEl.value : null;
  const key = mapCategoryToScoreKey(category, degree, major);
  const isRealData = uniData && uniData[key];

  const tableRows = buildScoreTableRows(admissionScores, nationalLines, userScore);

  const majorText = major && major !== '不限专业' ? ` · ${major.replace(/\([^)]*\)/g, '')}` : '';
  const dataTag = isRealData ? '' : '<span class="estimated-tag">预估值</span>';

  return `
    <div class="result-card ${verdict}" data-index="${index}">
      <div class="uni-name">
        <span class="name-text">🏫 ${escapeHtml(uni.name)}</span>
        <span class="level-badge ${levelBadgeClass}">${escapeHtml(uni.level)}</span>
        ${dataTag}
      </div>
      <div class="uni-meta">
        <span>📍 ${escapeHtml(uni.province)}${uni.city && uni.city !== uni.province ? ' · ' + escapeHtml(uni.city) : ''}</span>
        <span>🏷️ ${escapeHtml(uni.zone)}区</span>${majorText ? `<span>🔧 ${escapeHtml(majorText)}</span>` : ''}
      </div>
      <div class="score-table-wrap">
        <table class="score-table">
          <thead><tr>
            <th>年份</th><th>国家线</th><th>院校线</th><th>你的分</th><th>结果</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div class="uni-verdict">
        <span class="${verdictClass}">${verdict === 'safe' ? '✅' : verdict === 'likely' ? '👍' : verdict === 'reach' ? '🎯' : verdict === 'nodata' ? '📋' : '⚠️'} ${escapeHtml(verdictLabel)}${result.avgScore ? ` · 近4年均分 ${result.avgScore}` : ''}</span>
      </div>
    </div>
  `;
}
