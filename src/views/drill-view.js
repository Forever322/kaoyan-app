import { EXAM_SUBJECTS, EXAM_CHAPTERS } from '../data/exam-data.js';
import { QUESTION_BANK, BANK_TOTAL } from '../data/exam-papers.js';
import { renderQuizPanel } from './quiz-panel.js';

function renderSubjectTabs(activeSubject) {
  return EXAM_SUBJECTS.map(s => `
    <button type="button" class="exam-subject-tab ${s.id === activeSubject ? 'is-active' : ''}" data-subject="${s.id}">
      <b>${s.icon}</b>
      <span>
        <strong>${s.name}</strong>
        <small>${s.desc}</small>
      </span>
    </button>
  `).join('');
}

function renderChapterNav(chapters) {
  if (!chapters || !chapters.length) return '';
  const allChip = `<button type="button" class="exam-chapter-chip is-active" data-chapter-name="全部" data-chapter-all="true">全部</button>`;
  const chapterChips = chapters.map(ch => `
    <button type="button" class="exam-chapter-chip" data-chapter-name="${ch.name}">
      ${ch.name}${ch.weight ? ` (${ch.weight})` : ''}
    </button>
  `).join('');
  return allChip + chapterChips;
}

function renderTopicSelectPanel(chapters, subject) {
  if (!chapters || !chapters.length) return '';
  return `
    <div class="exam-topic-select-panel hidden" id="topicSelectPanel_${subject}">
      <div class="exam-topic-select-header">
        <strong>📖 选择知识点（可多选）</strong>
        <small>勾选后只刷这些考点 · <button type="button" class="exam-topic-exit-btn" data-action="exit-topic-mode">返回全部题目</button></small>
      </div>
      <div class="exam-topic-select-chapters">
        ${chapters.map(ch => `
          <details class="exam-topic-chapter-group">
            <summary class="exam-topic-chapter-summary">
              <span>${ch.name}</span>
              <em>${ch.topics?.length || 0}个知识点</em>
            </summary>
            <div class="exam-topic-checkboxes">
              ${(ch.topics || []).map(t => {
                const topicName = t.name || t;
                const p0Tags = Array.isArray(t.p0) ? t.p0 : [];
                return `<label class="exam-topic-checkbox">
                  <input type="checkbox" data-topic="${topicName}" data-subject="${subject}" data-chapter="${ch.name}">
                  <span>
                    <strong>${topicName}</strong>
                    ${p0Tags.length ? `<small>${p0Tags.slice(0, 3).join(' · ')}</small>` : ''}
                  </span>
                </label>`;
              }).join('')}
            </div>
          </details>
        `).join('')}
      </div>
      <div class="exam-topic-select-actions">
        <span class="exam-topic-select-count">已选 <b id="topicSelectCount_${subject}">0</b> 个知识点</span>
        <button type="button" class="exam-start-btn" data-action="start-topic-quiz">开始专项刷题</button>
      </div>
    </div>
  `;
}

/** 收集该科目全部 P0/P1 考点标签，用于考点云 */
function collectHotTopics(chapters) {
  const tags = [];
  chapters.forEach(ch => {
    (ch.topics || []).forEach(t => {
      if (Array.isArray(t.p0)) t.p0.forEach(item => tags.push({ name: item, level: 'P0' }));
      else if (typeof t === 'string') tags.push({ name: t, level: 'P0' });
      else if (t.name) tags.push({ name: t.name, level: 'P0' });
    });
    (ch.p1 || []).forEach(item => tags.push({ name: item, level: 'P1' }));
  });
  return tags;
}

function renderSubjectPanel(subjectId, hidden) {
  const chapters = EXAM_CHAPTERS[subjectId] || [];
  const hotTopics = collectHotTopics(chapters);
  const total = (QUESTION_BANK[subjectId] || []).length;
  return `
    <div id="drillPanel${subjectId[0].toUpperCase()}${subjectId.slice(1)}" class="exam-panel${hidden ? ' hidden' : ''}">
      <div class="exam-chapter-scroll">
        ${renderChapterNav(chapters)}
      </div>
      ${renderTopicSelectPanel(chapters, subjectId)}
      <div class="exam-topic-cloud">
        <p class="exam-topic-label">高频考点 (P0)</p>
        <div class="exam-topic-tags">
          ${hotTopics.slice(0, 24).map(t =>
            `<span class="exam-topic-tag ${t.level === 'P0' ? 'is-p0' : ''}">${t.name}</span>`
          ).join('')}
        </div>
      </div>
      ${renderQuizPanel(subjectId, {
        startTitle: `共 ${total} 道题`,
        startHint: '按章节或知识点筛选后作答',
        startIcon: '📐',
      })}
    </div>
  `;
}

export function drillView() {
  return `
    <section id="drillScreen" class="app-screen exam-screen drill-screen" aria-label="专项练习">
      <header class="study-topbar">
        <button id="drillBackBtn" class="study-icon-btn" type="button" aria-label="返回题库">←</button>
        <div>
          <h1>专项练习</h1>
          <p>全部 ${BANK_TOTAL} 题 · 按章节与知识点组卷</p>
        </div>
        <button id="drillTopicBtn" class="study-icon-btn" type="button" aria-label="按知识点组卷">☰</button>
      </header>
      <main class="study-main">
        <div class="exam-subject-tabs" role="tablist">
          ${renderSubjectTabs('math')}
        </div>
        <div id="drillSubjectContent" class="exam-subject-content">
          ${renderSubjectPanel('math', false)}
          ${renderSubjectPanel('politics', true)}
          ${renderSubjectPanel('english', true)}
        </div>
      </main>
    </section>
  `;
}
