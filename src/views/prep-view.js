export function prepView() {
  return `
    <section id="prepScreen" class="app-screen prep-screen" aria-label="备考工作台">
      <header class="prep-topbar">
        <div>
          <span class="prep-kicker">2026 · 研考</span>
          <h1>备考</h1>
        </div>
        <button id="prepSettingsBtn" class="prep-icon-btn" type="button" aria-label="备考设置" title="备考设置">⚙</button>
      </header>

      <main class="prep-main">
        <section class="prep-countdown-card" aria-label="初试倒计时">
          <div class="prep-countdown-copy">
            <span class="prep-label">距离初试</span>
            <strong id="prepDaysLeft">142</strong>
            <span class="prep-days-unit">天</span>
          </div>
          <div class="prep-stage-copy">
            <span class="prep-stage-dot"></span>
            <span>强化阶段</span>
            <small>目标 12 月 20 日</small>
          </div>
        </section>

        <section class="prep-section prep-tasks-section" aria-labelledby="prepTasksTitle">
          <div class="prep-section-heading">
            <div><span class="prep-eyebrow">TODAY</span><h2 id="prepTasksTitle">今日任务</h2></div>
            <span id="prepTaskProgress" class="prep-section-value">2 / 4</span>
          </div>
          <div id="prepTaskList" class="prep-task-list">
            <button class="prep-task is-complete" type="button" data-task-id="english"><span class="prep-task-check">✓</span><span class="prep-task-copy"><strong>英语真题阅读</strong><small>完成 2 篇 · 45 分钟</small></span><span class="prep-task-arrow">›</span></button>
            <button class="prep-task is-complete" type="button" data-task-id="politics"><span class="prep-task-check">✓</span><span class="prep-task-copy"><strong>政治选择题</strong><small>肖 1000 题 · 30 分钟</small></span><span class="prep-task-arrow">›</span></button>
            <button class="prep-task" type="button" data-task-id="math"><span class="prep-task-check"></span><span class="prep-task-copy"><strong>数学强化训练</strong><small>高数专题 · 90 分钟</small></span><span class="prep-task-arrow">›</span></button>
            <button class="prep-task" type="button" data-task-id="major"><span class="prep-task-check"></span><span class="prep-task-copy"><strong>专业课背诵</strong><small>名词解释 · 60 分钟</small></span><span class="prep-task-arrow">›</span></button>
          </div>
        </section>

        <section class="prep-section prep-week-section" aria-labelledby="prepWeekTitle">
          <div class="prep-section-heading"><div><span class="prep-eyebrow">THIS WEEK</span><h2 id="prepWeekTitle">本周状态</h2></div><button id="prepStatsBtn" class="prep-text-btn" type="button">查看统计</button></div>
          <div class="prep-stats-grid">
            <div class="prep-stat"><strong>18.5<span>h</span></strong><small>学习时长</small></div>
            <div class="prep-stat"><strong>6<span>天</span></strong><small>连续学习</small></div>
            <div class="prep-stat"><strong id="prepCompletedCount">12</strong><small>完成任务</small></div>
          </div>
        </section>

        <section class="prep-section prep-subject-section" aria-labelledby="prepSubjectTitle">
          <div class="prep-section-heading"><div><span class="prep-eyebrow">SUBJECTS</span><h2 id="prepSubjectTitle">科目进度</h2></div><button id="prepSubjectsBtn" class="prep-text-btn" type="button">全部</button></div>
          <div class="prep-subject-grid">
            <article class="prep-subject-card"><div><strong>英语</strong><span>强化阶段</span></div><b>68%</b><div class="prep-progress"><i style="width:68%"></i></div></article>
            <article class="prep-subject-card"><div><strong>数学</strong><span>强化阶段</span></div><b>52%</b><div class="prep-progress"><i style="width:52%"></i></div></article>
            <article class="prep-subject-card"><div><strong>专业课</strong><span>基础阶段</span></div><b>41%</b><div class="prep-progress"><i style="width:41%"></i></div></article>
            <article class="prep-subject-card"><div><strong>政治</strong><span>基础阶段</span></div><b>35%</b><div class="prep-progress"><i style="width:35%"></i></div></article>
          </div>
        </section>
      </main>
    </section>
  `;
}
