import {
  RECENT_EXAM_YEARS,
  PAPER_SUBJECTS,
  RECENT_TOTAL,
  getPaperMeta,
} from '../data/exam-papers.js';
import { renderQuizPanel } from './quiz-panel.js';

function renderYearTabs() {
  return RECENT_EXAM_YEARS.map((year, i) => `
    <button type="button" class="exam-year-tab ${i === 0 ? 'is-active' : ''}" data-exam-year="${year}" role="tab">
      <strong>${year}</strong>
      <small>考研真题</small>
    </button>
  `).join('');
}

function renderTypeChips(byType) {
  return Object.entries(byType)
    .map(([type, n]) => `<span class="exam-paper-type">${type} ${n}</span>`)
    .join('');
}

function renderPaperCard(year, subject) {
  const meta = getPaperMeta(year, subject.id);
  const disabled = meta.count === 0;
  return `
    <button type="button" class="exam-paper-card${disabled ? ' is-empty' : ''}"
      data-paper-year="${year}" data-paper-subject="${subject.id}" ${disabled ? 'disabled' : ''}>
      <i class="exam-paper-icon ${subject.id}">${subject.icon}</i>
      <span class="exam-paper-body">
        <strong>${year} 年${subject.name}</strong>
        <small class="exam-paper-types">${disabled ? '暂无试题' : renderTypeChips(meta.byType)}</small>
        <small class="exam-paper-progress" data-paper-progress="${year}:${subject.id}"></small>
      </span>
      <em class="exam-paper-count">${meta.count}<b>题</b></em>
    </button>
  `;
}

function renderYearGroups() {
  return RECENT_EXAM_YEARS.map((year, i) => `
    <div class="exam-year-group ${i === 0 ? '' : 'hidden'}" data-year-group="${year}">
      ${PAPER_SUBJECTS.map(s => renderPaperCard(year, s)).join('')}
    </div>
  `).join('');
}

export function examView() {
  return `
    <section id="examScreen" class="app-screen exam-screen" aria-label="历年真题">
      <header class="study-topbar">
        <button id="examBackBtn" class="study-icon-btn" type="button" aria-label="返回题库">←</button>
        <div>
          <h1>历年真题</h1>
          <p>${RECENT_EXAM_YEARS[RECENT_EXAM_YEARS.length - 1]}—${RECENT_EXAM_YEARS[0]} · ${RECENT_TOTAL} 题 · 逐题解析</p>
        </div>
      </header>
      <main class="study-main">
        <div id="examPaperPicker" class="exam-paper-picker">
          <div class="exam-year-tabs" role="tablist">
            ${renderYearTabs()}
          </div>
          <div class="exam-paper-list">
            ${renderYearGroups()}
          </div>
        </div>
        <div id="examPaperRunner" class="exam-paper-runner hidden">
          <div class="exam-paper-runner-head">
            <button type="button" class="exam-paper-exit" data-action="exit-paper">‹ 换一卷</button>
            <strong id="examPaperTitle"></strong>
          </div>
          ${renderQuizPanel('math')}
        </div>
      </main>
    </section>
  `;
}
