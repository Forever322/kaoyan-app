import { EXAM_SUBJECTS, EXAM_CHAPTERS, SAMPLE_MATH_QUESTIONS, SAMPLE_POLITICS_QUESTIONS, SAMPLE_ENGLISH_QUESTIONS } from '../data/exam-data.js';

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
  return chapters.map((ch, i) => `
    <button type="button" class="exam-chapter-chip ${i === 0 ? 'is-active' : ''}" data-chapter-id="${ch.id || i}">
      ${ch.name}${ch.weight ? ` (${ch.weight})` : ''}
    </button>
  `).join('');
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

function renderQuestionCard(q) {
  const typeIcons = { '选择': '📋', '填空': '✏️', '解答': '📐', '证明': '🔷' };
  const diffLabels = { 'P0': '高频', 'P1': '中频', 'P2': '低频' };

  return `
    <div class="exam-question-card" data-question-id="${q.id}">
      <div class="exam-question-head">
        <span class="exam-q-type">${typeIcons[q.type] || '📝'} ${q.type}题</span>
        <span class="exam-q-difficulty is-${q.difficulty?.toLowerCase()}">${diffLabels[q.difficulty] || q.difficulty}</span>
        ${q.year ? `<span class="exam-q-year">${q.year}</span>` : ''}
      </div>
      <div class="exam-question-body">
        <p class="exam-q-topic">${q.chapter} · ${q.topic}${q.subject ? ` · ${q.subject}` : ''}</p>
        <p class="exam-q-text">${q.question}</p>
        ${q.options ? q.options.map((o, i) => `<p class="exam-q-option">${o}</p>`).join('') : ''}
        ${q.passage ? `<p class="exam-q-passage">${q.passage}</p>` : ''}
      </div>
      <div class="exam-question-answer" style="display:none">
        <div class="exam-answer-divider"></div>
        <p class="exam-a-answer"><strong>答案：</strong>${q.answer}</p>
        <p class="exam-a-solution"><strong>解析：</strong>${q.solution}</p>
        ${q.tips ? `<p class="exam-a-tips"><strong>易错提示：</strong>${q.tips}</p>` : ''}
      </div>
      <button type="button" class="exam-toggle-answer" data-question-id="${q.id}">
        查看答案与解析 ▼
      </button>
    </div>
  `;
}

function renderMathContent() {
  const chapters = EXAM_CHAPTERS.math;
  const chapterQuestions = chapters.map(ch => {
    const questions = SAMPLE_MATH_QUESTIONS.filter(q => q.chapter === ch.name);
    return { chapter: ch, questions };
  });

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
    <div class="exam-questions-section">
      <div class="exam-section-heading">
        <h2>精选真题</h2>
        <select id="mathYearFilter" class="exam-year-select">
          <option value="all">全部年份</option>
          <option value="2025">2025</option>
          <option value="2024">2024</option>
          <option value="2023">2023</option>
          <option value="2022">2022</option>
          <option value="2021">2021</option>
        </select>
      </div>
      <div id="mathQuestionsList" class="exam-questions-list">
        ${SAMPLE_MATH_QUESTIONS.map(q => renderQuestionCard(q)).join('')}
      </div>
    </div>
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
    <div class="exam-questions-section">
      <div class="exam-section-heading">
        <h2>精选真题</h2>
        <select id="politicsYearFilter" class="exam-year-select">
          <option value="all">全部年份</option>
          <option value="2025">2025</option>
          <option value="2024">2024</option>
          <option value="2023">2023</option>
        </select>
      </div>
      <div id="politicsQuestionsList" class="exam-questions-list">
        ${SAMPLE_POLITICS_QUESTIONS.map(q => renderQuestionCard(q)).join('')}
      </div>
    </div>
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
    <div class="exam-questions-section">
      <div class="exam-section-heading">
        <h2>精选真题</h2>
        <select id="englishYearFilter" class="exam-year-select">
          <option value="all">全部年份</option>
          <option value="2025">2025</option>
          <option value="2024">2024</option>
          <option value="2023">2023</option>
        </select>
      </div>
      <div id="englishQuestionsList" class="exam-questions-list">
        ${SAMPLE_ENGLISH_QUESTIONS.map(q => renderQuestionCard(q)).join('')}
      </div>
    </div>
  `;
}

export function examView() {
  return `
    <section id="examScreen" class="app-screen exam-screen" aria-label="历年真题">
      <header class="study-topbar">
        <button id="examBackBtn" class="study-icon-btn" type="button" aria-label="返回题库">←</button>
        <div><h1>历年真题</h1><p>考研数学 · 政治 · 英语真题训练</p></div>
        <button id="examRandomBtn" class="study-icon-btn" type="button" aria-label="随机组卷">🎲</button>
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
