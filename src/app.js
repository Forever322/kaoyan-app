// 考研择校助手 - 主应用逻辑

import { matchUniversities, sortResults, evaluateMatch } from './matcher.js';
import { initStorage, saveLastSearch, getLastSearch, exportAllData, getFavorites, toggleFavorite, isFavorite, getBrowseHistory, addBrowseHistory, clearBrowseHistory, getTargetScore, saveTargetScore } from './storage.js';
import { UNIVERSITIES, findUniversity } from './data/universities.js';
import { getAdmissionScores } from './data/admission-scores.js';
import { getCategories, hasSubMajors, getMajorsForCategory } from './data/national-lines.js';
import { escapeHtml, debounce } from './utils.js';
import { renderResults, renderMoreResults, renderNationalLine } from './render.js';
import {
  openEditModal as showModal,
  closeEditModal as hideModal,
  switchModalTab,
  renderUniEditList,
  handleAddUniversity,
  handleImport,
  handleDeleteUniversity,
} from './modal.js';
import { openDetailPage as showDetail, closeDetailPage as hideDetail } from './detail.js';
import { checkAndSeed } from './seed.js';
import { AgentApiError, applyAgentProposal, createAgentProposal } from './agent-api.js';

function bootstrapApp() {
  initStudyTheme();
  // 匹配与详情直接读取静态数据；先完成可交互页面，IndexedDB 在后台做本地离线备份。
  initStorage();
  initUI();
  bindEvents();
  restoreLastSearch();
  normalizeSearchState();
  initHistoryNav();
  updateHomeDashboard();

  initializeLocalDatabase();

  // 后台检查更新（不阻塞启动）
  checkForUpdate();
}

const STUDY_THEME_KEY = 'study_theme';

function initStudyTheme() {
  const theme = localStorage.getItem(STUDY_THEME_KEY) || 'day';
  document.body.dataset.studyTheme = theme;
  const button = document.getElementById('themeToggleBtn');
  if (button) button.textContent = theme === 'day' ? '☾ 夜间' : '☀ 白天';
}

function toggleStudyTheme() {
  const next = document.body.dataset.studyTheme === 'day' ? 'night' : 'day';
  document.body.dataset.studyTheme = next;
  localStorage.setItem(STUDY_THEME_KEY, next);
  const button = document.getElementById('themeToggleBtn');
  if (button) button.textContent = next === 'day' ? '☾ 夜间' : '☀ 白天';
}

async function initializeLocalDatabase() {
  try {
    const stats = await checkAndSeed();
    console.log('[App] DB ready:', stats);
  } catch (e) {
    console.warn('[App] DB init failed, using in-memory data:', e);
  }
}

// ==================== 全局状态 ====================
let currentDegree = 'xueshuo';
let currentZone = 'A';
let currentProvince = 'all';
let currentStudyMode = 'all';
let currentResults = [];
let _activeScreen = 'home';
let _detailReturnScreen = 'home';
let _filterCloseTimer;
let _footerOverlayIndex = null;
let activeAgentProposal = null;

const fallbackStudyProposal = {
  id: null,
  summary: '为你生成了一份聚焦数学薄弱项的下周计划。',
  rationale: '数学安排在每日精力最好的时段，英语阅读保持稳定训练。',
  changes: [{ operation: 'replace_study_plan', data: { items: [
    { subject: '数学', title: '极限专项 + 真题', hours: '16h', note: '优先补弱' },
    { subject: '英语', title: '阅读精练 + 单词复习', hours: '14h', note: '保持节奏' },
    { subject: '政治', title: '肖 1000 与错题回顾', hours: '8h', note: '巩固提升' },
  ] } }],
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp, { once: true });
} else {
  bootstrapApp();
}

// ==================== 导航封装 ====================
function setFooterPillPosition(position) {
  document.querySelector('.app-footer')?.style.setProperty('--nav-index', position);
}

function setFooterActiveIndex(index) {
  const buttons = [...document.querySelectorAll('.footer-nav-btn')];
  const safeIndex = Math.max(0, Math.min(buttons.length - 1, index));
  buttons.forEach((button, buttonIndex) => button.classList.toggle('active', buttonIndex === safeIndex));
  setFooterPillPosition(safeIndex);
}

function updateFooterNav(screen) {
  let activeNav = 'openFilterNavBtn';
  if (screen === 'home') activeNav = 'homeNavBtn';
  if (screen === 'prep') activeNav = 'prepNavBtn';
  if (screen === 'agentChat' || screen === 'agentProposal') activeNav = 'prepNavBtn';
  if (screen === 'practice') activeNav = 'practiceNavBtn';
  if (screen === 'my') activeNav = 'profileNavBtn';
  const buttons = [...document.querySelectorAll('.footer-nav-btn')];
  const activeIndex = Math.max(0, buttons.findIndex((button) => button.id === activeNav));
  setFooterActiveIndex(activeIndex);
}

function restoreFooterNavAfterOverlay() {
  if (_footerOverlayIndex === null) return;
  _footerOverlayIndex = null;
  updateFooterNav(_activeScreen);
}

function initializeFooterSlider() {
  const footer = document.querySelector('.app-footer');
  const buttons = [...document.querySelectorAll('.footer-nav-btn')];
  if (!footer || buttons.length === 0) return;

  let drag = null;
  let suppressNativeClick = false;

  const getPosition = (clientX, rect) => {
    const inset = 6;
    const slotWidth = (rect.width - inset * 2) / buttons.length;
    const rawPosition = (clientX - rect.left - inset - slotWidth / 2) / slotWidth;
    return Math.max(0, Math.min(buttons.length - 1, rawPosition));
  };

  const releasePointer = (event) => {
    if (footer.hasPointerCapture?.(event.pointerId)) footer.releasePointerCapture(event.pointerId);
  };

  footer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const currentIndex = Number.parseFloat(footer.style.getPropertyValue('--nav-index')) || 0;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      initialIndex: currentIndex,
      position: currentIndex,
      rect: footer.getBoundingClientRect(),
      moved: false,
    };
    footer.setPointerCapture?.(event.pointerId);
  });

  footer.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const travelled = Math.abs(event.clientX - drag.startX);
    if (travelled < 5 && !drag.moved) return;
    drag.moved = true;
    drag.position = getPosition(event.clientX, drag.rect);
    footer.classList.add('is-dragging');
    setFooterPillPosition(drag.position);
    event.preventDefault();
  });

  footer.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const completedDrag = drag;
    drag = null;
    releasePointer(event);
    footer.classList.remove('is-dragging');

    if (!completedDrag.moved) {
      // 简单点击（无拖拽）：setPointerCapture 使原生 click 落在 footer
      // 而非按钮上，需要手动查找按钮并触发
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const btn = target?.closest('.footer-nav-btn');
      if (btn) {
        const idx = buttons.indexOf(btn);
        if (idx >= 0) {
          setFooterActiveIndex(idx);
          btn.click();
          // pointer capture 后仍可能补发原生 click；拦截它以避免一次点击触发两轮导航。
          suppressNativeClick = true;
          window.setTimeout(() => { suppressNativeClick = false; }, 350);
        }
      }
      return;
    }

    const targetIndex = Math.round(completedDrag.position);
    setFooterActiveIndex(targetIndex);
    const targetButton = buttons[targetIndex];
    if (!targetButton) return;

    // 保留原有按钮逻辑；阻止手势结束后浏览器补发的一次原生 click。
    targetButton.click();
    suppressNativeClick = true;
    window.setTimeout(() => { suppressNativeClick = false; }, 350);
  });

  footer.addEventListener('pointercancel', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const cancelledDrag = drag;
    drag = null;
    releasePointer(event);
    footer.classList.remove('is-dragging');
    // 未移动时触发点击（修复移动端 pointercancel 导致 tap 丢失）
    if (!cancelledDrag.moved) {
      const target = document.elementFromPoint(cancelledDrag.startX, cancelledDrag.startY);
      const btn = target?.closest('.footer-nav-btn');
      if (btn) {
        const idx = buttons.indexOf(btn);
        if (idx >= 0) {
          setFooterActiveIndex(idx);
          btn.click();
          suppressNativeClick = true;
          window.setTimeout(() => { suppressNativeClick = false; }, 350);
        }
      }
    } else {
      setFooterActiveIndex(Math.round(cancelledDrag.initialIndex));
    }
  });

  footer.addEventListener('click', (event) => {
    if (!suppressNativeClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressNativeClick = false;
  }, true);
}

