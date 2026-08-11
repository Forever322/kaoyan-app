import { SUBJECT_MATCH_LABELS, PRIORITY_LEVELS, TIAOJI_FIELDS } from '../data/tiaoji-guide.js';

function renderTiaojiGuidance() {
  const matchLabels = Object.values(SUBJECT_MATCH_LABELS);
  const priorityExec = PRIORITY_LEVELS.exec || {};
  const fields = TIAOJI_FIELDS.slice(0, 8);
  return `
    <section class="tiaoji-guidance" aria-labelledby="tiaojiTitle" style="margin-top:16px;">
      <div class="study-section-heading"><h2 id="tiaojiTitle">调剂行动指南</h2></div>
      <div class="tiaoji-match-legend" style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;">
        ${matchLabels.map(l => `<span style="font-size:.6rem;padding:4px 8px;border-radius:10px;background:#f2f5f2;color:#000000;">${l.icon} ${l.key}：${l.desc.slice(0, 24)}…</span>`).join('')}
      </div>
      <div class="tiaoji-fields-checklist" style="font-size:.62rem;color:#000000;line-height:1.8;">
        <strong style="font-size:.68rem;">信息收集清单</strong>
        <div>${fields.map(f => `<span style="display:inline-block;margin:2px 8px 2px 0;">☐ ${f.label}</span>`).join('')}</div>
      </div>
      <div class="tiaoji-priority" style="margin-top:10px;font-size:.58rem;color:#000000;line-height:1.7;">
        <strong style="font-size:.65rem;">执行优先级</strong>
        ${Object.entries(priorityExec).map(([k, v]) =>
          `<div style="margin:2px 0;">${v.label} — ${v.desc}</div>`
        ).join('')}
      </div>
    </section>`;
}

export function failView() {
  return `
    <section id="failScreen" class="app-screen fail-screen" aria-label="国家线提醒">
      <header class="screen-topbar">
        <button id="failBackBtn" class="round-nav-btn" type="button" aria-label="返回首页">←</button>
        <h1>国家线提醒</h1>
        <span class="screen-topbar-meta" id="failFilterMeta">学硕 · 工学</span>
      </header>
      <main class="fail-main">
        <section class="fail-hero" id="failState">
          <div class="fail-hero-top"><span id="failLineLabel">A 区工学国家线为 254 分</span><b id="failDiffBadge">差 6 分</b></div>
          <strong id="failScoreValue">248</strong><em>分</em>
          <p id="failMsg">别急，切换 B 区后仍有机会进入匹配池。</p>
        </section>
        <div class="fail-section-title"><h2>分区再判断</h2><span>同一专业 · 2026 年</span></div>
        <div id="failComparison" class="fail-comparison"></div>
        <button id="tryBZoneBtn" class="home-match-btn fail-match-btn" type="button"><span><b>切换至 B 区匹配</b><small id="failBZoneCount">院校等待加入你的歌单</small></span><i>→</i></button>
        <section class="fail-options"><h3>你还可以这样做</h3><ul><li>查看 B 区院校的城市与专业覆盖</li><li>修改专业方向，重新计算国家线</li><li>保存本次条件，作为调剂备选</li></ul></section>
        ${renderTiaojiGuidance()}
      </main>
    </section>
  `;
}
