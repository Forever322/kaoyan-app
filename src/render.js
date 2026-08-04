/**
 * 渲染模块：结果列表、国家线卡片、院校卡片
 */

import { hasSubMajors } from './data/national-lines.js';
import { escapeHtml } from './utils.js';

const RESULT_BATCH_SIZE = 16;
let resultRenderState = { results: [], options: null, shown: 0 };

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

  const years = ['2026', '2025', '2024', '2023', '2022'];
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
  const resultSummary = document.getElementById('resultsNationalLine');

  if (!result.nationalLine || result.nationalLinesAll.length === 0) {
    card.style.display = 'none';
    if (resultSummary) resultSummary.innerHTML = '';
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

  // 首页保留完整原始表格节点；结果页展示同一份国家线数据的紧凑摘要，详情页可查看逐年对比。
  if (resultSummary) {
    const latest = allLines[0];
    const latestDiff = userScore - latest.score;
    resultSummary.innerHTML = `
      <div class="results-line-title"><span>国家线参考</span><strong>${degree === 'xueshuo' ? '学硕' : '专硕'} · ${escapeHtml(category)} · ${escapeHtml(zone === 'all' ? 'A / B' : zone)} 区</strong></div>
      <div class="results-line-values"><b>${latest.year} 年 ${latest.score} 分</b><span class="${latestDiff >= 0 ? 'is-above' : 'is-below'}">${latestDiff >= 0 ? `高出 ${latestDiff} 分` : `还差 ${Math.abs(latestDiff)} 分`}</span><em>历年：${allLines.map((line) => line.score).join(' / ')}</em></div>
    `;
  }
}

/** 渲染搜索结果列表 */
export function renderResults(results, { degree, zone }) {
  const list = document.getElementById('resultsList');
  const count = document.getElementById('resultCountNumber');
  const section = document.getElementById('resultsSection');
  const context = document.getElementById('resultContext');
  const insights = document.getElementById('resultInsights');

  section.style.display = 'block';
  count.textContent = results?.length || 0;

  const userScore = parseInt(document.getElementById('scoreInput').value, 10);
  const category = document.getElementById('categorySelect').value;
  const degreeLabel = degree === 'xueshuo' ? '学硕' : '专硕';
  const zoneLabel = zone === 'all' ? 'A / B 区' : `${zone} 区`;
  const safeCount = (results || []).filter((result) => result.verdict === 'safe').length;
  const likelyCount = (results || []).filter((result) => result.verdict === 'likely').length;
  const reachCount = (results || []).filter((result) => result.verdict === 'reach').length;
  context.innerHTML = `<strong>${userScore} 分 · ${degreeLabel} · ${escapeHtml(category)} · ${zoneLabel}</strong>`;
  insights.innerHTML = `
    <div><span>稳过 ${safeCount}</span></div>
    <div><span>大概率 ${likelyCount}</span></div>
    <div><span>冲刺 ${reachCount}</span></div>
  `;

  resultRenderState = { results: results || [], options: { degree, category }, shown: 0 };
  list.innerHTML = resultRenderState.results.length
    ? ''
    : '<div class="results-empty">当前条件下暂无可展示院校，试试调整筛选条件。</div>';
  if (resultRenderState.results.length) renderMoreResults();
}

/** 以小批量追加匹配结果，避免真机首次渲染数百张毛玻璃卡片。 */
export function renderMoreResults() {
  const list = document.getElementById('resultsList');
  const { results, options, shown } = resultRenderState;
  if (!list || !options || shown >= results.length) return;

  list.querySelector('.result-load-more')?.remove();
  const next = results.slice(shown, shown + RESULT_BATCH_SIZE);
  list.insertAdjacentHTML('beforeend', next
    .map((result, offset) => renderResultCard(result, shown + offset, options, offset))
    .join(''));
  resultRenderState.shown += next.length;

  const remaining = results.length - resultRenderState.shown;
  if (remaining > 0) {
    list.insertAdjacentHTML('beforeend', `<button class="result-load-more" type="button" data-load-more-results>继续浏览其余 ${remaining} 所院校</button>`);
  }
}

/** 渲染单张院校卡片 */
function renderResultCard(result, index, { degree: _degree, category }, batchIndex = 0) {
  const { university: uni, verdict, verdictLabel, verdictClass, admissionScores } = result;

  const levelBadgeClass = `level-${uni.level === '985' ? '985' : uni.level === '211' ? '211' : uni.level === '双一流' ? 'l1' : 'normal'}`;

  const majorEl = document.getElementById('majorSelect');
  const major = hasSubMajors(category) && document.getElementById('majorGroup').style.display !== 'none' ? majorEl.value : null;
  const degreeLabel = _degree === 'xueshuo' ? '学硕' : '专硕';
  const displayMajor = major && major !== '不限专业' ? major.replace(/\([^)]*\)/g, '') : category;
  const scores = admissionScores?.map((item) => item.score).filter(Boolean) || [];
  const min = scores.length ? Math.min(...scores) : '—';
  const max = scores.length ? Math.max(...scores) : '—';

  // 仅对单批前若干张做级联入场，避免数百卡片同时动画造成掉帧。
  const enterClass = batchIndex < 10 ? ' card-enter' : '';
  const staggerAttr = batchIndex < 10 ? ` style="--card-stagger:${batchIndex}"` : '';
  return `
    <div class="result-card ${verdict}${enterClass}"${staggerAttr} data-index="${index}">
      <div class="uni-name">
        <span class="name-text">${escapeHtml(uni.name)}</span>
        <span class="level-badge ${levelBadgeClass}">${escapeHtml(uni.level)}</span>
      </div>
      <div class="uni-meta"><span>${escapeHtml(displayMajor)} · ${degreeLabel} · ${escapeHtml(uni.zone)}区</span></div>
      <p class="result-score-range">近 4 年院线 ${min} — ${max} 分</p>
      <div class="uni-verdict">
        <span class="${verdictClass}">${escapeHtml(verdictLabel)} ›</span>
      </div>
    </div>
  `;
}