// 屏幕层级：home 为基础层，results / fail 为下钻层，用于推导过渡方向。
const SCREEN_DEPTH = { home: 0, prep: 0, practice: 0, my: 0, results: 1, fail: 1, agentChat: 1, agentProposal: 2 };
const SCREEN_TRANSITION_MS = 400;

const ENTER_CLASSES = ['screen-entering', 'screen-enter-forward', 'screen-enter-backward', 'screen-enter-cross'];
const EXIT_CLASSES = ['screen-exiting', 'screen-exit-forward', 'screen-exit-backward', 'screen-exit-cross'];

function showScreen(target, direction = 'cross') {
  target.classList.remove(...ENTER_CLASSES, ...EXIT_CLASSES);
  void target.offsetWidth; // 强制重排，确保动画可重复触发
  target.classList.add('is-active', 'screen-entering', `screen-enter-${direction}`);
  const cleanup = () => target.classList.remove('screen-entering', `screen-enter-${direction}`);
  target.addEventListener('animationend', (event) => {
    // 只响应屏幕自身的动画，避免子元素动画冒泡误清状态。
    if (event.target === target && event.animationName.startsWith('screenEnter')) cleanup();
  });
  window.setTimeout(cleanup, SCREEN_TRANSITION_MS + 150);
}

/** 旧屏幕退出：转为固定层保留滚动位置，与新屏幕同屏完成方向性退场。 */
function exitScreen(el, direction) {
  const scrollY = window.scrollY;
  el.classList.remove('is-active', ...ENTER_CLASSES, ...EXIT_CLASSES);
  void el.offsetWidth;
  el.classList.add('screen-exiting', `screen-exit-${direction}`);
  if (scrollY > 0) el.scrollTop = scrollY;
  const cleanup = () => el.classList.remove(...EXIT_CLASSES);
  el.addEventListener('animationend', (event) => {
    if (event.target === el && event.animationName.startsWith('screenExit')) cleanup();
  }, { once: true });
  window.setTimeout(cleanup, SCREEN_TRANSITION_MS + 150);
}

function setActiveScreen(screen) {
  const target = document.getElementById(`${screen}Screen`);
  const current = document.querySelector('.app-screen.is-active:not(.screen-exiting)');
  if (!target) return;

  if (current && current !== target) {
    const from = SCREEN_DEPTH[_activeScreen] ?? 0;
    const to = SCREEN_DEPTH[screen] ?? 0;
    const direction = to > from ? 'forward' : to < from ? 'backward' : 'cross';
    exitScreen(current, direction);
    showScreen(target, direction);
  } else {
    target.classList.add('is-active');
  }
  _activeScreen = screen;
  updateFooterNav(screen);
  window.scrollTo(0, 0);
}

function navigateTo(screen, { push = true } = {}) {
  hideDetail();
  hideModal();
  closeFilterSheet();
  setActiveScreen(screen);
  if (push) history.pushState({ view: screen }, '');
}

function proposalItems(proposal) {
  const data = proposal?.changes?.[0]?.data || {};
  const items = Array.isArray(data.items) ? data.items : fallbackStudyProposal.changes[0].data.items;
  const icons = { 数学: '∑', 英语: 'A', 政治: '政', 专业课: '专' };
  return items.slice(0, 4).map((item, index) => ({
    subject: item.subject || ['数学', '英语', '政治'][index] || '学习',
    title: item.title || item.task || item.name || '专项复习',
    hours: item.hours || item.duration || '8h',
    note: item.note || item.description || '按计划完成',
    icon: icons[item.subject] || '✦',
  }));
}

function renderAgentProposal(proposal = activeAgentProposal || fallbackStudyProposal) {
  activeAgentProposal = proposal;
  const list = document.getElementById('agentPlanItems');
  if (!list) return;
  list.innerHTML = proposalItems(proposal).map((item) => `
    <article class="agent-plan-item"><i>${escapeHtml(item.icon)}</i><span><strong>${escapeHtml(item.subject)} · ${escapeHtml(item.title)}</strong><small>${escapeHtml(item.note)}</small></span><b>${escapeHtml(String(item.hours))}</b></article>
  `).join('');
}

function appendAgentMessage(text, type = 'user') {
  const list = document.getElementById('agentMessages');
  if (!list) return;
  const article = document.createElement('article');
  article.className = `agent-message is-${type}`;
  article.innerHTML = type === 'assistant'
    ? `<i>✦</i><p>${escapeHtml(text)}</p>`
    : `<p>${escapeHtml(text)}</p>`;
  list.append(article);
  article.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

async function askAgent(question) {
  const text = String(question || '').trim();
  if (!text) return;
  appendAgentMessage(text, 'user');
  const input = document.getElementById('agentChatInput');
  if (input) input.value = '';
  appendAgentMessage('正在根据你的学习数据生成建议…', 'assistant');
  const pending = document.querySelector('#agentMessages .agent-message:last-child p');
  try {
    const response = await createAgentProposal({ proposalType: 'study', question: text, context: { weeklyStudyHours: 42, completionRate: 76, mathAccuracy: 62, readingAccuracy: 60 } });
    activeAgentProposal = response.proposal;
    if (pending) pending.textContent = activeAgentProposal.summary || '已生成新的学习计划提案。';
  } catch (error) {
    // 后端尚未部署或用户未登录时，仍提供可体验的本地提案；不会写入任何数据。
    activeAgentProposal = fallbackStudyProposal;
    if (pending) pending.textContent = error instanceof AgentApiError
      ? '已生成本地演示建议。部署并登录后，可获得基于个人数据的正式提案。'
      : fallbackStudyProposal.summary;
  }
  renderAgentProposal(activeAgentProposal);
}

function openDetailPage(result) {
  _detailReturnScreen = _activeScreen;
  showDetail(result, { degree: currentDegree, zone: currentZone });
  history.pushState({ view: 'detail', returnScreen: _detailReturnScreen }, '');
}

function closeDetailPage() {
  if (history.state?.view === 'detail') {
    history.back();
    return;
  }
  hideDetail();
  navigateTo(_detailReturnScreen, { push: false });
}

function openEditModal({ footerIndex = null } = {}) {
  closeFilterSheet();
  _footerOverlayIndex = Number.isInteger(footerIndex) ? footerIndex : null;
  if (_footerOverlayIndex !== null) setFooterActiveIndex(_footerOverlayIndex);
  showModal();
  history.pushState({ view: 'modal', returnScreen: _activeScreen }, '');
}

function closeEditModal() {
  if (history.state?.view === 'modal') {
    history.back();
    return;
  }
  hideModal();
  restoreFooterNavAfterOverlay();
}

// ==================== UI 初始化 ====================
function initUI() {
  initCombobox('categorySelect', { placeholder: '🔍 选择学科门类...', emitChange: true });
  updateCategorySelect();
  initCombobox('majorSelect', { placeholder: '🔍 输入关键词筛选专业...', alwaysShowAll: true });
  updateMajorSelect();
  initSheetMajorCombobox();
  checkMajorVisibility();
  initProvinceSelect();
}

function initProvinceSelect() {
  const select = document.getElementById('provinceSelect');
  const provinces = [...new Set(UNIVERSITIES.map(u => u.province))].sort();
  provinces.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  });
}

