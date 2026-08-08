export function agentView() {
  return `
    <section id="agentChatScreen" class="app-screen agent-screen" aria-label="AI 学习顾问">
      <header class="agent-topbar">
        <button id="agentChatBackBtn" class="agent-round-btn" type="button" aria-label="返回备考">←</button>
        <div><h1>AI 学习顾问</h1><p>在线 · 已读取本周数据</p></div>
        <button class="agent-round-btn" type="button" aria-label="更多操作">•••</button>
      </header>
      <main class="agent-main">
        <section class="agent-context"><div><b>我正在结合你的数据给建议</b><small>刚刚更新</small></div><p><span>本周 42h</span><span>完成率 76%</span><span>数学待提升</span></p></section>
        <div id="agentMessages" class="agent-messages" aria-live="polite">
          <article class="agent-message is-assistant"><i>✦</i><p>你好，我是你的考研学习顾问。今天想先解决哪件事？</p></article>
          <article class="agent-message is-user"><p>我数学刚结束基础，英语阅读正确率 60%，下周怎么安排？</p></article>
          <article class="agent-message is-assistant"><i>✦</i><div><p>建议把数学放在每天精力最好的时段：4 天极限专项 + 2 天真题回顾；英语阅读每天 2 篇，错题当天复盘。</p><button id="agentPlanLink" type="button">查看计划提案 ↗</button></div></article>
        </div>
        <p class="agent-quick-label">继续问问</p>
        <div class="agent-quick-actions"><button type="button" data-agent-prompt="请分析我最近的错题重点">分析错题</button><button type="button" data-agent-prompt="请帮我调整下周学习计划">调整计划</button><button type="button" data-agent-prompt="请结合我的成绩给择校建议">择校建议</button></div>
        <form id="agentChatForm" class="agent-composer"><input id="agentChatInput" maxlength="300" placeholder="输入你的问题…" aria-label="输入给 AI 学习顾问的问题"><button type="submit" aria-label="发送消息">↑</button></form>
        <p class="agent-disclaimer">AI 建议仅供参考，应用前可随时调整。</p>
      </main>
    </section>
    <section id="agentProposalScreen" class="app-screen agent-screen" aria-label="AI 学习计划提案">
      <header class="agent-topbar">
        <button id="agentProposalBackBtn" class="agent-round-btn" type="button" aria-label="返回对话">←</button>
        <div><h1>AI 学习顾问</h1><p>基于你的备考数据给出建议</p></div>
        <span class="agent-status">✦ 已分析</span>
      </header>
      <main class="agent-main">
        <section class="agent-week-summary"><div><small>本周复盘</small><h2>你的节奏正在稳定提升</h2></div><span>8.05 — 8.11</span><dl><div><dt>学习时长</dt><dd>42h</dd><small>较上周 +4h</small></div><div><dt>完成率</dt><dd>76%</dd><small>已完成 19 项</small></div><div><dt>优先突破</dt><dd>极限</dd><small>正确率 62%</small></div></dl></section>
        <button id="agentOpenChatBtn" class="agent-consult-entry" type="button"><i>✦</i><span><b>考研学习顾问</b><small>聊聊你的学习节奏与报考想法</small></span><em>去聊聊 ↗</em></button>
        <section class="agent-proposal-card"><header><div><h2>下周学习计划</h2><p>8 月 12 日 — 8 月 18 日 · 共 46 小时</p></div><b>待确认</b></header><div id="agentPlanItems" class="agent-plan-items"></div></section>
        <div class="agent-proposal-actions"><button id="agentApplyProposalBtn" class="agent-apply-btn" type="button">✓ 应用这份计划</button><button id="agentAdjustProposalBtn" class="agent-adjust-btn" type="button">调整后再应用</button></div>
        <p class="agent-disclaimer">应用后将同步更新备考页；你可以随时手动编辑。</p>
      </main>
    </section>
  `;
}
