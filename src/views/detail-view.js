export function detailView() {
  return `
    <div class="detail-overlay hidden" id="detailPage">
      <div class="detail-content">
        <div class="detail-hero" id="detailHero">
          <button class="detail-back" id="detailBackBtn" type="button" aria-label="返回">←</button>
          <button class="detail-photo-btn" id="detailPhotoBtn" type="button">◉ 校园实景</button>
          <div class="hero-content"><h2 id="detailName">院校名称</h2><div class="hero-badges" id="detailBadges"></div></div>
        </div>
        <section id="detailMatchSummary" class="detail-match-summary"></section>

        <section class="detail-section detail-score-section"><div class="detail-section-heading"><h3 class="detail-section-title"><i>♬</i> 录取节奏</h3><span class="section-note">近 4 年</span></div><div class="score-table-wrap"><table class="score-table"><thead><tr><th>年份</th><th>国家线</th><th>院校线</th><th>你的分数</th><th>差值</th></tr></thead><tbody id="detailScoreTable"></tbody></table></div><div class="detail-verdict" id="detailVerdict"></div></section>

        <section class="detail-section" id="detailRetestSection" style="display:none;"><div class="detail-section-heading"><h3 class="detail-section-title"><i>▣</i> 复试基础线</h3><span class="section-note">2026 年</span></div><p class="detail-nl-note">复试基本分数线参考（国家线 + 院校预估）</p><div class="retest-grid" id="detailRetestGrid"></div></section>

        <section class="detail-section detail-info-section"><div class="detail-section-heading"><h3 class="detail-section-title">院校档案</h3><span class="section-note">招生分区与位置</span></div><div class="detail-info-row" id="detailInfo"></div></section>

        <section class="detail-section"><div class="detail-section-heading"><h3 class="detail-section-title"><i>♧</i> 优势与不足</h3><span class="section-note">择校参考</span></div><div class="pros-cons-grid"><div class="pros-column"><h4>✓ 优势</h4><ul id="detailPros"></ul></div><div class="cons-column"><h4>△ 不足</h4><ul id="detailCons"></ul></div></div></section>

        <section class="detail-section detail-photos-section"><div class="detail-section-heading"><h3 class="detail-section-title"><i>▣</i> 校园风光</h3><span class="section-note">4 张美景 ›</span></div><div class="photo-grid" id="detailPhotos"></div></section>

        <section class="detail-section detail-about-section"><div class="detail-section-heading"><h3 class="detail-section-title"><i>⌂</i> 院校简介</h3><span class="section-note">Tsinghua University</span></div><p class="detail-features" id="detailFeatures"></p></section>
      </div>
    </div>
  `;
}