// ---------- 通用 combobox 初始化 ----------
function initCombobox(dropdownId, { placeholder, emitChange = false, alwaysShowAll = false } = {}) {
  const dropdown = document.getElementById(dropdownId);
  const trigger = dropdown.querySelector('.major-trigger');
  const panel = dropdown.querySelector('.major-panel');
  const triggerInput = trigger.querySelector('.major-trigger-input');
  dropdown._selectedValue = '';

  // 提供 .value getter/setter 以兼容旧 <select> API
  Object.defineProperty(dropdown, 'value', {
    get() { return this._selectedValue; },
    set(v) {
      this._selectedValue = v;
      panel.querySelectorAll('.listbox-item').forEach((item) => {
        item.setAttribute('aria-selected', item.dataset.value === v ? 'true' : 'false');
      });
      if (!dropdown.classList.contains('open')) {
        triggerInput.value = v || '';
        triggerInput.placeholder = v ? '' : placeholder;
      }
    },
    configurable: true,
  });

  function openDropdown() {
    dropdown.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    triggerInput.removeAttribute('readonly');
    triggerInput.value = '';
    triggerInput.placeholder = placeholder;
    triggerInput.focus();
    const selected = panel.querySelector('.listbox-item[aria-selected="true"]');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function closeDropdown() {
    dropdown.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    triggerInput.setAttribute('readonly', '');
    triggerInput.value = dropdown._selectedValue || '';
    triggerInput.placeholder = dropdown._selectedValue ? '' : placeholder;
  }

  function selectAndClose(value) {
    dropdown.value = value;
    closeDropdown();
    if (emitChange) dropdown.dispatchEvent(new Event('change'));
  }

  // 触发器点击 → 切换下拉
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.contains('open') ? closeDropdown() : openDropdown();
  });

  // 输入框搜索过滤
  triggerInput.addEventListener('input', () => {
    const q = triggerInput.value.toLowerCase().trim();
    panel.querySelectorAll('.listbox-item').forEach((item) => {
      const text = item.dataset.value.toLowerCase();
      const match = !q || text.includes(q) || (alwaysShowAll && item.dataset.value === '不限专业');
      item.style.display = match ? '' : 'none';
    });
  });

  // 聚焦时打开
  triggerInput.addEventListener('focus', () => {
    if (!dropdown.classList.contains('open')) openDropdown();
  });

  // 失焦关闭（延迟以允许面板点击）
  triggerInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (!dropdown.contains(document.activeElement)) closeDropdown();
    }, 150);
  });

  // 输入框键盘操作
  triggerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDropdown();
      triggerInput.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const items = [...panel.querySelectorAll('.listbox-item:not([style*="display: none"])')];
      if (items.length) items[0].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = panel.querySelector('.listbox-item[aria-selected="true"]');
      if (selected) selectAndClose(selected.dataset.value);
    }
  });

  // 面板鼠标选择
  panel.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const item = e.target.closest('.listbox-item');
    if (!item) return;
    selectAndClose(item.dataset.value);
  });

  // 面板键盘导航
  panel.addEventListener('keydown', (e) => {
    const items = [...panel.querySelectorAll('.listbox-item:not([style*="display: none"])')];
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (items[idx + 1] || items[0])?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx <= 0 ? triggerInput.focus() : items[idx - 1].focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (idx >= 0) selectAndClose(items[idx].dataset.value);
    } else if (e.key === 'Escape') {
      closeDropdown();
      triggerInput.focus();
    }
  });

  // 点击外部关闭
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) closeDropdown();
  });
}

function updateCategorySelect() {
  const dropdown = document.getElementById('categorySelect');
  const panel = dropdown.querySelector('.major-panel');
  const categories = getCategories(currentDegree);
  const prevValue = dropdown._selectedValue;
  panel.innerHTML = '';
  let restored = false;
  for (const cat of categories) {
    const item = document.createElement('div');
    item.className = 'listbox-item';
    item.setAttribute('role', 'option');
    item.textContent = cat;
    item.dataset.value = cat;
    if (cat === prevValue) {
      item.setAttribute('aria-selected', 'true');
      restored = true;
    }
    panel.appendChild(item);
  }
  if (!restored) dropdown._selectedValue = '';
  const triggerInput = dropdown.querySelector('.major-trigger-input');
  if (!dropdown.classList.contains('open')) {
    triggerInput.value = dropdown._selectedValue || '';
    triggerInput.placeholder = dropdown._selectedValue ? '' : '🔍 选择学科门类...';
  }
  checkMajorVisibility();
}

function updateMajorSelect() {
  const dropdown = document.getElementById('majorSelect');
  const panel = dropdown.querySelector('.major-panel');
  const category = document.getElementById('categorySelect').value;
  const searchQuery = (dropdown.querySelector('.major-trigger-input').value || '').toLowerCase().trim();
  const allMajors = getMajorsForCategory(category);
  const filtered = searchQuery
    ? allMajors.filter((m) => m === '不限专业' || m.toLowerCase().includes(searchQuery))
    : allMajors;
  const prevValue = dropdown._selectedValue;
  panel.innerHTML = '';
  let restored = false;
  for (const m of filtered) {
    const item = document.createElement('div');
    item.className = 'listbox-item';
    item.setAttribute('role', 'option');
    item.textContent = m;
    item.dataset.value = m;
    if (m === prevValue) {
      item.setAttribute('aria-selected', 'true');
      restored = true;
    }
    panel.appendChild(item);
  }
  if (!restored) dropdown._selectedValue = '';
  // Update trigger input
  const triggerInput = dropdown.querySelector('.major-trigger-input');
  if (!dropdown.classList.contains('open')) {
    triggerInput.value = dropdown._selectedValue || '';
    triggerInput.placeholder = dropdown._selectedValue ? '' : '🔍 输入关键词筛选专业...';
  }
}

function checkMajorVisibility() {
  const category = document.getElementById('categorySelect').value;
  const majorGroup = document.getElementById('majorGroup');
  const majorLabel = document.getElementById('majorLabel');
  const show = hasSubMajors(category);
  majorGroup.style.display = show ? 'block' : 'none';
  if (show) {
    const isEng = category === '工学';
    majorLabel.textContent = isEng ? '🔧 工学专业方向' : '💼 专硕专业方向';
    document.getElementById('majorSelect').querySelector('.major-trigger-input').value = '';
    updateMajorSelect();
  }
}

