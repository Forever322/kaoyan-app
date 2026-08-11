import { STUDY_CALENDAR, SUBJECT_STRATEGIES } from '../data/study-guide.js';

function renderStageTimeline() {
  return STUDY_CALENDAR.stages.filter(s => s.id !== 'stage0' && s.id !== 'stage5').map(s => {
    const subjects = s.dailyPlan ? s.dailyPlan.map(d =>
      `<span class="tl-subject"><b>${d.subject}</b>${d.task}</span>`
    ).join('') : '';
    return `<div class="tl-stage"><div class="tl-period">${s.period}</div><strong>${s.title.replace(/^阶段 \d：/, '')}</strong>${subjects}</div>`;
  }).join('');
}

function renderSubjectCards() {
  const keys = ['politics', 'english', 'math', 'major'];
  return keys.map(k => {
    const s = SUBJECT_STRATEGIES[k];
    const tip = s.coreStrategy || s.dataCollection?.priority?.[0] || s.threeRounds?.[0]?.action || '';
    return `<button class="subject-card" type="button" data-subject="${k}"><i>${s.name[0]}</i><span><strong>${s.name}</strong><small>满分 ${s.fullScore} 分</small></span><em>${tip.slice(0, 32)}…</em></button>`;
  }).join('');
}

export function prepView() {
  return `
    <section id="prepScreen" class="app-screen prep-screen" aria-label="备考">
      <header class="study-topbar"><div><h1>备考</h1><p>计划、专注与复习节奏</p></div><button id="prepSettingsBtn" class="study-icon-btn" type="button" aria-label="备考设置">⚙</button></header>
      <main class="study-main">
        <section class="prep-countdown-card" aria-label="初试倒计时">
          <div><span>距离 <span id="prepExamYear">—</span> 考研</span><strong id="prepDaysLeft">—</strong><em>天</em></div>
          <b id="prepStage">待确认计划</b>
          <p>本周任务 <i id="prepWeekProgress">—</i><small><u></u></small></p>
        </section>
        <section class="today-action-card" aria-labelledby="todayActionTitle">
          <div class="today-action-head"><div><h2 id="todayActionTitle">今天该干什么</h2><small id="prepNextMilestone">登录后根据计划同步节点</small></div><b id="prepCompletionRate">—</b></div>
          <div class="today-metrics"><span><small>今日学习</small><strong id="prepStudyTime">登录后同步 / 8h</strong></span><span><small>任务完成</small><strong id="prepTaskProgress">—</strong></span></div>
          <div class="today-actions"><button id="startStudyBtn" type="button">▷ 开始学习</button><button id="dailyCheckinBtn" type="button" title="当前仅保存在本机">✓ 本机打卡</button></div>
          <p>✦ 完成今天，比计划明天更重要。</p>
        </section>
        <section class="prep-shortcuts" aria-label="备考功能"><button type="button"><i>▣</i><strong>计划</strong><small>年 / 月 / 周</small></button><button id="openTimerBtn" class="is-dark" type="button"><i>◷</i><strong>计时</strong><small>开始专注</small></button><button type="button"><i>文</i><strong>单词</strong><small>待接入词库</small></button></section>
        <section class="study-section prep-tasks-section" aria-labelledby="prepTasksTitle"><div class="study-section-heading"><h2 id="prepTasksTitle">今日任务</h2><button type="button">管理计划</button></div><div id="prepTaskList" class="prep-task-list"><button class="prep-task" type="button" data-task-id="english"><span class="prep-task-check"></span><span><small class="english-subject">英语</small><strong>核心词汇 200</strong></span><em>25分钟</em></button><button class="prep-task is-complete" type="button" data-task-id="math"><span class="prep-task-check">✓</span><span><small class="math-subject">数学</small><strong>高数强化 · 多元积分</strong></span><em>120分钟</em></button><button class="prep-task" type="button" data-task-id="politics"><span class="prep-task-check"></span><span><small class="politics-subject">政治</small><strong>肖1000 · 60题</strong></span><em>45分钟</em></button><button class="prep-task" type="button" data-task-id="major"><span class="prep-task-check"></span><span><small class="major-subject">专业课</small><strong>数据结构 · 图</strong></span><em>90分钟</em></button></div></section>
        <section class="study-section prep-guide-section" aria-labelledby="prepGuideTitle"><div class="study-section-heading"><h2 id="prepGuideTitle">四科复习策略</h2></div><div id="prepSubjectCards" class="subject-card-grid">${renderSubjectCards()}</div></section>
        <section class="study-section prep-timeline-section" aria-labelledby="prepTimelineTitle"><div class="study-section-heading"><h2 id="prepTimelineTitle">6 阶段备考日历</h2></div><div id="prepTimeline" class="prep-timeline">${renderStageTimeline()}</div></section>
        <button id="prepStatsBtn" class="study-ai-tip study-ai-entry" type="button"><b>✦</b><span><strong>AI 学习顾问</strong><small>登录后会结合你的学习记录与计划给出建议。</small></span><em>去聊聊 ↗</em></button>
      </main>
    </section>
  `;
}
