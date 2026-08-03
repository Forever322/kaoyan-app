// 考研择校助手 - 主应用逻辑

import { matchUniversities, sortResults, evaluateMatch } from './matcher.js';
import { initStorage, saveLastSearch, getLastSearch, exportAllData } from './storage.js';
import { UNIVERSITIES, findUniversity } from './data/universities.js';
import { getAdmissionScores } from './data/admission-scores.js';
import { getCategories, hasSubMajors, getMajorsForCategory } from './data/national-lines.js';
import { shakeElement, escapeHtml, debounce } from './utils.js';
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

function bootstrapApp() {
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
let _navState = 'home';
let _activeScreen = 'home';
let _detailReturnScreen = 'home';
let _filterCloseTimer;
let _footerOverlayIndex = null;

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
  const activeNav = screen === 'home' ? 'homeNavBtn' : 'openFilterNavBtn';
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
    setFooterActiveIndex(Math.round(cancelledDrag.initialIndex));
  });

  footer.addEventListener('click', (event) => {
    if (!suppressNativeClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressNativeClick = false;
  }, true);
}

function showScreen(target) {
  target.classList.remove('screen-entering');
  target.classList.add('is-active', 'screen-entering');
  target.addEventListener('animationend', (event) => {
    if (event.animationName === 'screenFadeIn') target.classList.remove('screen-entering');
  }, { once: true });
}

function setActiveScreen(screen) {
  const target = document.getElementById(`${screen}Screen`);
  const current = document.querySelector('.app-screen.is-active');
  if (!target) return;

  if (current && current !== target) {
    current.classList.remove('is-active', 'screen-entering');
    showScreen(target);
  } else {
    target.classList.add('is-active');
  }
  _activeScreen = screen;
  _navState = screen;
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

function openDetailPage(result) {
  _detailReturnScreen = _activeScreen;
  showDetail(result, { degree: currentDegree, zone: currentZone });
  _navState = 'detail';
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
  _navState = 'modal';
  history.pushState({ view: 'modal', returnScreen: _activeScreen }, '');
}

function closeEditModal() {
  if (history.state?.view === 'modal') {
    history.back();
    return;
  }
  hideModal();
  _navState = _activeScreen;
  restoreFooterNavAfterOverlay();
}

// ==================== UI 初始化 ====================
function initUI() {
  initCombobox('categorySelect', { placeholder: '🔍 选择学科门类...', emitChange: true });
  updateCategorySelect();
  initCombobox('majorSelect', { placeholder: '🔍 输入关键词筛选专业...', alwaysShowAll: true });
  updateMajorSelect();
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



  // 全局院校搜索（防抖）
  const globalSearch = document.getElementById('globalUniSearch');
  const globalDropdown = document.getElementById('globalUniDropdown');
  if (globalSearch && globalDropdown) {
    const debouncedGlobalSearch = debounce(() => {
      const q = globalSearch.value.trim().toLowerCase();
      if (!q) {
        globalDropdown.style.display = 'none';
        return;
      }
      const matches = UNIVERSITIES.filter(
        (u) => u.name.toLowerCase().includes(q) || u.province.toLowerCase().includes(q),
      ).slice(0, 15);
      if (matches.length === 0) {
        globalDropdown.innerHTML =
          '<div style="padding:14px;color:#999;text-align:center;font-size:0.85rem;">未找到匹配院校</div>';
      } else {
        globalDropdown.innerHTML = matches
          .map(
            (u) => `
        <div class="header-search-item" data-uni-name="${escapeHtml(u.name)}">
          <span class="s-name">${escapeHtml(u.name)}</span>
          <span class="s-level">${escapeHtml(u.level)}</span>
          <span class="s-loc">📍 ${escapeHtml(u.province)}${u.city && u.city !== u.province ? ' ' + escapeHtml(u.city) : ''}</span>
        </div>
      `,
          )
          .join('');
      }
      globalDropdown.style.display = 'block';
    }, 150);
    globalSearch.addEventListener('input', debouncedGlobalSearch);
    globalSearch.addEventListener('blur', () => {
      setTimeout(() => {
        globalDropdown.style.display = 'none';
      }, 200);
    });
    globalSearch.addEventListener('focus', () => {
      if (globalSearch.value.trim()) globalDropdown.style.display = 'block';
    });
    globalDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.header-search-item');
      if (!item) return;
      const uni = findUniversity(item.dataset.uniName);
      if (uni) {
        openUniversityDetail(uni);
        globalDropdown.style.display = 'none';
        globalSearch.value = '';
      }
    });
  }

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
  document.getElementById('prepNavBtn').addEventListener('click', () => openFilterSheet({ footerIndex: 2 }));
  document.getElementById('profileNavBtn').addEventListener('click', () => openEditModal({ footerIndex: 3 }));
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
    setSheetChoice('sheetDegreeOptions', e.target.value);
    populateSheetCategories(e.target.value, document.getElementById('sheetCategorySelect').value);
    populateSheetMajors(document.getElementById('sheetCategorySelect').value);
    updateSheetEstimate();
  });
  document.getElementById('sheetCategorySelect').addEventListener('change', (e) => {
    setSheetChoice('sheetCategoryOptions', e.target.value);
    populateSheetMajors(e.target.value);
    updateSheetEstimate();
  });
  document.getElementById('sheetMajorSelect').addEventListener('change', updateSheetEstimate);
  document.getElementById('sheetProvinceSelect').addEventListener('change', (e) => {
    setSheetChoice('sheetProvinceOptions', e.target.value);
    updateSheetProvinceLabel();
    updateSheetEstimate();
  });
  document.getElementById('sheetScoreInput').addEventListener('input', updateSheetEstimate);
  ['sheetZoneToggle', 'sheetStudyModeToggle'].forEach((containerId) => {
    document.getElementById(containerId).addEventListener('click', (e) => {
      const button = e.target.closest('button[data-value]');
      if (button) {
        setSheetChoice(containerId, button.dataset.value);
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
    if (['home', 'results', 'fail'].includes(view)) setActiveScreen(view);
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
  setSheetChoice('sheetCategoryOptions', select.value);
}

function populateSheetMajors(category, selectedValue = '') {
  const row = document.getElementById('sheetMajorRow');
  const select = document.getElementById('sheetMajorSelect');
  const shouldShow = hasSubMajors(category);
  row.hidden = !shouldShow;
  if (!shouldShow) {
    select.innerHTML = '';
    return;
  }
  const majors = getMajorsForCategory(category);
  const currentMajor = selectedValue || document.getElementById('majorSelect').value;
  select.innerHTML = majors.map((major) => `<option value="${escapeHtml(major)}">${escapeHtml(major)}</option>`).join('');
  select.value = majors.includes(currentMajor) ? currentMajor : majors[0];
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
  setSheetChoice('sheetProvinceOptions', select.value);
  updateSheetProvinceLabel();
}

function updateSheetProvinceLabel() {
  const select = document.getElementById('sheetProvinceSelect');
  const current = select.options[select.selectedIndex];
  document.getElementById('sheetProvinceCurrent').textContent = current?.textContent || '全部省份';
}

function setSheetChoice(containerId, value) {
  document.querySelectorAll(`#${containerId} button`).forEach((button) => {
    button.classList.toggle('active', button.dataset.value === value);
  });
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
  setSheetChoice('sheetDegreeOptions', currentDegree);
  populateSheetCategories(currentDegree, category);
  populateSheetMajors(category, document.getElementById('majorSelect').value);
  populateSheetProvinces();
  setSheetChoice('sheetZoneToggle', currentZone);
  setSheetChoice('sheetStudyModeToggle', currentStudyMode);
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