// ==================== 事件绑定 ====================
function bindEvents() {
  // 学位类型切换
  document.getElementById('degreeToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    const value = btn.dataset.value;
    if (value === currentDegree) return;
    document
      .querySelectorAll('#degreeToggle .toggle-btn')
      .forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentDegree = value;
    updateCategorySelect();
    // 切换学位后，选中新门类列表的第一个
    const catDropdown = document.getElementById('categorySelect');
    const firstItem = catDropdown.querySelector('.major-panel .listbox-item');
    catDropdown.value = firstItem ? firstItem.dataset.value : '';
    checkMajorVisibility();
    updateHomeDashboard();
    clearResults();
  });

  // 分区切换
  document.getElementById('zoneToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    const value = btn.dataset.value;
    if (value === currentZone) return;
    document
      .querySelectorAll('#zoneToggle .toggle-btn')
      .forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentZone = value;
    updateHomeDashboard();
    clearResults();
  });

  // 省份筛选
  document.getElementById('provinceSelect').addEventListener('change', (e) => {
    currentProvince = e.target.value;
    updateHomeDashboard();
    clearResults();
  });

  // 学习形式切换
  document.getElementById('studyModeToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    const value = btn.dataset.value;
    if (value === currentStudyMode) return;
    document
      .querySelectorAll('#studyModeToggle .toggle-btn')
      .forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentStudyMode = value;
    updateHomeDashboard();
    clearResults();
  });

  // 门类切换
  document.getElementById('categorySelect').addEventListener('change', () => {
    checkMajorVisibility();
    updateHomeDashboard();
    clearResults();
  });

  // 筛选抽屉：独立界面，但与首页共用同一份查询状态。
  document.querySelectorAll('[data-open-filter]').forEach((button) => button.addEventListener('click', openFilterSheet));
  document.getElementById('openFilterNavBtn').addEventListener('click', () => {
    if (currentResults.length) navigateTo('results');
    else doSearch();
  });
  document.getElementById('closeFilterSheetBtn').addEventListener('click', closeFilterSheet);
  document.getElementById('filterSheetBackdrop').addEventListener('click', closeFilterSheet);
  document.getElementById('homeNavBtn').addEventListener('click', () => {
    navigateTo('home');
  });
  document.getElementById('prepNavBtn').addEventListener('click', () => navigateTo('prep'));
  document.getElementById('practiceNavBtn').addEventListener('click', () => navigateTo('practice'));
  document.getElementById('profileNavBtn').addEventListener('click', () => {
    renderMyPage();
    navigateTo('my');
  });
  document.querySelectorAll('#prepTaskList .prep-task').forEach((task) => {
    task.addEventListener('click', () => {
      task.classList.toggle('is-complete');
      const completed = document.querySelectorAll('#prepTaskList .prep-task.is-complete').length;
      document.getElementById('prepTaskProgress').textContent = `${completed + 3} / 7 项`;
      document.getElementById('prepCompletionRate').textContent = `${Math.round((completed + 3) / 7 * 100)}%`;
      const check = task.querySelector('.prep-task-check');
      check.textContent = task.classList.contains('is-complete') ? '✓' : '';
    });
  });
  document.getElementById('startStudyBtn').addEventListener('click', () => {
    const button = document.getElementById('startStudyBtn');
    const running = button.classList.toggle('is-running');
    button.textContent = running ? 'Ⅱ 正在专注' : '▷ 开始学习';
  });
  document.getElementById('dailyCheckinBtn').addEventListener('click', () => {
    const button = document.getElementById('dailyCheckinBtn');
    button.textContent = '✓ 已打卡';
    button.disabled = true;
  });
  document.getElementById('prepStatsBtn').addEventListener('click', () => {
    renderAgentProposal();
    navigateTo('agentProposal');
  });
  document.getElementById('agentChatBackBtn').addEventListener('click', () => navigateTo('agentProposal'));
  document.getElementById('agentProposalBackBtn').addEventListener('click', () => navigateTo('prep'));
  document.getElementById('agentPlanLink').addEventListener('click', () => {
    renderAgentProposal();
    navigateTo('agentProposal');
  });
  document.getElementById('agentOpenChatBtn').addEventListener('click', () => navigateTo('agentChat'));
  document.querySelectorAll('[data-agent-prompt]').forEach((button) => {
    button.addEventListener('click', () => askAgent(button.dataset.agentPrompt));
  });
  document.getElementById('agentChatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    askAgent(document.getElementById('agentChatInput').value);
  });
  document.getElementById('agentAdjustProposalBtn').addEventListener('click', () => navigateTo('agentChat'));
  document.getElementById('agentApplyProposalBtn').addEventListener('click', async () => {
    const button = document.getElementById('agentApplyProposalBtn');
    if (!activeAgentProposal?.id) {
      button.textContent = '✓ 已应用演示计划';
      button.disabled = true;
      return;
    }
    button.disabled = true;
    button.textContent = '正在应用…';
    try {
      await applyAgentProposal(activeAgentProposal.id);
      button.textContent = '✓ 已应用到备考计划';
    } catch (error) {
      button.disabled = false;
      button.textContent = '应用这份计划';
      alert(error instanceof Error ? error.message : '应用计划失败，请稍后再试。');
    }
  });
  document.getElementById('themeToggleBtn').addEventListener('click', toggleStudyTheme);
  document.querySelectorAll('[data-practice-action], #resumePracticeBtn, #allWrongBtn, #wrongAnalysisBtn').forEach((button) => {
    button.addEventListener('click', () => alert(`${button.dataset.practiceAction || '题库功能'}正在准备中，学习记录会同步到这里。`));
  });
  initializeFooterSlider();
  document.getElementById('resultsBackBtn').addEventListener('click', () => navigateTo('home'));
  document.getElementById('resultsFilterBtn').addEventListener('click', openFilterSheet);
  document.getElementById('resultContext').addEventListener('click', openFilterSheet);
  document.getElementById('failBackBtn').addEventListener('click', () => navigateTo('home'));
  document.getElementById('homeSeeAllBtn').addEventListener('click', doSearch);
  document.getElementById('homeRecommendCard').addEventListener('click', (e) => {
    const uni = findUniversity(e.currentTarget.dataset.uniName);
    if (uni) openUniversityDetail(uni);
  });
  document.getElementById('scoreInput').addEventListener('input', updateHomeDashboard);
  document.getElementById('sheetDegreeSelect').addEventListener('change', (e) => {
    setActiveToggle('sheetDegreeOptions', e.target.value);
    populateSheetCategories(e.target.value, document.getElementById('sheetCategorySelect').value);
    populateSheetMajors(document.getElementById('sheetCategorySelect').value);
    updateSheetEstimate();
  });
  document.getElementById('sheetCategorySelect').addEventListener('change', (e) => {
    setActiveToggle('sheetCategoryOptions', e.target.value);
    populateSheetMajors(e.target.value);
    updateSheetEstimate();
  });
  document.getElementById('sheetMajorSelect').addEventListener('change', updateSheetEstimate);
  document.getElementById('sheetProvinceSelect').addEventListener('change', (e) => {
    setActiveToggle('sheetProvinceOptions', e.target.value);
    updateSheetProvinceLabel();
    updateSheetEstimate();
  });
  document.getElementById('sheetScoreInput').addEventListener('input', updateSheetEstimate);
  ['sheetZoneToggle', 'sheetStudyModeToggle'].forEach((containerId) => {
    document.getElementById(containerId).addEventListener('click', (e) => {
      const button = e.target.closest('button[data-value]');
      if (button) {
        setActiveToggle(containerId, button.dataset.value);
        updateSheetEstimate();
      }
    });
  });
  [
    ['sheetDegreeOptions', 'sheetDegreeSelect'],
    ['sheetCategoryOptions', 'sheetCategorySelect'],
    ['sheetProvinceOptions', 'sheetProvinceSelect'],
  ].forEach(([containerId, selectId]) => {
    document.getElementById(containerId).addEventListener('click', (e) => {
      const button = e.target.closest('button[data-value]');
      if (!button) return;
      const select = document.getElementById(selectId);
      if (select.value === button.dataset.value) return;
      select.value = button.dataset.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      if (containerId === 'sheetProvinceOptions') {
        document.getElementById('sheetProvinceOptions').classList.remove('is-expanded');
        document.getElementById('sheetProvinceExpandBtn').setAttribute('aria-expanded', 'false');
      }
    });
  });
  document.getElementById('sheetProvinceExpandBtn').addEventListener('click', () => {
    const options = document.getElementById('sheetProvinceOptions');
    const expanded = options.classList.toggle('is-expanded');
    document.getElementById('sheetProvinceExpandBtn').setAttribute('aria-expanded', String(expanded));
  });
  document.getElementById('sheetUniSearch').addEventListener('input', debounce((e) => {
    renderSheetSearchMatches(e.target.value);
  }, 120));
  document.getElementById('sheetSearchMatches').addEventListener('click', (e) => {
    const item = e.target.closest('.sheet-search-result');
    if (!item) return;
    const uni = findUniversity(item.dataset.uniName);
    if (uni) {
      closeFilterSheet();
      openUniversityDetail(uni);
    }
  });
  document.getElementById('sheetQuickUniversity').addEventListener('click', (e) => {
    const uni = findUniversity(e.currentTarget.dataset.uniName);
    if (uni) {
      closeFilterSheet();
      openUniversityDetail(uni);
    }
  });
  document.getElementById('applyFilterSheetBtn').addEventListener('click', applyFilterSheet);
  document.getElementById('openDataManagerBtn').addEventListener('click', openEditModal);
  initMyPageEvents();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFilterSheet();
  });

  // 查询按钮
  document.getElementById('searchBtn').addEventListener('click', doSearch);
  document.getElementById('scoreInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // 排序
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    currentResults = sortResults(currentResults, e.target.value);
    renderResults(currentResults, { degree: currentDegree, zone: currentZone });
  });

  // 院校卡片点击
  document.getElementById('resultsList').addEventListener('click', (e) => {
    if (e.target.closest('[data-load-more-results]')) {
      renderMoreResults();
      return;
    }
    const card = e.target.closest('.result-card');
    if (!card) return;
    const idx = parseInt(card.dataset.index);
    if (!isNaN(idx) && currentResults[idx]) {
      openDetailPage(currentResults[idx]);
    }
  });

  // 详情页返回
  document.getElementById('detailBackBtn').addEventListener('click', closeDetailPage);

  // 校园实景按钮
  document.getElementById('detailPhotoBtn').addEventListener('click', () => {
    const name = document.getElementById('detailName').textContent;
    const url = `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent(name + ' 校园')}`;
    window.open(url, '_blank');
  });

  // 收藏按钮
  document.getElementById('detailFavBtn').addEventListener('click', () => {
    const name = document.getElementById('detailName').textContent;
    const faved = toggleFavorite(name);
    const favBtn = document.getElementById('detailFavBtn');
    favBtn.textContent = faved ? '★' : '☆';
    favBtn.classList.toggle('is-faved', faved);
  });

  // B区尝试
  document.getElementById('tryBZoneBtn').addEventListener('click', () => {
    currentZone = 'B';
    setActiveToggle('zoneToggle', 'B');
    doSearch();
  });

  // 原项目的数据维护能力保留为“数据”入口：自定义院校、JSON 导入和导出。
  document.getElementById('uniList').addEventListener('click', (e) => {
    const deleteButton = e.target.closest('.uni-edit-del');
    if (deleteButton) {
      const row = deleteButton.closest('.uni-edit-item');
      if (row) handleDeleteUniversity(row.dataset.uniName);
      return;
    }
    const row = e.target.closest('.uni-edit-item');
    const uni = row && findUniversity(row.dataset.uniName);
    if (uni) {
      closeEditModal();
      setTimeout(() => openUniversityDetail(uni), 0);
    }
  });
  document.getElementById('closeModalBtn').addEventListener('click', closeEditModal);
  document.getElementById('exportDataBtn').addEventListener('click', exportAllData);
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditModal();
  });
  document.querySelectorAll('.modal-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchModalTab(tab.dataset.tab));
  });
  document.getElementById('uniSearchInput').addEventListener('input', (e) => renderUniEditList(e.target.value));
  document.getElementById('addUniForm').addEventListener('submit', (e) => {
    e.preventDefault();
    handleAddUniversity();
  });
  document.getElementById('importBtn').addEventListener('click', handleImport);

}

