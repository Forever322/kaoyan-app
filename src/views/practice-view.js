import { CHAPTER_MAP, DIFFICULTY_LEVELS, MISTAKE_BOOK_SCHEMA, CORE_TAGS } from '../data/brush-data.js';

function renderPracticeEntries() {
  const tags = CORE_TAGS.slice(0, 4);
  const icons = ['📜', '📖', '📐', '📚'];
  const actions = ['历年真题', '专项刷题', '错题本', '单词系统'];
  const subtitles = [
    '英语一 · 2010—2026',
    '按知识点智能组卷',
    '126 题待复习',
    '今日 120 / 200',
  ];
  return tags.map((tag, i) => {
    const chapter = CHAPTER_MAP.find(c => c.name === tag);
    const p0Count = chapter ? chapter.p0.length : 0;
    const p1Count = chapter ? (chapter.p1 || []).length : 0;
    return `<button type="button" data-practice-action="${actions[i]}" data-chapter="${chapter?.id || ''}">
      <i>${icons[i]}</i><strong>${actions[i]}</strong>
      <small>${subtitles[i]} · P0×${p0Count} P1×${p1Count}</small>
    </button>`;
  }).join('');
}

function renderWrongQuestionPlaceholder() {
  const sample = [
    { subject: 'math', name: '极限与连续', meta: '数学 · 高数 · 计算错误', count: 12, iconClass: 'math' },
    { subject: 'english', name: '长难句理解', meta: '英语 · 阅读 · 知识点不熟', count: 8, iconClass: 'english' },
    { subject: 'politics', name: '唯物辩证法', meta: '政治 · 马原 · 审题错误', count: 6, iconClass: 'politics' },
  ];
  const schemaFields = MISTAKE_BOOK_SCHEMA.fields.map(f => f.desc).join(' · ');
  return sample.map(item =>
    `<button type="button" title="${schemaFields}"><i class="${item.iconClass}"></i><span><strong>${item.name}</strong><small>${item.meta}</small></span><em>${item.count}题</em></button>`
  ).join('');
}

function renderDifficultyLegend() {
  const levels = Object.entries(DIFFICULTY_LEVELS);
  return `<div class="practice-difficulty-legend" style="display:flex;gap:8px;margin-top:10px;font-size:.56rem;color:#000000">
    ${levels.map(([key, val]) => `<span>${val.label}: ${val.desc}</span>`).join('')}
  </div>`;
}

export function practiceView() {
  return `
    <section id="practiceScreen" class="app-screen practice-screen" aria-label="题库">
      <header class="study-topbar">
        <div><h1>题库</h1><p>真题、刷题、单词与错题闭环</p></div>
        <button class="study-icon-btn" type="button" aria-label="搜索题库">⌕</button>
      </header>
      <main class="study-main">
        <button id="resumePracticeBtn" class="practice-resume" type="button">
          <span class="practice-ring">85%</span>
          <span><small>继续上次练习</small><strong>2022 英语一 · 阅读</strong><em>二刷 · 34 / 40 · 还剩 2 篇</em></span><b>›</b>
        </button>
        <section class="practice-entry-grid" aria-label="题库功能">
          ${renderPracticeEntries()}
        </section>
        ${renderDifficultyLegend()}
        <section class="study-section" aria-labelledby="wrongReviewTitle">
          <div class="study-section-heading"><h2 id="wrongReviewTitle">今日错题复习</h2><button id="allWrongBtn" type="button">查看全部</button></div>
          <div class="practice-wrong-list">
            ${renderWrongQuestionPlaceholder()}
          </div>
        </section>
        <button id="wrongAnalysisBtn" class="study-ai-tip" type="button"><b>✦</b><span><strong>AI 错题分析</strong><small>本月数学 36% 的错误来自计算失误，建议开启限时验算训练。</small></span></button>
      </main>
    </section>
  `;
}
