// 考研择校助手 - 主应用逻辑

import { matchUniversities, sortResults, evaluateMatch } from './matcher.js';
import { initStorage, saveLastSearch, getLastSearch, exportAllData } from './storage.js';
import { UNIVERSITIES, findUniversity } from './data/universities.js';
import { getAdmissionScores } from './data/admission-scores.js';
import { getCategories, hasSubMajors, getMajorsForCategory } from './data/national-lines.js';
import { shakeElement, escapeHtml, debounce } from './utils.js';
import { renderResults, renderNationalLine } from './render.js';
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

document.addEventListener('DOMContentLoaded', async () => {
  // 初始化本地数据库
  try {
    const stats = await checkAndSeed();
    console.log('[App] DB ready:', stats);
  } catch (e) {
    console.warn('[App] DB init failed, using in-memory data:', e);
  }

  initStorage();
  initUI();
  bindEvents();
  restoreLastSearch();
  initHistoryNav();

  // 后台检查更新（不阻塞启动）
  checkForUpdate();
});

let currentDegree = 'xueshuo';
let currentZone = 'A';
let currentProvince = 'all';
let currentStudyMode = 'all';
let currentResults = [];
let _navState = 'home';

// ==================== 导航封装 ====================
function openDetailPage(result) {
  showDetail(result, { degree: currentDegree, zone: currentZone });
  _navState = 'detail';
  history.pushState({ view: 'detail' }, '');
}

function closeDetailPage() {
  hideDetail();
  _navState = 'home';
}

function openEditModal() {
  showModal();
  _navState = 'modal';
  history.pushState({ view: 'modal' }, '');
}

function closeEditModal() {
  hideModal();
  _navState = 'home';
}