// ==================== 搜索 ====================
function doSearch() {
  const scoreInput = document.getElementById('scoreInput');
  const score = parseInt(scoreInput.value, 10);
  const hasScore = !isNaN(score) && score > 0 && score <= 500;

  const category = document.getElementById('categorySelect').value;
  if (!category) return;

  const majorSelect = document.getElementById('majorSelect');
  const major = hasSubMajors(category) ? majorSelect.value : null;

  const searchScore = hasScore ? score : 0;
  saveLastSearch({ score: hasScore ? score : null, degree: currentDegree, category, zone: currentZone, province: currentProvince, studyMode: currentStudyMode, major });

  const result = matchUniversities(searchScore, currentDegree, category, currentZone, major, currentProvince, currentStudyMode);
  currentResults = result.results;

  renderNationalLine(result, {
    userScore: searchScore,
    category,
    degree: currentDegree,
    zone: currentZone,
  });
  renderResults(result.results, { degree: currentDegree, zone: currentZone });

  if (hasScore && result.passed === false) {
    const diff = score - result.nationalLine.score;
    document.getElementById('failLineLabel').textContent = `${currentZone} 区${category}国家线为 ${result.nationalLine.score} 分`;
    document.getElementById('failDiffBadge').textContent = `差 ${Math.abs(diff)} 分`;
    document.getElementById('failScoreValue').textContent = score;
    document.getElementById('failFilterMeta').textContent = `${currentDegree === 'xueshuo' ? '学硕' : '专硕'} · ${category}`;
    document.getElementById('failMsg').textContent = `别急，切换 B 区后仍有机会进入匹配池。`;
    renderFailComparison(score, category, major);
    navigateTo('fail');
  } else {
    navigateTo('results');
  }
}

function renderFailComparison(score, category, major) {
  const compare = document.getElementById('failComparison');
  const zones = ['A', 'B'].map((zone) => ({
    zone,
    result: matchUniversities(score, currentDegree, category, zone, major, currentProvince, currentStudyMode),
  }));
  compare.innerHTML = zones.map(({ zone, result }) => {
    const line = result.nationalLine?.score;
    const diff = typeof line === 'number' ? score - line : null;
    const pass = diff !== null && diff >= 0;
    const text = diff === null ? '暂无数据' : pass ? `高出 ${diff} 分` : `还差 ${Math.abs(diff)} 分`;
    return `<div class="fail-zone-card ${pass ? 'is-pass' : 'is-fail'}"><span>${zone} 区</span><strong>${line ?? '—'} 分</strong><small>${pass ? '已过线' : text}</small></div>`;
  }).join('');
  const bZone = zones.find((item) => item.zone === 'B')?.result;
  document.getElementById('failBZoneCount').textContent = `${bZone?.results.length || 0} 所院校等待加入你的歌单`;
}

// ==================== 状态管理 ====================
function clearResults() {
  currentResults = [];
  document.getElementById('resultsSection').style.display = '';
  document.getElementById('nationalLineCard').style.display = 'none';
  if (_activeScreen !== 'home') navigateTo('home', { push: false });
}

function restoreLastSearch() {
  const last = getLastSearch();
  if (!last) return;

  const savedScore = Number(last.score);
  if (Number.isFinite(savedScore) && savedScore >= 0 && savedScore <= 500) {
    document.getElementById('scoreInput').value = savedScore;
  }
  const canRestoreProgram =
    ['xueshuo', 'zhuanshuo'].includes(last.degree)
    && getCategories(last.degree).includes(last.category);
  if (canRestoreProgram) {
    currentDegree = last.degree;
    document.querySelectorAll('#degreeToggle .toggle-btn').forEach((b) => {
      b.classList.remove('active');
      if (b.dataset.value === last.degree) b.classList.add('active');
    });
    updateCategorySelect();
  }
  const catDropdown = document.getElementById('categorySelect');
  const availableCategories = getCategories(currentDegree);
  if (canRestoreProgram) {
    catDropdown.value = last.category;
    catDropdown.dispatchEvent(new Event('change'));
  } else if (!availableCategories.includes(catDropdown.value)) {
    catDropdown.value = availableCategories.includes('工学') ? '工学' : availableCategories[0];
    catDropdown.dispatchEvent(new Event('change'));
  }
  if (
    last.major
    && hasSubMajors(catDropdown.value)
    && getMajorsForCategory(catDropdown.value).includes(last.major)
  ) {
    document.getElementById('majorSelect').value = last.major;
  }
  if (['A', 'B', 'all'].includes(last.zone)) {
    currentZone = last.zone;
    document.querySelectorAll('#zoneToggle .toggle-btn').forEach((b) => {
      b.classList.remove('active');
      if (b.dataset.value === last.zone) b.classList.add('active');
    });
  } else {
    currentZone = 'A';
    setActiveToggle('zoneToggle', currentZone);
  }
  if ([...document.getElementById('provinceSelect').options].some((option) => option.value === last.province)) {
    currentProvince = last.province;
    document.getElementById('provinceSelect').value = last.province;
  }
  if (['all', '全日制', '非全日制'].includes(last.studyMode)) {
    currentStudyMode = last.studyMode;
    document.querySelectorAll('#studyModeToggle .toggle-btn').forEach((b) => {
      b.classList.remove('active');
      if (b.dataset.value === last.studyMode) b.classList.add('active');
    });
  }
}

