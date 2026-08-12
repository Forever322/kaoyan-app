import { EXAM_SUBJECTS, EXAM_CHAPTERS, SAMPLE_MATH_QUESTIONS, SAMPLE_POLITICS_QUESTIONS, SAMPLE_ENGLISH_QUESTIONS } from '../data/exam-data.js';

export const QUIZ_QUESTIONS = {
  math: SAMPLE_MATH_QUESTIONS,
  politics: SAMPLE_POLITICS_QUESTIONS,
  english: SAMPLE_ENGLISH_QUESTIONS,
};

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
  const chapterChips = chapters.map((ch, i) => `
    <button type="button" class="exam-chapter-chip" data-chapter-name="${ch.name}">
      ${ch.name}${ch.weight ? ` (${ch.weight})` : ''}
    </button>
  `).join('');
  return allChip + chapterChips;
}

function renderTopicTags(topics) {
  if (!topics || !topics.length) return '';
  const allTopics = [];
  topics.forEach(t => {
    if (t.p0) t.p0.forEach(item => allTopics.push({ name: item, level: 'P0' }));
    if (t.topics) t.topics.forEach(item => allTopics.push({ name: item.name || item, level: 'P0' }));
  });
  if (topics[0] && typeof topics[0] === 'string') {
    return topics.map(t => `<span class="exam-topic-tag">${t}</span>`).join('');
  }
  return allTopics.slice(0, 20).map(t =>
    `<span class="exam-topic-tag ${t.level === 'P0' ? 'is-p0' : ''}">${t.name}</span>`
  ).join('');
}

function renderQuizPanel(subject) {
  const questions = QUIZ_QUESTIONS[subject] || [];
  return `
    <div class="exam-quiz-container" data-subject="${subject}">
      <div class="exam-quiz-start">
        <div class="exam-quiz-start-icon">📝</div>
        <strong>共 ${questions.length} 道真题</strong>
        <small>选择题 · 点击选项即可作答</small>
        <button type="button" class="exam-start-btn" data-action="start-quiz">开始刷题</button>
      </div>
      <div class="exam-quiz-active hidden">
        <div class="exam-quiz-progress">
          <div class="exam-quiz-progress-bar"><i style="width:0%"></i></div>
          <span class="exam-quiz-counter">1 / ${questions.length}</span>
        </div>
        <div class="exam-quiz-question"></div>
        <div class="exam-quiz-options"></div>
        <div class="exam-quiz-feedback hidden"></div>
        <button type="button" class="exam-quiz-next hidden" data-action="next-question">下一题 ›</button>
      </div>
      <div class="exam-quiz-summary hidden">
        <div class="exam-quiz-summary-icon"></div>
        <strong class="exam-quiz-summary-title"></strong>
        <small class="exam-quiz-summary-detail"></small>
        <div class="exam-quiz-summary-actions">
          <button type="button" class="exam-start-btn" data-action="retry-quiz">重新刷题</button>
          <button type="button" class="exam-start-btn is-outline" data-action="review-mistakes">查看错题</button>
        </div>
      </div>
    </div>
  `;
}

function renderMathContent() {
  const chapters = EXAM_CHAPTERS.math;
  return `
    <div class="exam-chapter-scroll">
      ${renderChapterNav(chapters)}
    </div>
    <div class="exam-topic-cloud">
      <p class="exam-topic-label">高频考点 (P0)</p>
      <div class="exam-topic-tags">
        ${renderTopicTags(chapters.flatMap(ch => ch.topics))}
      </div>
    </div>
    ${renderQuizPanel('math')}
  `;
}

function renderPoliticsContent() {
  const chapters = EXAM_CHAPTERS.politics;
  const allP0 = [];
  chapters.forEach(ch => {
    (ch.topics || []).forEach(t => {
      (t.p0 || []).forEach(item => allP0.push({ name: item, level: 'P0' }));
    });
    (ch.p1 || []).forEach(item => allP0.push({ name: item, level: 'P1' }));
  });

  return `
    <div class="exam-chapter-scroll">
      ${renderChapterNav(chapters.map(ch => ({ id: ch.id, name: ch.name, desc: ch.desc })))}
    </div>
    <div class="exam-topic-cloud">
      <p class="exam-topic-label">高频考点 (P0)</p>
      <div class="exam-topic-tags">
        ${allP0.length ? allP0.slice(0, 24).map(t =>
          `<span class="exam-topic-tag ${t.level === 'P0' ? 'is-p0' : ''}">${t.name}</span>`
        ).join('') : ''}
      </div>
    </div>
    ${renderQuizPanel('politics')}
  `;
}

function renderEnglishContent() {
  const chapters = EXAM_CHAPTERS.english;
  const allP0 = [];
  chapters.forEach(ch => {
    (ch.topics || []).forEach(t => {
      (t.p0 || []).forEach(item => allP0.push({ name: item, level: 'P0' }));
    });
  });

  return `
    <div class="exam-chapter-scroll">
      ${renderChapterNav(chapters.map(ch => ({ id: ch.id, name: ch.name, weight: ch.weight })))}
    </div>
    <div class="exam-topic-cloud">
      <p class="exam-topic-label">高频考点 (P0)</p>
      <div class="exam-topic-tags">
        ${allP0.slice(0, 24).map(t =>
          `<span class="exam-topic-tag ${t.level === 'P0' ? 'is-p0' : ''}">${t.name}</span>`
        ).join('')}
      </div>
    </div>
    ${renderQuizPanel('english')}
  `;
}

export function examView() {
  return `
    <section id="examScreen" class="app-screen exam-screen" aria-label="历年真题">
      <header class="study-topbar">
        <button id="examBackBtn" class="study-icon-btn" type="button" aria-label="返回题库">←</button>
        <div><h1>历年真题</h1><p>考研数学 · 政治 · 英语真题训练</p></div>
      </header>
      <main class="study-main">
        <div class="exam-subject-tabs" role="tablist">
          ${renderSubjectTabs('math')}
        </div>
        <div id="examSubjectContent" class="exam-subject-content">
          <div id="examPanelMath" class="exam-panel">
            ${renderMathContent()}
          </div>
          <div id="examPanelPolitics" class="exam-panel hidden">
            ${renderPoliticsContent()}
          </div>
          <div id="examPanelEnglish" class="exam-panel hidden">
            ${renderEnglishContent()}
          </div>
        </div>
      </main>
    </section>
  `;
}
