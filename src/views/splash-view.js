export function splashView() {
  return `<div id="splashScreen"><img src="splash.png" alt="" id="splashImg"><button id="splashSkipBtn" type="button">跳过 ›</button></div>`;
}

export function initSplashScreen() {
  const splash = document.getElementById('splashScreen');
  if (!splash || sessionStorage.getItem('_splash_shown')) {
    if (splash) splash.style.display = 'none';
    return;
  }
  sessionStorage.setItem('_splash_shown', '1');
  document.getElementById('splashSkipBtn').addEventListener('click', () => { splash.style.display = 'none'; });
  splash.addEventListener('animationend', () => { splash.style.display = 'none'; });
}
