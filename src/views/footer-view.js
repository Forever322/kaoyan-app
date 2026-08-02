export function footerView() {
  return `
    <footer class="app-footer" aria-label="主导航">
      <span class="footer-active-pill" aria-hidden="true"></span>
      <button id="homeNavBtn" class="footer-btn footer-nav-btn active" type="button"><b>⌂</b><span>为你推荐</span></button>
      <button id="openFilterNavBtn" class="footer-btn footer-nav-btn" type="button"><b>⌕</b><span>院校库</span></button>
      <button id="prepNavBtn" class="footer-btn footer-nav-btn" type="button"><b>▤</b><span>备考</span></button>
      <button id="profileNavBtn" class="footer-btn footer-nav-btn" type="button"><b>♙</b><span>我的</span></button>
    </footer>
  `;
}
