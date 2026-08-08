export function myView() {
  return `
    <section id="myScreen" class="app-screen my-screen" aria-label="我的">
      <header class="my-profile-head"><span>♙</span><div><h1>小研同学</h1><p>2027 · 北邮软件工程</p></div><button id="myEditTargetBtn" type="button" aria-label="设置">⚙</button></header>
      <main class="study-main my-main">
        <section class="my-target-snapshot" aria-label="模拟目标档案"><div><small>模拟目标档案</small><strong>北京邮电大学 · 软件工程</strong><p><span id="myTargetScore">365</span> 分 <i id="myTargetDegree">学硕</i> · <i id="myTargetCategory">工学</i></p></div><b>083500</b></section>
        <section class="my-week-card"><small>本周学习</small><div><strong>52h 31min</strong><em>日均 7h 30m</em></div><div class="my-bars" aria-label="学习趋势"><i></i><i></i><i></i><i></i><i></i><i class="active"></i><i></i></div></section>
        <section class="my-metric-grid"><span><b>28 天</b><small>连续学习</small></span><span><b>87%</b><small>任务完成率</small></span><span><b>486h</b><small>总学习时长</small></span></section>
        <section class="my-subject-section"><h2>学科投入</h2><div class="my-subject-list"><p><span>数学</span><i><b style="width:73%"></b></i><em>21h</em></p><p><span>英语</span><i><b style="width:52%"></b></i><em>15h</em></p><p><span>专业课</span><i><b style="width:38%"></b></i><em>11h</em></p><p><span>政治</span><i><b style="width:18%"></b></i><em>5h</em></p></div></section>
        <section class="my-quick-grid" aria-label="个人功能"><button id="myOpenDataBtn" type="button"><b>⌂</b><span>目标院校</span></button><button id="myExportBtn" type="button"><b>▥</b><span>学习报告</span></button><button id="myShareBtn" type="button"><b>♧</b><span>收藏</span></button><button id="myFeedbackBtn" type="button"><b>◌</b><span>通知</span></button></section>
        <section class="my-demo-note" aria-label="模拟数据说明"><b>✦</b><span><strong>模拟学习数据</strong><small>完成目标设置与学习记录后，这些数据会自动更新。</small></span><button id="themeToggleBtn" type="button">☾ 夜间</button></section>
        <div class="my-data-compat" aria-hidden="true"><span id="myFavCount"></span><div id="myFavList"><div id="myFavEmpty"></div></div><div id="myHistoryList"><div id="myHistoryEmpty"></div></div><button id="myClearHistoryBtn" type="button"></button><button id="myOpenDataBtn2" type="button"></button></div>
      </main>
    </section>
  `;
}
