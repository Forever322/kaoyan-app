import { CHAPTER_MAP, DIFFICULTY_LEVELS, CORE_TAGS } from '../data/brush-data.js';

function getMistakeStats() {
  try {
    const raw = localStorage.getItem('mistake_book_v2');
    const book = raw ? JSON.parse(raw) : [];
    const bySubject = {};
    book.forEach(e => {
      const s = e.subject || 'other';
      if (!bySubject[s]) bySubject[s] = [];
      bySubject[s].push(e);
    });
    return { total: book.length, bySubject };
  } catch { return { total: 0, bySubject: {} }; }
}

function getPracticeCount() {
  try {
    const raw = localStorage.getItem('practice_progress_v1');
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !p.lastSubject) return null;
    const sp = p.subjectProgress?.[p.lastSubject] || {};
    return { subject: p.lastSubject, viewed: sp.viewed || 0, total: sp.total || 0, pct: sp.percentage || 0 };
  } catch { return null; }
}

function renderPracticeEntries() {
  const tags = CORE_TAGS.slice(0, 4);
  const icons = ['📜', '📖', '📐', '📚'];
  const actions = ['历年真题', '专项刷题', '错题本', '单词系统'];
  const { total: mistakeTotal } = getMistakeStats();
  const practiceInfo = getPracticeCount();
  const subtitles = [
    '英语一 · 2010—2026',
    '按知识点智能组卷',
    mistakeTotal > 0 ? `${mistakeTotal} 题待复习` : '暂无错题',
    practiceInfo ? `已完成 ${practiceInfo.pct}%` : '今日 120 / 200',
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

function renderWrongQuestionList() {
  const { total, bySubject } = getMistakeStats();
  if (total === 0) {
    return `<div class="practice-wrong-empty">暂无错题，继续加油 ✨</div>`;
  }
  const subjectMeta = {
    math: { name: '数学', icon: '∑', iconClass: 'math' },
    politics: { name: '政治', icon: '政', iconClass: 'politics' },
    english: { name: '英语', icon: 'A', iconClass: 'english' },
  };
  return Object.entries(bySubject).map(([subject, items]) => {
    const meta = subjectMeta[subject] || { name: subject, icon: '?', iconClass: '' };
    const topics = [...new Set(items.map(e => e.topic || e.chapter).filter(Boolean))].slice(0, 3).join(' · ');
    return `<button type="button" data-practice-action="错题本" data-subject="${subject}">
      <i class="${meta.iconClass}">${meta.icon}</i>
      <span><strong>${meta.name}错题</strong><small>${topics || '综合'}</small></span>
      <em>${items.length}题</em>
    </button>`;
  }).join('');
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
        <button id="resumePracticeBtn" class="practice-resume" type="button" style="display:none">
          <span id="resumeRing" class="practice-ring">0%</span>
          <span><small id="resumeLabel">继续上次练习</small><strong id="resumeSubject">暂无记录</strong><em id="resumeDetail"></em></span><b>›</b>
        </button>
        <section class="practice-entry-grid" aria-label="题库功能">
          ${renderPracticeEntries()}
        </section>
        ${renderDifficultyLegend()}
        <section class="study-section" aria-labelledby="wrongReviewTitle">
          <div class="study-section-heading"><h2 id="wrongReviewTitle">今日错题复习</h2><button id="allWrongBtn" type="button">查看全部</button></div>
          <div class="practice-wrong-list">
            ${renderWrongQuestionList()}
          </div>
        </section>
        <button id="wrongAnalysisBtn" class="study-ai-tip" type="button"><b>✦</b><span><strong>AI 错题分析</strong><small>本月数学 36% 的错误来自计算失误，建议开启限时验算训练。</small></span></button>
      </main>
    </section>
  `;
}
