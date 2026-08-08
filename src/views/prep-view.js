export function prepView() {
  return `
    <section id="prepScreen" class="app-screen prep-screen" aria-label="备考">
      <header class="study-topbar"><div><h1>备考</h1><p>计划、专注与复习节奏</p></div><button id="prepSettingsBtn" class="study-icon-btn" type="button" aria-label="备考设置">⚙</button></header>
      <main class="study-main">
        <section class="prep-countdown-card" aria-label="初试倒计时">
          <div><span>距离 2027 考研</span><strong id="prepDaysLeft">138</strong><em>天</em></div>
          <b>强化阶段</b>
          <p>本周任务 <i id="prepWeekProgress">23 / 31</i><small><u></u></small></p>
        </section>
        <section class="today-action-card" aria-labelledby="todayActionTitle">
          <div class="today-action-head"><div><h2 id="todayActionTitle">今天该干什么</h2><small>最近节点 · 9月24日预报名</small></div><b id="prepCompletionRate">57%</b></div>
          <div class="today-metrics"><span><small>今日学习</small><strong id="prepStudyTime">4h 32m / 8h</strong></span><span><small>任务完成</small><strong id="prepTaskProgress">4 / 7 项</strong></span></div>
          <div class="today-actions"><button id="startStudyBtn" type="button">▷ 开始学习</button><button id="dailyCheckinBtn" type="button">✓ 打卡</button></div>
          <p>✦ 完成今天，比计划明天更重要。</p>
        </section>
        <section class="prep-shortcuts" aria-label="备考功能"><button type="button"><i>▣</i><strong>计划</strong><small>年 / 月 / 周</small></button><button id="openTimerBtn" class="is-dark" type="button"><i>◷</i><strong>计时</strong><small>开始专注</small></button><button type="button"><i>文</i><strong>单词</strong><small>今日 120/200</small></button></section>
        <section class="study-section prep-tasks-section" aria-labelledby="prepTasksTitle"><div class="study-section-heading"><h2 id="prepTasksTitle">今日任务</h2><button type="button">管理计划</button></div><div id="prepTaskList" class="prep-task-list"><button class="prep-task" type="button" data-task-id="english"><span class="prep-task-check"></span><span><small class="english-subject">英语</small><strong>核心词汇 200</strong></span><em>25分钟</em></button><button class="prep-task is-complete" type="button" data-task-id="math"><span class="prep-task-check">✓</span><span><small class="math-subject">数学</small><strong>高数强化 · 多元积分</strong></span><em>120分钟</em></button><button class="prep-task" type="button" data-task-id="politics"><span class="prep-task-check"></span><span><small class="politics-subject">政治</small><strong>肖1000 · 60题</strong></span><em>45分钟</em></button><button class="prep-task" type="button" data-task-id="major"><span class="prep-task-check"></span><span><small class="major-subject">专业课</small><strong>数据结构 · 图</strong></span><em>90分钟</em></button></div></section>
        <button id="prepStatsBtn" class="study-ai-tip study-ai-entry" type="button"><b>✦</b><span><strong>AI 学习顾问</strong><small>数学进度落后 8%，今晚补 30 分钟积分专项。</small></span><em>去聊聊 ↗</em></button>
      </main>
    </section>
  `;
}
