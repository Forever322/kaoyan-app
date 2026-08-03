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
      </main>
    </section>
  `;
}