function normalizeSearchState() {
  const categorySelect = document.getElementById('categorySelect');
  const validCategories = getCategories(currentDegree);

  // 早期版本可能保存了“专硕 + 工学”这类不再存在的组合；回到可靠默认值。
  if (!validCategories.includes(categorySelect.value)) {
    currentDegree = 'xueshuo';
    setActiveToggle('degreeToggle', currentDegree);
    updateCategorySelect();
    categorySelect.value = '工学';
    checkMajorVisibility();
  }

  if (!['A', 'B', 'all'].includes(currentZone)) {
    currentZone = 'A';
    setActiveToggle('zoneToggle', currentZone);
  }
  if (!['all', '全日制', '非全日制'].includes(currentStudyMode)) {
    currentStudyMode = 'all';
    setActiveToggle('studyModeToggle', currentStudyMode);
  }
}

// ==================== 导航历史管理 ====================
function initHistoryNav() {
  history.replaceState({ view: 'home' }, '');

  window.addEventListener('popstate', (e) => {
    const view = (e.state && e.state.view) || 'home';
    hideDetail();
    hideModal();
    if (['home', 'prep', 'practice', 'results', 'fail', 'my'].includes(view)) setActiveScreen(view);
    restoreFooterNavAfterOverlay();
  });
}

// ==================== 自动更新检测 ====================
const LOCAL_VERSION = '4.3';
const UPDATE_CHECK_URL = 'https://forever322.github.io/kaoyan-app/version.json';
const DISMISSED_KEY = 'update_dismissed_v';
const isAndroid = /Android/i.test(navigator.userAgent);

async function checkForUpdate() {
  // APK 内嵌资源在 file:// 协议下运行，不应被远程网页版本覆盖。
  if (location.protocol === 'file:') return;
  try {
    const resp = await fetch(UPDATE_CHECK_URL + '?t=' + Date.now());
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.version !== LOCAL_VERSION) {
      // 用户点击「暂不」后，同一版本不再弹出
      if (localStorage.getItem(DISMISSED_KEY + data.version)) return;
      showUpdateBanner(data.version, data.apkUrl);
    }
  } catch {
    // 无网络或检查失败，静默跳过
  }
}

function showUpdateBanner(remoteVersion, apkUrl) {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;bottom:80px;left:16px;right:16px;z-index:100;background:#1a73e8;color:#fff;padding:12px 16px;border-radius:12px;display:flex;align-items:center;gap:12px;font-size:0.9rem;box-shadow:0 4px 16px rgba(0,0,0,0.3);animation:slideUp 0.3s ease-out';

  if (isAndroid) {
    // Android TWA: 引导用户下载新 APK（优先 CNB 国内镜像）
    const downloadUrl = apkUrl ? `${apkUrl}/v${remoteVersion}/app-release.apk` : 'https://cnb.cool/lvcdy/kaoyan-app/-/releases';
    banner.innerHTML = `
      <span style="flex:1">🔄 发现新版本 v${remoteVersion}</span>
      <button id="updateYes" style="background:#fff;color:#1a73e8;border:none;padding:6px 14px;border-radius:6px;font-weight:600;cursor:pointer">下载更新</button>
      <button id="updateNo" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.5);padding:6px 14px;border-radius:6px;cursor:pointer">暂不</button>
    `;
    document.body.appendChild(banner);
    document.getElementById('updateYes').onclick = () => { window.open(downloadUrl, '_blank'); };
  } else {
    // PWA / Web: 刷新页面即可获取最新资源（SW 网络优先策略保证拉到新版）
    banner.innerHTML = `
      <span style="flex:1">🔄 发现新版本 v${remoteVersion}，刷新即可更新</span>
      <button id="updateYes" style="background:#fff;color:#1a73e8;border:none;padding:6px 14px;border-radius:6px;font-weight:600;cursor:pointer">刷新</button>
      <button id="updateNo" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.5);padding:6px 14px;border-radius:6px;cursor:pointer">暂不</button>
    `;
    document.body.appendChild(banner);
    document.getElementById('updateYes').onclick = () => { location.reload(); };
  }

  document.getElementById('updateNo').onclick = () => {
    banner.style.display = 'none';
    localStorage.setItem(DISMISSED_KEY + remoteVersion, '1');
  };
}

function setActiveToggle(containerId, value) {
  document.querySelectorAll(`#${containerId} button`).forEach((button) => {
    button.classList.toggle('active', button.dataset.value === value);
  });
}

function buildDetailResult(uni) {
  const userScore = parseInt(document.getElementById('scoreInput').value, 10) || 0;
  const category = document.getElementById('categorySelect').value;
  const major = hasSubMajors(category) ? document.getElementById('majorSelect').value : null;
  const admissionScores = getAdmissionScores(uni.name, category, currentDegree, major);
  const matchResult = evaluateMatch(userScore, admissionScores);
  return {
    university: uni,
    admissionScores,
    verdict: matchResult.verdict,
    verdictLabel: matchResult.label,
    verdictClass: matchResult.cssClass,
    avgScore: matchResult.avgScore,
    studyMode: currentStudyMode === 'all' ? null : currentStudyMode,
  };
}

function openUniversityDetail(uni) {
  openDetailPage(buildDetailResult(uni));
}

function populateSheetCategories(degree, selectedValue = '') {
  const select = document.getElementById('sheetCategorySelect');
  const options = document.getElementById('sheetCategoryOptions');
  const categories = getCategories(degree);
  select.innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  const fallback = categories.includes('工学') ? '工学' : categories[0];
  select.value = categories.includes(selectedValue) ? selectedValue : fallback;
  options.innerHTML = categories.map((category) => `<button type="button" data-value="${escapeHtml(category)}" role="radio">${escapeHtml(category)}</button>`).join('');
  setActiveToggle('sheetCategoryOptions', select.value);
}

function populateSheetMajors(category, selectedValue = '') {
  const row = document.getElementById('sheetMajorRow');
  const select = document.getElementById('sheetMajorSelect');
  const shouldShow = hasSubMajors(category);
  row.hidden = !shouldShow;
  if (!shouldShow) {
    select.innerHTML = '';
    renderSheetMajorOptions();
    return;
  }
  const majors = getMajorsForCategory(category);
  const currentMajor = selectedValue || document.getElementById('majorSelect').value;
  select.innerHTML = majors.map((major) => `<option value="${escapeHtml(major)}">${escapeHtml(major)}</option>`).join('');
  select.value = majors.includes(currentMajor) ? currentMajor : majors[0];
  renderSheetMajorOptions();
}

