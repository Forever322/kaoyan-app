// DOM 工具函数

/** 获取元素 */
export const $ = (id) => document.getElementById(id);

/** HTML 转义，防止 XSS */
export function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 防抖：延迟执行，重复调用时重置计时器 */
export function debounce(fn, delay = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** 切换 active 类 */
export function toggleActive(container, activeEl) {
  container.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
  activeEl.classList.add('active');
}

/** 显示/隐藏元素 */
export function show(el) {
  el.style.display = '';
}
export function hide(el) {
  el.style.display = 'none';
}
export function showBlock(el) {
  el.style.display = 'block';
}
export function showFlex(el) {
  el.style.display = 'flex';
}

/** 抖动动画（首次调用时注入 keyframes） */
let _shakeInjected = false;
function ensureShakeKeyframes() {
  if (_shakeInjected || typeof document === 'undefined') return;
  _shakeInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-8px); }
      40% { transform: translateX(8px); }
      60% { transform: translateX(-6px); }
      80% { transform: translateX(6px); }
    }
  `;
  document.head.appendChild(style);
}

export function shakeElement(el) {
  ensureShakeKeyframes();
  el.style.animation = 'none';
  el.offsetHeight; // 强制回流
  el.style.animation = 'shake 0.4s ease';
  setTimeout(() => {
    el.style.animation = '';
  }, 400);
}
