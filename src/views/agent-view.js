export function agentView() {
  return `
    <section id="agentChatScreen" class="app-screen agent-screen" aria-label="AI 考研复习规划教练">
      <header class="agent-topbar">
        <button id="agentChatBackBtn" class="agent-round-btn" type="button" aria-label="返回备考">←</button>
        <div><h1>考研复习规划教练</h1><p id="agentChatStatus">登录后同步云端学习数据</p></div>
        <button class="agent-round-btn" type="button" aria-label="更多操作">•••</button>
      </header>
      <main class="agent-main">
        <section class="agent-context"><div><b>教练正在结合你的云端数据给建议</b><small>登录后同步</small></div><p><span>近 30 天 —</span><span>— 条学习记录</span><span>暂未记录</span></p></section>
        <div id="agentMessages" class="agent-messages" aria-live="polite">
          <article class="agent-message is-assistant"><i>✦</i><p>登录后可以开始一段会保存到云端的考研规划对话。</p></article>
        </div>
        <p class="agent-quick-label">从这里开始</p>
        <div class="agent-quick-actions"><button type="button" data-agent-prompt="请帮我建立考研备考档案，并告诉我还需要补充哪些信息。" data-agent-proposal-type="study">建立备考档案</button><button type="button" data-agent-prompt="请结合我的学习记录，帮我做一次本周复盘。" data-agent-proposal-type="study">本周复盘</button><button type="button" data-agent-prompt="请结合我的云端计划和收藏院校，给出报考方案建议。" data-agent-proposal-type="admission">择校建议</button></div>
        <form id="agentChatForm" class="agent-composer"><input id="agentChatInput" maxlength="300" placeholder="例如：我还有 180 天，数学基础较弱…" aria-label="输入给考研复习规划教练的问题"><button type="submit" aria-label="发送消息">↑</button></form>
        <p class="agent-disclaimer">建议基于已同步数据生成；招生政策请以院校官网和研招网为准。</p>
      </main>
    </section>
    <section id="agentProposalScreen" class="app-screen agent-screen" aria-label="AI 学习计划提案">
      <header class="agent-topbar">
        <button id="agentProposalBackBtn" class="agent-round-btn" type="button" aria-label="返回对话">←</button>
        <div><h1>考研复习规划教练</h1><p>基于你的备考数据给出建议</p></div>
        <span id="agentStatus" class="agent-status">✦ 待同步</span>
      </header>
      <main class="agent-main">
        <section class="agent-week-summary"><div><small>近 7 天云端数据</small><h2 id="agentWeekHeadline">登录后生成个性化建议</h2></div><span id="agentWeekRange">等待同步</span><dl><div><dt>学习时长</dt><dd id="agentWeekStudyTime">—</dd><small id="agentWeekStudyMeta">登录后同步</small></div><div><dt>学习记录</dt><dd id="agentWeekSessionCount">—</dd><small id="agentWeekSessionMeta">等待同步</small></div><div><dt>投入最多</dt><dd id="agentWeekPriority">—</dd><small id="agentWeekPriorityMeta">暂无数据</small></div></dl></section>
        <button id="agentOpenChatBtn" class="agent-consult-entry" type="button"><i>✦</i><span><b>考研复习规划教练</b><small>先补齐目标，再生成周计划与复盘建议</small></span><em>去聊聊 ↗</em></button>
        <section class="agent-proposal-card"><header><div><h2 id="agentProposalTitle">下周学习计划</h2><p id="agentProposalMeta">生成后会先等待你的确认</p></div><b id="agentProposalBadge">待生成</b></header><p id="agentProposalRationale" class="agent-proposal-rationale">先和 AI 顾问聊聊，再主动生成一份可确认、可同步的计划。</p><div id="agentPlanItems" class="agent-plan-items"></div></section>
        <div class="agent-proposal-actions"><button id="agentApplyProposalBtn" class="agent-apply-btn" type="button">✓ 应用这份计划</button><button id="agentAdjustProposalBtn" class="agent-adjust-btn" type="button">调整后再应用</button></div>
        <p class="agent-disclaimer">应用后将同步更新备考页；你可以随时手动编辑。</p>
      </main>
    </section>
  `;
}
