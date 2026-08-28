/**
 * 刷题容器骨架：历年真题（整卷）与专项练习（组卷）共用同一套 DOM 结构，
 * 由 app.js 的刷题引擎按 scope 定位并驱动。
 */
export function renderQuizPanel(subject, { startTitle = '', startHint = '', startIcon = '📝' } = {}) {
  return `
    <div class="exam-quiz-container" data-subject="${subject}">
      <div class="exam-quiz-start">
        <div class="exam-quiz-start-icon">${startIcon}</div>
        <strong>${startTitle}</strong>
        <small>${startHint}</small>
        <button type="button" class="exam-start-btn" data-action="start-quiz">开始作答</button>
      </div>
      <div class="exam-quiz-active hidden">
        <div class="exam-quiz-progress">
          <div class="exam-quiz-progress-bar"><i style="width:0%"></i></div>
          <span class="exam-quiz-counter">0 / 0</span>
        </div>
        <div class="exam-quiz-navigator"></div>
        <div class="exam-quiz-question"></div>
        <div class="exam-quiz-options"></div>
        <div class="exam-quiz-reveal hidden">
          <button type="button" class="exam-reveal-btn" data-action="reveal-solution">查看解析</button>
        </div>
        <div class="exam-quiz-feedback hidden"></div>
        <div class="exam-quiz-nav-row">
          <button type="button" class="exam-quiz-prev hidden" data-action="prev-question">‹ 上一题</button>
          <button type="button" class="exam-quiz-next hidden" data-action="next-question">下一题 ›</button>
        </div>
      </div>
      <div class="exam-quiz-summary hidden">
        <div class="exam-quiz-summary-icon"></div>
        <strong class="exam-quiz-summary-title"></strong>
        <small class="exam-quiz-summary-detail"></small>
        <div class="exam-quiz-summary-actions">
          <button type="button" class="exam-start-btn" data-action="retry-quiz">重新作答</button>
          <button type="button" class="exam-start-btn is-outline" data-action="review-mistakes">查看错题</button>
        </div>
      </div>
    </div>
  `;
}
