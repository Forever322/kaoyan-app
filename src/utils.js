// DOM 工具函数

/** 获取元素 */
export const $ = (id) => document.getElementById(id);

/** 切换 active 类 */
export function toggleActive(container, activeEl) {
  container.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
  activeEl.classList.add('active');
}

/** 显示/隐藏元素 */
export function show(el) { el.style.display = ''; }
export function hide(el) { el.style.display = 'none'; }
export function showBlock(el) { el.style.display = 'block'; }
export function showFlex(el) { el.style.display = 'flex'; }

/** 抖动动画 */
export function shakeElement(el) {
  el.style.animation = 'none';
  el.offsetHeight; // 强制回流
  el.style.animation = 'shake 0.4s ease';
  setTimeout(() => { el.style.animation = ''; }, 400);
}

// 注入抖动动画样式
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(8px); }
    60% { transform: translateX(-6px); }
    80% { transform: translateX(6px); }
  }
`;
document.head.appendChild(shakeStyle);
