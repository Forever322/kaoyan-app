export function resultsView() {
  return `
    <section id="resultsScreen" class="app-screen results-screen" aria-label="匹配结果">
      <header class="screen-topbar">
        <button id="resultsBackBtn" class="round-nav-btn" type="button" aria-label="返回首页">←</button>
        <h1>匹配结果</h1>
        <button id="resultsFilterBtn" class="round-nav-btn is-lime" type="button" aria-label="调整筛选">☷</button>
      </header>
      <main id="resultsSection" class="results-main" aria-live="polite">
        <button id="resultContext" class="result-context" type="button" aria-label="修改匹配条件"></button>
        <div class="results-title-row"><h2><strong id="resultCountNumber">0</strong> 所匹配院校</h2><select id="sortSelect" class="result-sort-select" aria-label="排序方式"><option value="default">综合排序</option><option value="level">院校层次</option><option value="match">匹配度</option></select></div>
        <section id="resultsNationalLine" class="results-national-line" aria-live="polite"></section>
        <div id="resultInsights" class="result-insights"></div>
        <div id="resultsList" class="results-list"></div>
      </main>
    </section>
  `;
}
