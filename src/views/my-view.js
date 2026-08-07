export function myView() {
  return `
    <section id="myScreen" class="app-screen my-screen" aria-label="我的">
      <header class="my-topbar">
        <div>
          <span class="my-kicker">2026 · 研考</span>
          <h1>我的</h1>
        </div>
      </header>

      <main class="my-main">
        <!-- 目标分数卡片 -->
        <section class="my-card my-target-card" aria-label="目标分数">
          <div class="my-card-icon">🎯</div>
          <div class="my-card-body">
            <span class="my-card-label">目标总分</span>
            <div class="my-target-row">
              <strong id="myTargetScore">--</strong>
              <span>分</span>
            </div>
            <div class="my-target-meta">
              <span id="myTargetDegree">学硕</span>
              <span class="my-target-sep">·</span>
              <span id="myTargetCategory">工学</span>
            </div>
          </div>
          <button id="myEditTargetBtn" class="my-icon-btn" type="button" aria-label="编辑目标" title="编辑目标">✎</button>
        </section>

        <!-- 收藏院校 -->
        <section class="my-section" aria-labelledby="myFavTitle">
          <div class="my-section-heading">
            <h2 id="myFavTitle">★ 收藏院校</h2>
            <span id="myFavCount" class="my-count">0</span>
          </div>
          <div id="myFavList" class="my-list">
            <div class="my-empty" id="myFavEmpty">
              <span>还没有收藏院校</span>
              <small>在院校详情页点击 ☆ 即可收藏</small>
            </div>
          </div>
        </section>

        <!-- 浏览历史 -->
        <section class="my-section" aria-labelledby="myHistoryTitle">
          <div class="my-section-heading">
            <h2 id="myHistoryTitle">◷ 最近浏览</h2>
            <button id="myClearHistoryBtn" class="my-text-btn" type="button">清空</button>
          </div>
          <div id="myHistoryList" class="my-list">
            <div class="my-empty" id="myHistoryEmpty">
              <span>暂无浏览记录</span>
              <small>浏览院校详情后会显示在这里</small>
            </div>
          </div>
        </section>

        <!-- 快捷入口 -->
        <section class="my-section" aria-labelledby="myQuickTitle">
          <div class="my-section-heading">
            <h2 id="myQuickTitle">⚡ 快捷操作</h2>
          </div>
          <div class="my-quick-grid">
            <button id="myOpenDataBtn" class="my-quick-card" type="button">
              <span class="my-quick-icon">📋</span>
              <strong>数据管理</strong>
              <small>导入/导出/自定义院校</small>
            </button>
            <button id="myExportBtn" class="my-quick-card" type="button">
              <span class="my-quick-icon">📤</span>
              <strong>导出数据</strong>
              <small>备份收藏与设置</small>
            </button>
            <button id="myShareBtn" class="my-quick-card" type="button">
              <span class="my-quick-icon">🔗</span>
              <strong>分享给研友</strong>
              <small>复制链接发送给好友</small>
            </button>
            <button id="myFeedbackBtn" class="my-quick-card" type="button">
              <span class="my-quick-icon">💬</span>
              <strong>反馈建议</strong>
              <small>帮助我们改进产品</small>
            </button>
          </div>
        </section>

        <footer class="my-footer">
          <p>考研择校助手 v4.3</p>
          <small>数据来源：研招网及各校官网</small>
        </footer>
      </main>
    </section>
  `;
}
