export function filterView() {
  return `
    <div id="filterSheet" class="filter-sheet hidden" aria-hidden="true">
      <button id="filterSheetBackdrop" class="filter-sheet-backdrop" type="button" aria-label="关闭筛选器"></button>
      <div class="filter-context-copy" aria-hidden="true"><h1>考研择校</h1><p>输入分数，找到合适的院校</p></div>
      <section class="filter-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="filterSheetTitle">
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="sheet-heading"><h2 id="filterSheetTitle"><i>☷</i> 筛选与搜索</h2><button id="closeFilterSheetBtn" class="sheet-close" type="button" aria-label="关闭">×</button></div>

        <label class="sheet-search-box"><i>⌕</i><input id="sheetUniSearch" type="search" placeholder="搜索院校、城市或省份"></label>
        <div id="sheetSearchMatches" class="sheet-search-matches" aria-live="polite"></div>
        <button id="sheetQuickUniversity" class="sheet-quick-university" type="button" data-uni-name="清华大学"><span>♜ 清华大学 · 985 · 北京</span><b>查看 ›</b></button>

        <p class="sheet-subhead">匹配条件</p>
        <label class="sheet-control-row"><span><i>▣</i> 初试总分</span><input id="sheetScoreInput" type="number" min="0" max="500" placeholder="378" aria-label="初试总分"></label>
        <div class="sheet-option-section">
          <span class="sheet-option-label"><i>♧</i> 学位类型</span>
          <div id="sheetDegreeOptions" class="sheet-option-grid sheet-degree-options" role="radiogroup" aria-label="学位类型">
            <button type="button" data-value="xueshuo" role="radio">学硕</button>
            <button type="button" data-value="zhuanshuo" role="radio">专硕</button>
          </div>
          <select id="sheetDegreeSelect" class="sheet-select-source" tabindex="-1" aria-hidden="true"><option value="xueshuo">学硕</option><option value="zhuanshuo">专硕</option></select>
        </div>
        <div class="sheet-option-section">
          <span class="sheet-option-label"><i>♙</i> 学科门类</span>
          <div id="sheetCategoryOptions" class="sheet-option-grid sheet-category-options" role="radiogroup" aria-label="学科门类"></div>
          <select id="sheetCategorySelect" class="sheet-select-source" tabindex="-1" aria-hidden="true"></select>
        </div>
        <div class="sheet-option-section sheet-province-section">
          <div class="sheet-option-heading"><span class="sheet-option-label"><i>⌖</i> 省份筛选</span><button id="sheetProvinceExpandBtn" class="sheet-option-expand" type="button" aria-expanded="false"><b id="sheetProvinceCurrent">全部省份</b><i>⌄</i></button></div>
          <div id="sheetProvinceOptions" class="sheet-option-grid sheet-province-options" role="radiogroup" aria-label="省份筛选"></div>
          <select id="sheetProvinceSelect" class="sheet-select-source" tabindex="-1" aria-hidden="true"></select>
        </div>
        <div id="sheetMajorRow" class="sheet-control-row sheet-advanced-control"><span><i>⌁</i> 专业方向</span><div id="sheetMajorSelectDisplay" class="sheet-major-dropdown"><div class="sheet-major-trigger" role="combobox" aria-expanded="false" aria-haspopup="listbox" aria-controls="sheetMajorPanel"><input type="text" class="sheet-major-input" autocomplete="off" readonly aria-label="专业方向"></div><div id="sheetMajorPanel" class="sheet-major-panel" role="listbox"></div></div><select id="sheetMajorSelect" class="sheet-select-source" tabindex="-1" aria-hidden="true"></select></div>

        <div class="sheet-choice-group"><span>招生分区</span><div id="sheetZoneToggle" class="sheet-choice-row"><button type="button" data-value="A">A 区</button><button type="button" data-value="B">B 区</button><button type="button" data-value="all">不限</button></div></div>
        <div class="sheet-choice-group"><span>培养方式</span><div id="sheetStudyModeToggle" class="sheet-choice-row"><button type="button" data-value="all">全部</button><button type="button" data-value="全日制">全日制</button><button type="button" data-value="非全日制">非全日制</button></div></div>

        <button id="applyFilterSheetBtn" class="home-match-btn sheet-apply" type="button"><span><b>刷新匹配结果</b><small id="sheetMatchCount">预计显示 32 所院校</small></span><i>→</i></button>
        <button id="openDataManagerBtn" class="sheet-data-manager" type="button"><span>▣</span> 管理本地院校数据与导入导出 <b>›</b></button>
      </section>
    </div>
  `;
}
