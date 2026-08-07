export function homeView() {
  return `
    <section id="homeScreen" class="app-screen home-screen is-active" aria-label="为你推荐">
      <header class="home-header">
        <button class="home-brand" type="button" data-open-filter aria-label="打开筛选">
          <span class="brand-mark" aria-hidden="true">♫</span>
          <span><b>考研择校</b><small>YOUR EXAM RHYTHM</small></span>
        </button>
        <button class="profile-orb" type="button" data-open-filter aria-label="筛选与搜索">♙</button>
      </header>

      <main class="home-main">
        <div class="home-greeting"><span>晚上好，研友</span><em>2026 研考</em></div>
        <h1>把分数调成你的节奏</h1>

        <section class="score-dashboard" aria-labelledby="homeScoreHeading">
          <div class="score-dashboard-top"><span id="homeScoreHeading">我的初试分数</span><b id="homeScoreState">状态正热</b></div>
          <p id="homeLineStatus" class="home-line-status">✓ 超过 A 区工学线 124 分</p>
          <div class="home-score-row"><input id="scoreInput" type="number" min="0" max="500" inputmode="numeric" value="" aria-label="你的初试分数"><span>分</span><small id="homeScoreNote">已为你准备好 32 所院校</small></div>
          <div class="score-equalizer" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        </section>

        <div class="home-condition-chips" aria-label="当前匹配条件">
          <button type="button" data-open-filter id="homeDegreeChip">♧ 学硕</button>
          <button type="button" data-open-filter id="homeCategoryChip">♙ 工学</button>
          <button type="button" data-open-filter id="homeZoneChip">⌾ A 区</button>
        </div>

        <button id="searchBtn" class="home-match-btn" type="button"><span><b>开始匹配院校</b><small>基于分数、专业与地区</small></span><i>→</i></button>

        <div class="home-section-heading"><h2>专为你上新的院校</h2><button id="homeSeeAllBtn" type="button">查看全部 ›</button></div>
        <button id="homeRecommendCard" class="home-recommend-card" type="button" data-uni-name="清华大学">
          <span class="home-recommend-copy"><b id="homeRecommendName">清华大学</b><small id="homeRecommendMeta">工学 · 学硕 · A区 · 全日制</small><em id="homeRecommendScore">近 4 年院线 303 — 325 分</em></span>
          <span class="home-recommend-badges"><i id="homeRecommendLevel">985</i><strong id="homeRecommendVerdict">稳过</strong></span>
          <span class="recommend-meter"><i id="homeRecommendMeter"></i></span>
        </button>
      </main>

      <!-- 真实表单状态由筛选抽屉编辑；保留控件以复用现有匹配逻辑。 -->
      <div class="home-logic-controls" aria-hidden="true">
        <div id="degreeToggle"><button class="toggle-btn active" type="button" data-value="xueshuo">学硕</button><button class="toggle-btn" type="button" data-value="zhuanshuo">专硕</button></div>
        <div id="categorySelect" class="major-dropdown"><div class="major-trigger" role="combobox" aria-expanded="false" aria-haspopup="listbox"><input type="text" class="major-trigger-input" autocomplete="off" readonly><svg class="major-trigger-icon" width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M6 8L1 3h10z"/></svg></div><div class="major-panel" role="listbox"></div></div>
        <div id="majorGroup"><label id="majorLabel">专业方向</label><div id="majorSelect" class="major-dropdown"><div class="major-trigger" role="combobox" aria-expanded="false" aria-haspopup="listbox"><input type="text" class="major-trigger-input" autocomplete="off" readonly><svg class="major-trigger-icon" width="12" height="12" viewBox="0 0 12 12"><path fill="currentColor" d="M6 8L1 3h10z"/></svg></div><div class="major-panel" role="listbox"></div></div></div>
        <div id="zoneToggle"><button class="toggle-btn active" type="button" data-value="A">A区</button><button class="toggle-btn" type="button" data-value="B">B区</button><button class="toggle-btn" type="button" data-value="all">不限</button></div>
        <select id="provinceSelect"><option value="all">全部省份</option></select>
        <div id="studyModeToggle"><button class="toggle-btn active" type="button" data-value="all">全部</button><button class="toggle-btn" type="button" data-value="全日制">全日制</button><button class="toggle-btn" type="button" data-value="非全日制">非全日制</button></div>
        <section id="nationalLineCard"><div id="nationalLineInfo"></div></section>
      </div>
    </section>
  `;
}
