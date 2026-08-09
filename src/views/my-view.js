export function myView() {
  return `
    <section id="myScreen" class="app-screen my-screen" aria-label="我的">
      <header class="my-profile-head"><span id="myProfileAvatar">♙</span><div><h1 id="myProfileName">未登录</h1><p id="myProfileMeta">登录后同步你的备考数据</p></div><button id="myEditTargetBtn" type="button" aria-label="设置">⚙</button></header>
      <main class="study-main my-main">
        <section id="myAuthCard" class="my-auth-card" aria-label="账号与云端同步" data-auth-state="signed-out">
          <div class="my-auth-copy">
            <span class="my-auth-eyebrow">账号与云端同步</span>
            <strong id="myAuthTitle">登录后，学习数据不会丢</strong>
            <small id="myAuthDescription">跨设备同步目标院校、学习计划与 AI 建议。</small>
          </div>
          <div class="my-auth-actions">
            <button id="myOpenAuthBtn" class="my-auth-open-btn" type="button" aria-controls="myAuthForm">登录 / 注册</button>
            <button id="myLogoutBtn" class="my-auth-logout-btn" type="button" hidden>退出登录</button>
          </div>
          <form id="myAuthForm" class="my-auth-form hidden" data-mode="register" aria-describedby="myAuthStatus myAuthError">
            <div class="my-auth-form-heading">
              <div>
                <span class="my-auth-form-kicker">安全同步账号</span>
                <strong class="my-auth-mode-title my-auth-mode-title-register">创建你的备考账号</strong>
                <strong class="my-auth-mode-title my-auth-mode-title-login">欢迎回来</strong>
              </div>
              <span class="my-auth-security-mark" aria-label="账号数据加密保护">加密保护</span>
            </div>
            <p id="myAuthStatus" class="my-auth-status" role="status" aria-live="polite">使用昵称和密码登录；注册后即可同步学习数据。</p>
            <div class="my-auth-fields">
              <label class="my-auth-field" for="myAuthNameInput">
                <span class="my-auth-field-label">昵称 / 用户名</span>
                <input id="myAuthNameInput" name="username" type="text" minlength="2" maxlength="32" autocomplete="username" spellcheck="false" placeholder="例如：小研同学" aria-describedby="myAuthUsernameHint myAuthError" required>
                <small id="myAuthUsernameHint" class="my-auth-field-hint">2–32 位中文、字母、数字、下划线或连字符</small>
              </label>
              <label class="my-auth-field" for="myAuthPasswordInput">
                <span class="my-auth-field-label">密码</span>
                <input id="myAuthPasswordInput" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="至少 8 位" aria-describedby="myAuthPasswordHint myAuthError" required>
                <small id="myAuthPasswordHint" class="my-auth-field-hint">请设置 8–128 位密码</small>
              </label>
              <label id="myAuthEmailRow" class="my-auth-field my-auth-email-field" for="myAuthAccountInput">
                <span class="my-auth-field-label">邮箱 <em>可选</em></span>
                <input id="myAuthAccountInput" name="email" type="email" maxlength="120" autocomplete="email" inputmode="email" placeholder="用于找回账号与接收提醒" aria-describedby="myAuthEmailHint myAuthError">
                <small id="myAuthEmailHint" class="my-auth-field-hint">仅用于账号服务，不会公开展示</small>
              </label>
            </div>
            <p id="myAuthError" class="my-auth-error" role="alert" aria-live="assertive" aria-atomic="true" hidden></p>
            <div class="my-auth-form-actions">
              <button id="myAuthSubmitBtn" class="my-auth-submit-btn" type="submit" data-loading-text="注册中…">注册并登录</button>
              <button id="myAuthSwitchBtn" class="my-auth-switch-btn" type="button">已有账号，去登录</button>
            </div>
            <button id="myCloseAuthBtn" class="my-auth-close-btn" type="button">暂不登录，先浏览</button>
          </form>
        </section>
        <section class="my-target-snapshot" aria-label="报考方案"><div><small id="myTargetPlanLabel">本机目标档案</small><strong id="myTargetUniversity">北京邮电大学 · 软件工程</strong><p><span id="myTargetScore">365</span> 分 <i id="myTargetDegree">学硕</i> · <i id="myTargetCategory">工学</i></p></div><b id="myTargetPlanCode">083500</b></section>
        <section class="my-favorites-section" aria-labelledby="myFavoritesTitle">
          <header class="my-favorites-heading"><div><small>云端收藏</small><h2 id="myFavoritesTitle">收藏院校 <b id="myFavCount">0</b></h2></div><span id="myFavSyncStatus">登录后同步</span></header>
          <div id="myFavList" class="my-favorites-list"><p id="myFavEmpty" class="my-favorites-empty">登录后可跨设备保存收藏院校。</p></div>
        </section>
        <section class="my-week-card"><small>本周学习</small><div><strong id="myWeekStudyTime">—</strong><em id="myWeekDailyAverage">登录后同步</em></div><div class="my-bars" aria-label="学习趋势"><i></i><i></i><i></i><i></i><i></i><i class="active"></i><i></i></div></section>
        <section class="my-metric-grid"><span><b id="myWeekSessionCount">—</b><small>本周记录</small></span><span><b id="myPlanSyncStatus">未同步</b><small>计划状态</small></span><span><b id="myTodayStudyTime">—</b><small>今日学习</small></span></section>
        <section class="my-subject-section"><h2>学科投入</h2><div id="mySubjectList" class="my-subject-list"><p><span>登录后</span><i><b style="width:0%"></b></i><em>—</em></p></div></section>
        <section class="my-quick-grid" aria-label="个人功能"><button id="myOpenDataBtn" type="button"><b>⌂</b><span>目标院校</span></button><button id="myExportBtn" type="button"><b>▥</b><span>学习报告</span></button><button id="myShareBtn" type="button"><b>♧</b><span>分享应用</span></button><button id="myFeedbackBtn" type="button"><b>◌</b><span>通知</span></button></section>
        <section class="my-demo-note" aria-label="数据同步状态"><b>✦</b><span><strong id="myDataSourceTitle">云端数据待连接</strong><small id="myDataSourceText">登录后，学习记录、计划与 AI 建议会同步到你的账号。</small></span><button id="themeToggleBtn" type="button">☾ 夜间</button></section>
        <div class="my-data-compat" aria-hidden="true"><div id="myHistoryList"><div id="myHistoryEmpty"></div></div><button id="myClearHistoryBtn" type="button"></button><button id="myOpenDataBtn2" type="button"></button></div>
      </main>
    </section>
  `;
}
