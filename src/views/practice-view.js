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
          <button type="button" data-practice-action="历年真题"><i>▤</i><strong>历年真题</strong><small>英语一 · 2010—2026</small></button>
          <button type="button" data-practice-action="专项刷题"><i>✓</i><strong>专项刷题</strong><small>按知识点智能组卷</small></button>
          <button type="button" data-practice-action="错题本"><i>×</i><strong>错题本</strong><small>126 题待复习</small></button>
          <button type="button" data-practice-action="单词系统"><i>文</i><strong>单词系统</strong><small>今日 120 / 200</small></button>
        </section>
        <section class="study-section" aria-labelledby="wrongReviewTitle">
          <div class="study-section-heading"><h2 id="wrongReviewTitle">今日错题复习</h2><button id="allWrongBtn" type="button">查看全部</button></div>
          <div class="practice-wrong-list">
            <button type="button"><i class="math"></i><span><strong>极限与连续</strong><small>数学 · 高数 · 计算错误</small></span><em>12题</em></button>
            <button type="button"><i class="english"></i><span><strong>长难句理解</strong><small>英语 · 阅读 · 知识点不熟</small></span><em>8题</em></button>
            <button type="button"><i class="politics"></i><span><strong>唯物辩证法</strong><small>政治 · 马原 · 审题错误</small></span><em>6题</em></button>
          </div>
        </section>
        <button id="wrongAnalysisBtn" class="study-ai-tip" type="button"><b>✦</b><span><strong>AI 错题分析</strong><small>本月数学 36% 的错误来自计算失误，建议开启限时验算训练。</small></span></button>
      </main>
    </section>
  `;
}