function initSheetMajorCombobox() {
  const dropdown = document.getElementById('sheetMajorSelectDisplay');
  const select = document.getElementById('sheetMajorSelect');
  if (!dropdown || !select) return;
  const trigger = dropdown.querySelector('.sheet-major-trigger');
  const input = dropdown.querySelector('.sheet-major-input');
  const panel = dropdown.querySelector('.sheet-major-panel');
  const render = () => {
    const selected = select.value;
    input.value = dropdown.classList.contains('open') ? '' : selected;
    input.placeholder = selected ? '' : '选择专业方向';
    panel.querySelectorAll('.sheet-major-option').forEach((item) => {
      item.setAttribute('aria-selected', item.dataset.value === selected ? 'true' : 'false');
    });
  };
  const close = () => {
    dropdown.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    input.setAttribute('readonly', '');
    render();
  };
  const open = () => {
    dropdown.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    input.removeAttribute('readonly');
    input.value = '';
    input.placeholder = '搜索专业方向';
    input.focus();
    panel.querySelector(`[data-value="${CSS.escape(select.value)}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    dropdown.classList.contains('open') ? close() : open();
  });
  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    panel.querySelectorAll('.sheet-major-option').forEach((item) => {
      item.hidden = Boolean(query) && !item.dataset.value.toLowerCase().includes(query);
    });
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') {
      event.preventDefault();
      panel.querySelector('.sheet-major-option:not([hidden])')?.click();
    }
  });
  panel.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const option = event.target.closest('.sheet-major-option');
    if (!option) return;
    select.value = option.dataset.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  });
  input.addEventListener('blur', () => setTimeout(() => {
    if (!dropdown.contains(document.activeElement)) close();
  }, 120));
  select.addEventListener('change', render);
  document.addEventListener('click', (event) => {
    if (!dropdown.contains(event.target)) close();
  });
  dropdown._render = render;
  render();
}

function renderSheetMajorOptions() {
  const dropdown = document.getElementById('sheetMajorSelectDisplay');
  const select = document.getElementById('sheetMajorSelect');
  if (!dropdown || !select) return;
  dropdown.querySelector('.sheet-major-panel').innerHTML = [...select.options]
    .map((option) => `<button type="button" class="sheet-major-option" role="option" data-value="${escapeHtml(option.value)}" aria-selected="false">${escapeHtml(option.textContent)}</button>`)
    .join('');
  dropdown._render?.();
}

function populateSheetProvinces() {
  const source = document.getElementById('provinceSelect');
  const select = document.getElementById('sheetProvinceSelect');
  const options = document.getElementById('sheetProvinceOptions');
  select.innerHTML = [...source.options]
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.textContent)}</option>`)
    .join('');
  select.value = currentProvince;
  options.innerHTML = [...select.options]
    .map((option) => `<button type="button" data-value="${escapeHtml(option.value)}" role="radio">${escapeHtml(option.textContent)}</button>`)
    .join('');
  setActiveToggle('sheetProvinceOptions', select.value);
  updateSheetProvinceLabel();
}

function updateSheetProvinceLabel() {
  const select = document.getElementById('sheetProvinceSelect');
  const current = select.options[select.selectedIndex];
  document.getElementById('sheetProvinceCurrent').textContent = current?.textContent || '全部省份';
}

function currentSheetChoice(containerId) {
  return document.querySelector(`#${containerId} button.active`)?.dataset.value || 'all';
}

function updateHomeDashboard() {
  const score = parseInt(document.getElementById('scoreInput')?.value, 10) || 0;
  const category = document.getElementById('categorySelect')?.value || '工学';
  const major = hasSubMajors(category) ? document.getElementById('majorSelect')?.value : null;
  const match = matchUniversities(score, currentDegree, category, currentZone, major, currentProvince, currentStudyMode);
  const line = match.nationalLine?.score;
  const diff = typeof line === 'number' ? score - line : null;
  const degreeLabel = currentDegree === 'xueshuo' ? '学硕' : '专硕';
  const zoneLabel = currentZone === 'all' ? 'A/B 区' : `${currentZone} 区`;
  const modeLabel = currentStudyMode === 'all' ? '全日制' : currentStudyMode;

  document.getElementById('homeDegreeChip').textContent = `♧ ${degreeLabel}`;
  document.getElementById('homeCategoryChip').textContent = `♙ ${category}`;
  document.getElementById('homeZoneChip').textContent = `⌾ ${zoneLabel}`;
  document.getElementById('homeScoreState').textContent = diff === null ? '等待输入' : diff >= 0 ? '状态正热' : '再冲一点';
  document.getElementById('homeLineStatus').textContent = diff === null
    ? '输入分数，立即计算国家线差值'
    : diff >= 0 ? `✓ 超过 ${zoneLabel}${category}线 ${diff} 分` : `△ 距 ${zoneLabel}${category}线还差 ${Math.abs(diff)} 分`;
  document.getElementById('homeScoreNote').textContent = match.results.length
    ? `已为你准备好 ${match.results.length} 所院校`
    : '调整条件，发现更多可能';

  const recommendation = findUniversity('清华大学') || match.results[0]?.university;
  if (!recommendation) return;
  const recommendationResult = buildDetailResult(recommendation);
  const scores = recommendationResult.admissionScores?.map((item) => item.score).filter(Boolean) || [];
  const min = scores.length ? Math.min(...scores) : '—';
  const max = scores.length ? Math.max(...scores) : '—';
  document.getElementById('homeRecommendCard').dataset.uniName = recommendation.name;
  document.getElementById('homeRecommendName').textContent = recommendation.name;
  document.getElementById('homeRecommendMeta').textContent = `${category} · ${degreeLabel} · ${recommendation.zone}区 · ${modeLabel}`;
  document.getElementById('homeRecommendScore').textContent = `近 4 年院线 ${min} — ${max} 分`;
  document.getElementById('homeRecommendLevel').textContent = recommendation.level;
  document.getElementById('homeRecommendVerdict').textContent = recommendationResult.verdictLabel || '参考';
  document.getElementById('homeRecommendMeter').style.width = `${Math.max(22, Math.min(96, diff === null ? 72 : 58 + diff / 3))}%`;
}

function closeFilterSheet() {
  const sheet = document.getElementById('filterSheet');
  if (sheet.classList.contains('hidden')) return;
  clearTimeout(_filterCloseTimer);
  sheet.classList.add('is-closing');
  sheet.setAttribute('aria-hidden', 'true');
  _filterCloseTimer = setTimeout(() => {
    sheet.classList.add('hidden');
    sheet.classList.remove('is-closing');
  }, 260);
  restoreFooterNavAfterOverlay();
}

function openFilterSheet({ footerIndex = null } = {}) {
  _footerOverlayIndex = Number.isInteger(footerIndex) ? footerIndex : null;
  if (_footerOverlayIndex !== null) setFooterActiveIndex(_footerOverlayIndex);
  const category = document.getElementById('categorySelect').value;
  document.getElementById('sheetScoreInput').value = document.getElementById('scoreInput').value;
  document.getElementById('sheetDegreeSelect').value = currentDegree;
  setActiveToggle('sheetDegreeOptions', currentDegree);
  populateSheetCategories(currentDegree, category);
  populateSheetMajors(category, document.getElementById('majorSelect').value);
  populateSheetProvinces();
  setActiveToggle('sheetZoneToggle', currentZone);
  setActiveToggle('sheetStudyModeToggle', currentStudyMode);
  updateSheetEstimate();
  document.getElementById('sheetUniSearch').value = '';
  document.getElementById('sheetSearchMatches').innerHTML = '';
  const sheet = document.getElementById('filterSheet');
  clearTimeout(_filterCloseTimer);
  sheet.querySelector('.filter-sheet-panel').scrollTop = 0;
  sheet.classList.remove('hidden', 'is-closing');
  sheet.setAttribute('aria-hidden', 'false');
}

function updateSheetEstimate() {
  const score = parseInt(document.getElementById('sheetScoreInput').value, 10) || 0;
  const degree = document.getElementById('sheetDegreeSelect').value;
  const category = document.getElementById('sheetCategorySelect').value;
  const zone = currentSheetChoice('sheetZoneToggle');
  const studyMode = currentSheetChoice('sheetStudyModeToggle');
  const major = hasSubMajors(category) ? document.getElementById('sheetMajorSelect').value : null;
  const province = document.getElementById('sheetProvinceSelect').value || 'all';
  const result = category
    ? matchUniversities(score, degree, category, zone, major, province, studyMode)
    : { results: [] };
  document.getElementById('sheetMatchCount').textContent = `预计显示 ${result.results.length} 所院校`;
}

function renderSheetSearchMatches(query) {
  const container = document.getElementById('sheetSearchMatches');
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    container.innerHTML = '';
    return;
  }
  const matches = UNIVERSITIES
    .filter((uni) => uni.name.toLowerCase().includes(normalized) || uni.province.toLowerCase().includes(normalized))
    .slice(0, 5);
  container.innerHTML = matches.length
    ? matches.map((uni) => `<button type="button" class="sheet-search-result" data-uni-name="${escapeHtml(uni.name)}"><span><strong>${escapeHtml(uni.name)}</strong><small>${escapeHtml(uni.province)} · ${escapeHtml(uni.zone)}区</small></span><em>${escapeHtml(uni.level)}</em></button>`).join('')
    : '<p class="sheet-search-empty">没有找到相符院校</p>';
}