// ==================== UI 初始化 ====================
function initUI() {
  initCombobox('categorySelect', { placeholder: '🔍 选择学科门类...', emitChange: true });
  updateCategorySelect();
  initCombobox('majorSelect', { placeholder: '🔍 输入关键词筛选专业...', alwaysShowAll: true });
  updateMajorSelect();
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
    clearResults();
  });

  // 省份筛选
  document.getElementById('provinceSelect').addEventListener('change', (e) => {
    currentProvince = e.target.value;
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
    clearResults();
  });

  // 门类切换
  document.getElementById('categorySelect').addEventListener('change', () => {
    checkMajorVisibility();
    clearResults();
  });



  // 全局院校搜索（防抖）
  const globalSearch = document.getElementById('globalUniSearch');
  const globalDropdown = document.getElementById('globalUniDropdown');
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
      const userScore = parseInt(document.getElementById('scoreInput').value) || 0;
      const category = document.getElementById('categorySelect').value;
      const majorEl = document.getElementById('majorSelect');
      const major =
        hasSubMajors(category) && majorEl.style.display !== 'none' ? majorEl.value : null;
      const admissionScores = getAdmissionScores(uni.name, category, currentDegree, major);
      const matchResult = evaluateMatch(userScore, admissionScores);
      openDetailPage({
        university: uni,
        admissionScores,
        verdict: matchResult.verdict,
        verdictLabel: matchResult.label,
        verdictClass: matchResult.cssClass,
        avgScore: matchResult.avgScore,
      });
      globalDropdown.style.display = 'none';
      globalSearch.value = '';
    }
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

  // 管理院校列表（事件委托：删除 + 打开详情）
  document.getElementById('uniList').addEventListener('click', (e) => {
    const delBtn = e.target.closest('.uni-edit-del');
    if (delBtn) {
      const row = delBtn.closest('.uni-edit-item');
      if (row) handleDeleteUniversity(row.dataset.uniName);
      return;
    }
    const row = e.target.closest('.uni-edit-item');
    if (!row) return;
    const name = row.dataset.uniName;
    if (name) {
      const uni = findUniversity(name);
      if (uni) {
        const category = document.getElementById('categorySelect').value;
        const major = document.getElementById('majorSelect').value;
        const result = matchUniversities(
          parseInt(document.getElementById('scoreInput').value) || 0,
          currentDegree,
          category,
          currentZone,
          hasSubMajors(category) ? major : null,
        );
        const matched = result.results.find((r) => r.university.name === name);
        if (matched) {
          closeEditModal();
          setTimeout(() => openDetailPage(matched), 300);
        }
      }
    }
  });

  // B区尝试
  document.getElementById('tryBZoneBtn').addEventListener('click', () => {
    currentZone = 'B';
    document.querySelectorAll('#zoneToggle .toggle-btn').forEach((b) => {
      b.classList.remove('active');
      if (b.dataset.value === 'B') b.classList.add('active');
    });
    doSearch();
  });

  // 底部按钮
  document.getElementById('editDataBtn').addEventListener('click', openEditModal);
  document.getElementById('exportDataBtn').addEventListener('click', exportAllData);

  // 弹窗
  document.getElementById('closeModalBtn').addEventListener('click', closeEditModal);
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditModal();
  });
  document.querySelectorAll('.modal-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      switchModalTab(tab.dataset.tab);
    });
  });
  document.getElementById('uniSearchInput').addEventListener('input', (e) => {
    renderUniEditList(e.target.value);
  });
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

  if (isNaN(score) || score < 0 || score > 500) {
    shakeElement(scoreInput);
    scoreInput.focus();
    return;
  }

  const category = document.getElementById('categorySelect').value;
  if (!category) return;

  const majorSelect = document.getElementById('majorSelect');
  const major = hasSubMajors(category) ? majorSelect.value : null;

  saveLastSearch({ score, degree: currentDegree, category, zone: currentZone, province: currentProvince, studyMode: currentStudyMode, major });

  const result = matchUniversities(score, currentDegree, category, currentZone, major, currentProvince, currentStudyMode);
  currentResults = result.results;

  renderNationalLine(result, {
    userScore: score,
    category,
    degree: currentDegree,
    zone: currentZone,
  });
  renderResults(result.results, { degree: currentDegree, zone: currentZone });

  const emptyState = document.getElementById('emptyState');
  const failState = document.getElementById('failState');
  const resultsSection = document.getElementById('resultsSection');

  if (result.passed === false) {
    emptyState.style.display = 'none';
    resultsSection.style.display = 'none';
    failState.style.display = 'block';
    const latestYear = result.nationalLine ? result.nationalLine.year : '';
    document.getElementById('failMsg').innerHTML =
      `<strong>你的 ${score} 分</strong> 未达到 ${currentZone}区「${escapeHtml(category)}」${currentDegree === 'xueshuo' ? '学硕' : '专硕'} 的${latestYear}年国家线 <strong>(${result.nationalLine.score}分)</strong><br><br>建议尝试<strong>B区</strong>院校（国家线通常低10分左右）`;
  } else if (result.results.length === 0) {
    emptyState.style.display = 'block';
    resultsSection.style.display = 'none';
    failState.style.display = 'none';
  } else {
    emptyState.style.display = 'none';
    failState.style.display = 'none';
    resultsSection.style.display = 'block';
  }

  if (result.results.length > 0 || result.passed === false) {
    setTimeout(() => {
      document.getElementById('nationalLineCard').scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }
}

// ==================== 状态管理 ====================
function clearResults() {
  currentResults = [];
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('failState').style.display = 'none';
  document.getElementById('emptyState').style.display = 'block';
  document.getElementById('nationalLineCard').style.display = 'none';
}

function restoreLastSearch() {
  const last = getLastSearch();
  if (!last) return;

  if (last.score) document.getElementById('scoreInput').value = last.score;
  if (last.degree) {
    currentDegree = last.degree;
    document.querySelectorAll('#degreeToggle .toggle-btn').forEach((b) => {
      b.classList.remove('active');
      if (b.dataset.value === last.degree) b.classList.add('active');
    });
    updateCategorySelect();
  }
  if (last.category) {
    const catDropdown = document.getElementById('categorySelect');
    catDropdown.value = last.category;
    catDropdown.dispatchEvent(new Event('change'));
  }
  if (last.major && document.getElementById('majorGroup').style.display !== 'none') {
    document.getElementById('majorSelect').value = last.major;
  }
  if (last.zone) {
    currentZone = last.zone;
    document.querySelectorAll('#zoneToggle .toggle-btn').forEach((b) => {
      b.classList.remove('active');
      if (b.dataset.value === last.zone) b.classList.add('active');
    });
  }
  if (last.province) {
    currentProvince = last.province;
    document.getElementById('provinceSelect').value = last.province;
  }
  if (last.studyMode) {
    currentStudyMode = last.studyMode;
    document.querySelectorAll('#studyModeToggle .toggle-btn').forEach((b) => {
      b.classList.remove('active');
      if (b.dataset.value === last.studyMode) b.classList.add('active');
    });
  }
}

// ==================== 导航历史管理 ====================
function initHistoryNav() {
  history.replaceState({ view: 'home' }, '');

  window.addEventListener('popstate', (e) => {
    const view = (e.state && e.state.view) || 'home';
    if (view === 'home') {
      if (_navState === 'detail') {
        hideDetail();
      } else if (_navState === 'modal') {
        hideModal();
      }
      _navState = 'home';
    }
  });
}

// ==================== 自动更新检测 ====================
const LOCAL_VERSION = '4.3';
const UPDATE_CHECK_URL = 'https://forever322.github.io/kaoyan-app/version.json';

async function checkForUpdate() {
  try {
    const resp = await fetch(UPDATE_CHECK_URL + '?t=' + Date.now());
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.version !== LOCAL_VERSION) {
      showUpdateBanner(data.version);
    }
  } catch {
    // 无网络或检查失败，静默跳过
  }
}

function showUpdateBanner(remoteVersion) {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;bottom:80px;left:16px;right:16px;z-index:100;background:#1a73e8;color:#fff;padding:12px 16px;border-radius:12px;display:flex;align-items:center;gap:12px;font-size:0.9rem;box-shadow:0 4px 16px rgba(0,0,0,0.3);animation:slideUp 0.3s ease-out';
  banner.innerHTML = `
    <span style="flex:1">🔄 发现新版本 v${remoteVersion}，是否更新？</span>
    <button id="updateYes" style="background:#fff;color:#1a73e8;border:none;padding:6px 14px;border-radius:6px;font-weight:600;cursor:pointer">更新</button>
    <button id="updateNo" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.5);padding:6px 14px;border-radius:6px;cursor:pointer">暂不</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('updateYes').onclick = () => {
    location.href = 'https://forever322.github.io/kaoyan-app/';
  };
  document.getElementById('updateNo').onclick = () => {
    banner.style.display = 'none';
  };
}