function applyFilterSheet() {
  const degree = document.getElementById('sheetDegreeSelect').value;
  const category = document.getElementById('sheetCategorySelect').value;
  const score = document.getElementById('sheetScoreInput').value;
  currentDegree = degree;
  setActiveToggle('degreeToggle', degree);
  updateCategorySelect();
  document.getElementById('categorySelect').value = category;
  checkMajorVisibility();
  if (hasSubMajors(category)) {
    document.getElementById('majorSelect').value = document.getElementById('sheetMajorSelect').value;
  }
  currentProvince = document.getElementById('sheetProvinceSelect').value || 'all';
  document.getElementById('provinceSelect').value = currentProvince;
  currentZone = currentSheetChoice('sheetZoneToggle');
  currentStudyMode = currentSheetChoice('sheetStudyModeToggle');
  setActiveToggle('zoneToggle', currentZone);
  setActiveToggle('studyModeToggle', currentStudyMode);
  document.getElementById('scoreInput').value = score;
  updateHomeDashboard();
  closeFilterSheet();
  doSearch();
}

// ==================== 我的页 ====================

function renderMyPage() {
  // 目标分数
  const target = getTargetScore();
  document.getElementById('myTargetScore').textContent = target.score || '365';
  document.getElementById('myTargetDegree').textContent = target.score ? (target.degree === 'xueshuo' ? '学硕' : '专硕') : '学硕';
  document.getElementById('myTargetCategory').textContent = target.category || '工学';

  // 收藏院校
  const favs = getFavorites();
  document.getElementById('myFavCount').textContent = favs.length;
  const favList = document.getElementById('myFavList');
  const favEmpty = document.getElementById('myFavEmpty');
  if (favs.length === 0) {
    favList.innerHTML = '';
    favList.appendChild(favEmpty);
    favEmpty.style.display = '';
  } else {
    favEmpty.style.display = 'none';
    favList.innerHTML = favs.map(name => {
      const uni = findUniversity(name);
      const meta = uni ? `${uni.province} · ${uni.level} · ${uni.zone}区` : '';
      return `<button class="my-list-item" type="button" data-uni-name="${escapeHtml(name)}">
        <div class="my-list-item-main"><strong>${escapeHtml(name)}</strong><small>${meta}</small></div>
        <div class="my-list-item-actions">
          <span class="my-list-item-badge">${uni ? uni.level : ''}</span>
          <span class="my-list-item-del" data-uni-name="${escapeHtml(name)}" title="取消收藏">×</span>
        </div>
      </button>`;
    }).join('');
    if (favEmpty.parentNode === favList) favList.appendChild(favEmpty);
  }

  // 浏览历史
  const hist = getBrowseHistory();
  const histList = document.getElementById('myHistoryList');
  const histEmpty = document.getElementById('myHistoryEmpty');
  if (hist.length === 0) {
    histList.innerHTML = '';
    histList.appendChild(histEmpty);
    histEmpty.style.display = '';
  } else {
    histEmpty.style.display = 'none';
    histList.innerHTML = hist.map(name => {
      const uni = findUniversity(name);
      const meta = uni ? `${uni.province} · ${uni.zone}区` : '';
      return `<button class="my-list-item" type="button" data-uni-name="${escapeHtml(name)}">
        <div class="my-list-item-main"><strong>${escapeHtml(name)}</strong><small>${meta}</small></div>
        <div class="my-list-item-actions">
          <span class="my-list-item-badge">${uni ? uni.level : ''}</span>
        </div>
      </button>`;
    }).join('');
    if (histEmpty.parentNode === histList) histList.appendChild(histEmpty);
  }
}

function initMyPageEvents() {
  // 编辑目标
  document.getElementById('myEditTargetBtn').addEventListener('click', () => {
    const target = getTargetScore();
    const newScore = prompt('请输入目标分数（0-500）：', target.score || '');
    if (newScore === null) return;
    const score = parseInt(newScore, 10);
    if (isNaN(score) || score < 0 || score > 500) { alert('请输入 0-500 之间的分数'); return; }

    const degree = confirm('点击「确定」选择学硕，点击「取消」选择专硕') ? 'xueshuo' : 'zhuanshuo';

    const categories = getCategories(degree);
    const catList = categories.join(' / ');
    const category = prompt(`请输入目标门类（${catList}）：`, target.category || '工学');
    if (!category || !categories.includes(category)) {
      alert(`无效门类。可选：${catList}`);
      return;
    }

    saveTargetScore({ score, degree, category });
    renderMyPage();
  });

  // 收藏列表：点击跳转详情 / 删除
  document.getElementById('myFavList').addEventListener('click', (e) => {
    const delBtn = e.target.closest('.my-list-item-del');
    if (delBtn) {
      e.stopPropagation();
      toggleFavorite(delBtn.dataset.uniName);
      renderMyPage();
      return;
    }
    const item = e.target.closest('.my-list-item');
    if (item) {
      const uni = findUniversity(item.dataset.uniName);
      if (uni) {
        const result = buildDetailResult(uni);
        openDetailPage(result);
      }
    }
  });

  // 浏览历史：点击跳转详情
  document.getElementById('myHistoryList').addEventListener('click', (e) => {
    const item = e.target.closest('.my-list-item');
    if (item) {
      const uni = findUniversity(item.dataset.uniName);
      if (uni) {
        const result = buildDetailResult(uni);
        openDetailPage(result);
      }
    }
  });

  // 清空历史
  document.getElementById('myClearHistoryBtn').addEventListener('click', () => {
    if (confirm('确定清空所有浏览记录？')) {
      clearBrowseHistory();
      renderMyPage();
    }
  });

  // 快捷操作
  document.getElementById('myOpenDataBtn').addEventListener('click', () => openEditModal());
  document.getElementById('myOpenDataBtn2').addEventListener('click', () => openEditModal());
  document.getElementById('myExportBtn').addEventListener('click', exportAllData);
  document.getElementById('myShareBtn').addEventListener('click', () => {
    const url = location.href;
    if (navigator.share) {
      navigator.share({ title: '考研择校助手', url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => alert('链接已复制到剪贴板！')).catch(() => alert('复制失败，请手动复制地址栏链接'));
    }
  });
  document.getElementById('myFeedbackBtn').addEventListener('click', () => {
    window.open('https://github.com/Forever322/kaoyan-app/issues/new', '_blank');
  });
}
