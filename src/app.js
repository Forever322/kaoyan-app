// 考研择校助手 - 主应用逻辑

import { matchUniversities, sortResults, evaluateMatch } from './matcher.js';
import { initStorage, saveLastSearch, getLastSearch, exportAllData, getFavorites, toggleFavorite, getBrowseHistory, clearBrowseHistory, getTargetScore, saveTargetScore } from './storage.js';
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
import {
  AgentApiError,
  applyAgentProposal,
  createAgentConversation,
  createAgentProposal,
  getAgentContext,
  getAgentConversation,
  listAgentConversations,
  listAgentProposals,
  sendAgentConversationMessage,
} from './agent-api.js';
import {
  getAuthenticatedUser,
  login,
  logout,
  register,
  restoreAuthSession,
} from './auth-api.js';
import {
  StudyApiError,
  createStudySession,
  getStudySummary,
  getUserPlans,
  updateUserPlan,
} from './study-api.js';
import {
  FavoriteApiError,
  addFavoriteByName,
  listFavoriteUniversities,
  removeFavoriteById,
} from './favorites-api.js';

function bootstrapApp() {
  initStudyTheme();
  // 匹配与详情直接读取静态数据；先完成可交互页面，IndexedDB 在后台做本地离线备份。
  initStorage();
  initUI();
  capturePrepTaskTemplate();
  updatePrepTaskMetrics();
  bindEvents();
  restoreLastSearch();
  normalizeSearchState();
  initHistoryNav();
  updateHomeDashboard();
  renderMyPage();
  renderPrepStudyData();
  renderPrepPlanMeta();
  renderAgentStudyOverview();

  initializeLocalDatabase();
  restoreAuthenticatedExperience();

  // 后台检查更新（不阻塞启动）
  checkForUpdate();
}

const STUDY_THEME_KEY = 'study_theme';
function getMyAuthProfile() {
  return getAuthenticatedUser();
}

function resetCloudFavoritesState() {
  cloudFavoritesState = { userId: null, records: [], loaded: false, loading: false, error: null };
  favoriteMutations.clear();
}

function cloudFavoritesForCurrentUser() {
  const user = getMyAuthProfile();
  if (!user || cloudFavoritesState.userId !== user.id) return null;
  return cloudFavoritesState;
}

function favoriteRecordsForView() {
  const user = getMyAuthProfile();
  const cloud = cloudFavoritesForCurrentUser();
  if (user) return cloud?.records || [];
  return getFavorites().map((universityName) => {
    const university = findUniversity(universityName);
    return {
      universityName,
      universityId: null,
      province: university?.province || '',
      city: university?.city || '',
      zone: university?.zone || '',
      level: university?.level || '',
      type: university?.type || '',
    };
  });
}

function favoriteNamesForCurrentView() {
  return favoriteRecordsForView().map((item) => item.universityName);
}

function updateDetailFavoriteButton(universityName, isFavorite) {
  const detailName = document.getElementById('detailName')?.textContent?.trim();
  if (detailName !== universityName) return;
  const button = document.getElementById('detailFavBtn');
  if (!button) return;
  button.textContent = isFavorite ? '★' : '☆';
  button.classList.toggle('is-faved', isFavorite);
}

async function refreshCloudFavorites({ render = true } = {}) {
  const user = getMyAuthProfile();
  if (!user) {
    resetCloudFavoritesState();
    if (render) renderMyPage();
    return [];
  }
  const userId = user.id;
  cloudFavoritesState = {
    userId,
    records: cloudFavoritesState.userId === userId ? cloudFavoritesState.records : [],
    loaded: false,
    loading: true,
    error: null,
  };
  if (render) renderMyPage();
  try {
    const records = await listFavoriteUniversities();
    if (getMyAuthProfile()?.id !== userId) return [];
    cloudFavoritesState = { userId, records, loaded: true, loading: false, error: null };
    if (render) renderMyPage();
    return records;
  } catch (error) {
    if (getMyAuthProfile()?.id !== userId) return [];
    cloudFavoritesState = { userId, records: [], loaded: false, loading: false, error };
    if (render) renderMyPage();
    return [];
  }
}

async function toggleUniversityFavorite(universityName) {
  const name = String(universityName || '').trim();
  if (!name || favoriteMutations.has(name)) return false;
  const user = getMyAuthProfile();

  // 未登录时维持原有离线收藏体验；登录后只以当前账号的云端数据为准。
  if (!user) {
    const isFavorite = toggleFavorite(name);
    updateDetailFavoriteButton(name, isFavorite);
    renderMyPage();
    return isFavorite;
  }

  if (cloudFavoritesState.userId !== user.id || !cloudFavoritesState.loaded) {
    await refreshCloudFavorites({ render: false });
    if (cloudFavoritesState.userId !== user.id || !cloudFavoritesState.loaded) {
      alert('收藏数据暂时无法同步，请检查网络后重试。');
      return false;
    }
  }

  favoriteMutations.add(name);
  try {
    const current = cloudFavoritesState.records.find((item) => item.universityName === name);
    let isFavorite;
    if (current) {
      await removeFavoriteById(current.universityId);
      cloudFavoritesState = {
        ...cloudFavoritesState,
        records: cloudFavoritesState.records.filter((item) => item.universityName !== name),
      };
      isFavorite = false;
    } else {
      const favorite = await addFavoriteByName(name);
      cloudFavoritesState = {
        ...cloudFavoritesState,
        records: [...cloudFavoritesState.records, favorite],
      };
      isFavorite = true;
    }
    updateDetailFavoriteButton(name, isFavorite);
    renderMyPage();
    return isFavorite;
  } catch (error) {
    const message = error instanceof FavoriteApiError
      ? error.message
      : '收藏同步失败，请稍后重试。';
    alert(message);
    return false;
  } finally {
    favoriteMutations.delete(name);
  }
}

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

function planText(plan, keys) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return '';
  for (const key of keys) {
    const value = plan[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function renderPrepPlanMeta() {
  const user = getMyAuthProfile();
  const plan = studyPlanState.plan;
  const configuredYear = Number(planText(admissionPlanState.plan, ['examYear', 'targetYear', '考试年份', '目标考试年份']));
  const now = new Date();
  let examYear = Number.isInteger(configuredYear) && configuredYear >= now.getFullYear() ? configuredYear : now.getFullYear() + 1;
  let examDate = new Date(examYear - 1, 11, 25);
  if (examDate.getTime() < now.getTime() && !configuredYear) {
    examYear += 1;
    examDate = new Date(examYear - 1, 11, 25);
  }
  const days = Math.max(0, Math.ceil((examDate.getTime() - now.getTime()) / 86_400_000));
  setText('prepExamYear', String(examYear));
  setText('prepDaysLeft', String(days));
  setText('prepStage', planText(plan, ['stage', 'phase', 'currentPhase', '阶段']) || (user ? '待确认计划' : '本机示例'));
  setText('prepNextMilestone', planText(plan, ['nextMilestone', 'milestone', 'nextNode', '近期节点']) || (user ? '创建或应用计划后同步节点' : '登录后根据计划同步节点'));
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
let activeAgentConversationId = null;
let activeAgentConversationUserId = null;
let activeAgentProposalType = 'study';
let activeAgentQuestions = { study: '', admission: '' };
// The backend keeps this as a small allow-list.  Keeping the type explicit in
// the UI means a newly opened chat always receives the reviewed coach policy,
// while earlier study-assistant conversations remain intact in the database.
const KAOYAN_COACH_AGENT_TYPE = 'kaoyan-coach';
let studyPlanState = { plan: {}, revision: 0, updatedAt: null };
let admissionPlanState = { plan: {}, revision: 0, updatedAt: null };
let studyTimerStartedAt = null;
let studySummaryState = { today: null, week: null };
let agentChatLoading = false;
let studyPlanSaving = false;
let admissionPlanSaving = false;
let authenticatedDataLoadVersion = 0;
let authenticatedUserId = null;
let _lastProfileNavigationAt = 0;
let offlinePrepTaskMarkup = '';
let cloudFavoritesState = { userId: null, records: [], loaded: false, loading: false, error: null };
const favoriteMutations = new Set();

const fallbackStudyProposal = {
  id: null,
  proposalType: 'study',
  status: 'empty',
  summary: '还没有待确认的云端计划。',
  rationale: '先和 AI 顾问聊聊，再主动生成一份可确认、可同步的计划。',
  changes: [{ operation: 'replace_study_plan', data: { items: [] } }],
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
  const previousIndex = buttons.findIndex((button) => button.classList.contains('active'));
  buttons.forEach((button, buttonIndex) => button.classList.toggle('active', buttonIndex === safeIndex));
  setFooterPillPosition(safeIndex);
  if (previousIndex !== safeIndex) {
    const footer = document.querySelector('.app-footer');
    footer?.classList.remove('is-sliding');
    void footer?.offsetWidth;
    footer?.classList.add('is-sliding');
    window.setTimeout(() => footer?.classList.remove('is-sliding'), 430);
  }
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function normalizedStudyItems(plan) {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  return items.map((item, index) => ({
    id: String(item?.id || item?.taskId || index),
    subject: String(item?.subject || '学习'),
    title: String(item?.title || item?.task || item?.name || '专项复习'),
    duration: String(item?.duration || item?.hours || item?.note || '按计划完成'),
    note: String(item?.note || item?.description || ''),
    completed: item?.completed === true || item?.status === 'completed',
  }));
}

function normalizedAdmissionPlan(plan) {
  const source = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : {};
  const read = (...keys) => {
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return '';
  };
  const scoreRaw = read('targetScore', 'target_score', 'score', 'expectedScore', '目标分数', '分数');
  const numericScore = Number(scoreRaw);
  return {
    university: read('university', 'school', 'targetUniversity', 'targetSchool', 'universityName', '院校', '学校', '目标院校', '院校名称'),
    major: read('major', 'targetMajor', 'majorName', '专业', '目标专业', '专业名称'),
    majorCode: read('majorCode', 'major_code', 'code', '专业代码'),
    degree: read('degree', 'degreeType', 'targetDegree', '学位类型', '学硕专硕'),
    category: read('category', 'discipline', 'subjectCategory', 'targetCategory', '学科门类'),
    score: Number.isFinite(numericScore) && numericScore > 0 ? String(Math.round(numericScore)) : scoreRaw,
  };
}

function visibleStudyPlan() {
  const list = document.getElementById('prepTaskList');
  if (!list) return { items: [] };
  return {
    ...(studyPlanState?.plan && typeof studyPlanState.plan === 'object' ? studyPlanState.plan : {}),
    items: [...list.querySelectorAll('.prep-task')].map((task, index) => ({
      id: task.dataset.planItemId || task.dataset.taskId || String(index),
      subject: task.querySelector('small')?.textContent?.trim() || '学习',
      title: task.querySelector('strong')?.textContent?.trim() || '专项复习',
      duration: task.querySelector('em')?.textContent?.trim() || '',
      completed: task.classList.contains('is-complete'),
    })),
  };
}

function updatePrepTaskMetrics() {
  const tasks = [...document.querySelectorAll('#prepTaskList .prep-task')];
  if (!tasks.length) return;
  const completed = tasks.filter((task) => task.classList.contains('is-complete')).length;
  const total = tasks.length;
  const rate = Math.round((completed / total) * 100);
  setText('prepTaskProgress', `${completed} / ${total} 项`);
  setText('prepCompletionRate', `${rate}%`);
  setText('prepWeekProgress', `${completed} / ${total}`);
  tasks.forEach((task) => {
    const check = task.querySelector('.prep-task-check');
    if (check) check.textContent = task.classList.contains('is-complete') ? '✓' : '';
  });
}

function capturePrepTaskTemplate() {
  const list = document.getElementById('prepTaskList');
  if (list && !offlinePrepTaskMarkup) offlinePrepTaskMarkup = list.innerHTML;
}

function renderOfflinePrepTasks() {
  const list = document.getElementById('prepTaskList');
  if (list && offlinePrepTaskMarkup) list.innerHTML = offlinePrepTaskMarkup;
  updatePrepTaskMetrics();
}

function renderStudyPlan(plan) {
  const items = normalizedStudyItems(plan);
  const list = document.getElementById('prepTaskList');
  if (!items.length) {
    if (getMyAuthProfile() && list) {
      list.innerHTML = '<div class="prep-plan-empty"><strong>还没有云端学习计划</strong><small>可以先和 AI 学习顾问聊聊，再确认并应用一份计划。</small><button type="button" data-open-agent-chat>生成学习计划</button></div>';
      setText('prepTaskProgress', '0 / 0 项');
      setText('prepCompletionRate', '—');
      setText('prepWeekProgress', '0 / 0');
      return;
    }
    updatePrepTaskMetrics();
    return;
  }
  if (!list) return;
  list.innerHTML = items.map((item) => `
    <button class="prep-task${item.completed ? ' is-complete' : ''}" type="button" data-plan-item-id="${escapeHtml(item.id)}">
      <span class="prep-task-check">${item.completed ? '✓' : ''}</span>
      <span><small>${escapeHtml(item.subject)}</small><strong>${escapeHtml(item.title)}</strong></span>
      <em>${escapeHtml(item.duration)}</em>
    </button>
  `).join('');
  updatePrepTaskMetrics();
}

function renderMyStudyData() {
  const user = getMyAuthProfile();
  const week = studySummaryState.week;
  const today = studySummaryState.today;
  const subjectList = document.getElementById('mySubjectList');
  if (!user) {
    setText('myWeekStudyTime', '—');
    setText('myWeekDailyAverage', '登录后同步');
    setText('myWeekSessionCount', '—');
    setText('myPlanSyncStatus', '未同步');
    setText('myTodayStudyTime', '—');
    setText('myDataSourceTitle', '云端数据待连接');
    setText('myDataSourceText', '登录后，学习记录、计划与 AI 建议会同步到你的账号。');
    if (subjectList) subjectList.innerHTML = '<p><span>登录后</span><i><b style="width:0%"></b></i><em>—</em></p>';
    return;
  }

  const weekSeconds = Number(week?.durationS || 0);
  const todaySeconds = Number(today?.durationS || 0);
  const dayAverage = weekSeconds ? formatDuration(Math.round(weekSeconds / 7)) : '0m';
  setText('myWeekStudyTime', formatDuration(weekSeconds));
  setText('myWeekDailyAverage', `日均 ${dayAverage}`);
  setText('myWeekSessionCount', `${Number(week?.sessionCount || 0)} 条`);
  setText('myPlanSyncStatus', studyPlanState?.updatedAt ? '已同步' : '待设置');
  setText('myTodayStudyTime', formatDuration(todaySeconds));
  setText('myDataSourceTitle', '云端同步已开启');
  setText('myDataSourceText', '学习记录、计划与 AI 建议均会保存到当前账号。');

  if (!subjectList) return;
  const subjects = Array.isArray(week?.bySubject) ? week.bySubject : [];
  const max = Math.max(1, ...subjects.map((item) => Number(item.durationS || 0)));
  subjectList.innerHTML = subjects.length
    ? subjects.slice(0, 4).map((item) => {
      const width = Math.max(6, Math.round((Number(item.durationS || 0) / max) * 100));
      return `<p><span>${escapeHtml(item.subject)}</span><i><b style="width:${width}%"></b></i><em>${formatDuration(item.durationS)}</em></p>`;
    }).join('')
    : '<p><span>尚无记录</span><i><b style="width:0%"></b></i><em>0m</em></p>';
}

function renderPrepStudyData() {
  const user = getMyAuthProfile();
  const todaySeconds = Number(studySummaryState.today?.durationS || 0);
  if (!user) {
    setText('prepStudyTime', '登录后同步 / 8h');
    return;
  }
  setText('prepStudyTime', `${formatDuration(todaySeconds)} / 8h`);
}

function renderAgentStudyOverview() {
  const user = getMyAuthProfile();
  const week = studySummaryState.week;
  const weekSeconds = Number(week?.durationS || 0);
  const sessions = Number(week?.sessionCount || 0);
  const topSubject = week?.bySubject?.[0]?.subject || '暂无';
  const hasStudyData = weekSeconds > 0 || sessions > 0;
  setText('agentStatus', user ? (hasStudyData ? '✦ 已同步' : '✦ 待记录') : '✦ 待登录');
  setText('agentChatStatus', user ? '已登录 · 等待同步最新数据' : '登录后同步云端学习数据');

  setText('agentWeekHeadline', user
    ? (hasStudyData ? '已根据你的真实学习记录生成概览' : '先记录一次学习，再生成个性化建议')
    : '登录后生成个性化建议');
  setText('agentWeekRange', user ? '最近 7 天' : '等待登录');
  setText('agentWeekStudyTime', user ? formatDuration(weekSeconds) : '—');
  setText('agentWeekStudyMeta', user ? '近 7 天累计' : '登录后同步');
  setText('agentWeekSessionCount', user ? String(sessions) : '—');
  setText('agentWeekSessionMeta', user ? '条学习记录' : '等待同步');
  setText('agentWeekPriority', user ? topSubject : '—');
  setText('agentWeekPriorityMeta', user ? (hasStudyData ? '投入时长最高' : '暂无学习数据') : '暂无数据');
}

async function refreshAuthenticatedData() {
  const loadVersion = ++authenticatedDataLoadVersion;
  const user = getMyAuthProfile();
  if (!user) {
    resetAuthenticatedUiState();
    renderOfflinePrepTasks();
    renderMyStudyData();
    renderPrepStudyData();
    renderPrepPlanMeta();
    renderAgentStudyOverview();
    renderMyPage();
    return;
  }
  const requestUserId = user.id;
  const [todayResult, weekResult, planResult] = await Promise.allSettled([
    getStudySummary(1),
    getStudySummary(7),
    getUserPlans(),
  ]);
  // 登录切换或退出期间返回的旧请求不能覆盖新账号的界面。
  if (loadVersion !== authenticatedDataLoadVersion || getMyAuthProfile()?.id !== requestUserId) return;
  if (todayResult.status === 'fulfilled') studySummaryState.today = todayResult.value;
  if (weekResult.status === 'fulfilled') studySummaryState.week = weekResult.value;
  if (planResult.status === 'fulfilled') {
    const plans = planResult.value?.plans || {};
    const studyState = plans.study;
    const admissionState = plans.admission;
    if (studyState) {
      studyPlanState = studyState;
      renderStudyPlan(studyState.plan);
    }
    if (admissionState) admissionPlanState = admissionState;
  }
  await refreshCloudFavorites({ render: false });
  if (loadVersion !== authenticatedDataLoadVersion || getMyAuthProfile()?.id !== requestUserId) return;
  renderMyStudyData();
  renderPrepStudyData();
  renderPrepPlanMeta();
  renderAgentStudyOverview();
  renderMyPage();
}

function resetAuthenticatedUiState() {
  studySummaryState = { today: null, week: null };
  studyPlanState = { plan: {}, revision: 0, updatedAt: null };
  admissionPlanState = { plan: {}, revision: 0, updatedAt: null };
  activeAgentConversationId = null;
  activeAgentConversationUserId = null;
  activeAgentProposal = null;
  activeAgentQuestions = { study: '', admission: '' };
  studyTimerStartedAt = null;
  agentChatLoading = false;
  resetCloudFavoritesState();
}

async function restoreAuthenticatedExperience() {
  try {
    const session = await restoreAuthSession();
    if (session) {
      localStorage.removeItem('my_auth_profile');
      await refreshAuthenticatedData();
    }
  } catch (error) {
    // 网络短暂不可用时保留本地登录态；界面会在下次请求时重新验证。
    console.warn('[Auth] 恢复登录态失败：', error);
  }
  renderMyPage();
}

async function persistVisibleStudyPlan() {
  if (!getMyAuthProfile() || studyPlanSaving) return;
  studyPlanSaving = true;
  const nextPlan = visibleStudyPlan();
  try {
    const response = await updateUserPlan('study', nextPlan, studyPlanState.revision);
    studyPlanState = {
      plan: response?.plan || nextPlan,
      revision: Number(response?.revision ?? studyPlanState.revision),
      updatedAt: response?.updatedAt || studyPlanState.updatedAt,
    };
    renderMyStudyData();
  } catch (error) {
    if (error instanceof StudyApiError && error.status === 409) {
      await refreshAuthenticatedData();
      alert('你的计划已在其他设备更新，页面已刷新为最新版本。');
    } else {
      alert(error instanceof Error ? `计划同步失败：${error.message}` : '计划同步失败，请稍后重试。');
    }
  } finally {
    studyPlanSaving = false;
  }
}

async function handlePrepTaskClick(event) {
  if (event.target.closest('[data-open-agent-chat]')) {
    openAgentChat();
    return;
  }
  const task = event.target.closest('.prep-task');
  if (!task || studyPlanSaving) return;
  task.classList.toggle('is-complete');
  updatePrepTaskMetrics();
  if (getMyAuthProfile()) await persistVisibleStudyPlan();
}

function showAuthError(message) {
  const element = document.getElementById('myAuthError');
  if (!element) return;
  const text = String(message || '').trim();
  element.hidden = !text;
  element.textContent = text;
}

function setAuthFormMode(mode) {
  const form = document.getElementById('myAuthForm');
  if (!form) return;
  const isLogin = mode === 'login';
  form.dataset.mode = isLogin ? 'login' : 'register';
  const emailRow = document.getElementById('myAuthEmailRow');
  const password = document.getElementById('myAuthPasswordInput');
  const submit = document.getElementById('myAuthSubmitBtn');
  const switchButton = document.getElementById('myAuthSwitchBtn');
  const status = document.getElementById('myAuthStatus');
  if (emailRow) emailRow.hidden = isLogin;
  if (password) password.autocomplete = isLogin ? 'current-password' : 'new-password';
  if (submit) submit.textContent = isLogin ? '登录' : '注册并登录';
  if (switchButton) switchButton.textContent = isLogin ? '没有账号，去注册' : '已有账号，去登录';
  if (status) status.textContent = isLogin
    ? '输入已注册的昵称和密码，即可继续同步。'
    : '注册后将创建一个可跨设备同步的备考账号。';
  showAuthError('');
}

async function toggleStudyTimer() {
  if (!getMyAuthProfile()) {
    alert('登录后即可把学习时长同步到云端。');
    openMyScreen();
    return;
  }
  const buttons = ['startStudyBtn', 'openTimerBtn'].map((id) => document.getElementById(id)).filter(Boolean);
  if (!studyTimerStartedAt) {
    studyTimerStartedAt = Date.now();
    setText('prepStudyTime', '正在计时');
    buttons.forEach((button) => {
      button.classList.add('is-running');
      button.textContent = 'Ⅱ 正在专注';
    });
    return;
  }

  const startedAt = studyTimerStartedAt;
  const endedAt = Date.now();
  const durationS = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  studyTimerStartedAt = null;
  const activeTask = document.querySelector('#prepTaskList .prep-task:not(.is-complete)') || document.querySelector('#prepTaskList .prep-task');
  const subject = activeTask?.querySelector('small')?.textContent?.trim() || '自习';
  const content = activeTask?.querySelector('strong')?.textContent?.trim() || '专注学习';
  buttons.forEach((button) => {
    button.disabled = true;
    button.textContent = '正在同步…';
  });
  try {
    await createStudySession({
      subject,
      content,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationS,
    });
    await refreshAuthenticatedData();
    buttons.forEach((button) => { button.textContent = `✓ 已记录 ${formatDuration(durationS)}`; });
  } catch (error) {
    buttons.forEach((button) => { button.textContent = '▷ 开始学习'; });
    renderPrepStudyData();
    alert(error instanceof Error ? `学习记录同步失败：${error.message}` : '学习记录同步失败，请稍后重试。');
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
      button.classList.remove('is-running');
    });
  }
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
  let suppressNextNativeClick = false;

  const getPosition = (clientX) => {
    const rect = footer.getBoundingClientRect();
    const inset = 6;
    const slotWidth = (rect.width - inset * 2) / buttons.length;
    return Math.max(0, Math.min(buttons.length - 1, (clientX - rect.left - inset - slotWidth / 2) / slotWidth));
  };

  // 普通点按继续走各按钮原生 click；只有明确横向拖动才手动切换。
  footer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { pointerId: event.pointerId, startX: event.clientX, moved: false };
  });

  footer.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < 10) return;
    drag.moved = true;
    footer.classList.add('is-dragging');
    setFooterPillPosition(getPosition(event.clientX));
    if (event.cancelable) event.preventDefault();
  }, { passive: false });

  footer.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const completed = drag;
    drag = null;
    footer.classList.remove('is-dragging');
    if (!completed.moved) return;
    // 阻止 Android 在页面已切换后，把同一次手势补发成点击新页面内容。
    if (event.cancelable) event.preventDefault();

    const button = buttons[Math.round(getPosition(event.clientX))];
    if (!button) return;
    setFooterActiveIndex(buttons.indexOf(button));
    // 不使用 pointer capture；此处只处理真正的拖动，并拦截它随后补发的一次 click。
    button.click();
    suppressNextNativeClick = true;
    window.setTimeout(() => { suppressNextNativeClick = false; }, 400);
  });

  footer.addEventListener('pointercancel', () => {
    drag = null;
    footer.classList.remove('is-dragging');
    updateFooterNav(_activeScreen);
  });

  // 兼容部分 Android WebView：补发的 click 可能已不在 footer 内，而是落到
  // 新页面刚渲染的首张院校卡片，因此必须在 document 捕获阶段拦截。
  document.addEventListener('click', (event) => {
    if (!suppressNextNativeClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressNextNativeClick = false;
  }, true);

  footer.addEventListener('click', (event) => {
    const button = event.target.closest('.footer-nav-btn');
    const index = buttons.indexOf(button);
    if (index >= 0) setFooterActiveIndex(index);
  });
}

// 屏幕层级：home 为基础层，results / fail 为下钻层，用于推导过渡方向。
const SCREEN_TRANSITION_MS = 180;

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

function setActiveScreen(screen) {
  const target = document.getElementById(`${screen}Screen`);
  const current = document.querySelector('.app-screen.is-active:not(.screen-exiting)');
  if (!target) return;

  // 任何情况下都只能保留一个活动主页面。旧版本动画被中断时可能遗留多个
  // is-active，导致后插入的“我的”页面盖住后续目标页面。
  document.querySelectorAll('.app-screen').forEach((page) => {
    if (page === target) return;
    page.classList.remove('is-active', ...ENTER_CLASSES, ...EXIT_CLASSES);
  });

  if (current && current !== target) {
    // 移动端 WebView 中“双页面同时滑动 + 毛玻璃”会显著掉帧。
    // 旧页立即卸载，只对新页做短暂轻量淡入。
    current.classList.remove('is-active', ...ENTER_CLASSES, ...EXIT_CLASSES);
    showScreen(target, 'cross');
    document.body.classList.add('is-screen-transitioning');
    window.setTimeout(() => document.body.classList.remove('is-screen-transitioning'), 220);
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

function openMyScreen() {
  const now = performance.now();
  // Android WebView 常在 pointerup 后补发 click；只接受其中第一次，避免双重导航。
  if (now - _lastProfileNavigationAt < 420) return;
  _lastProfileNavigationAt = now;
  navigateTo('my');
  // 先完成导航。即使旧版本写入的本地数据异常，也不能阻断进入“我的”页。
  try {
    renderMyPage();
  } catch (error) {
    console.warn('[My] 数据渲染失败，已展示静态页面：', error);
  }
}

function proposalItems(proposal) {
  const data = proposal?.changes?.[0]?.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const icons = { 数学: '∑', 英语: 'A', 政治: '政', 专业课: '专' };
  if (items.length) {
    return items.slice(0, 4).map((item, index) => ({
      subject: item.subject || ['数学', '英语', '政治'][index] || '学习',
      title: item.title || item.task || item.name || '专项复习',
      hours: item.hours || item.duration || '—',
      note: item.note || item.description || '按计划完成',
      icon: icons[item.subject] || '✦',
    }));
  }

  // 报考方案没有固定 items 结构；以安全的键值预览展示模型已校验过的 JSON。
  return Object.entries(data).slice(0, 4).map(([key, value]) => ({
    subject: '方案',
    title: key,
    hours: '',
    note: typeof value === 'string' ? value : JSON.stringify(value),
    icon: '⌁',
  }));
}

function renderAgentProposal(proposal = activeAgentProposal || fallbackStudyProposal) {
  activeAgentProposal = proposal;
  const list = document.getElementById('agentPlanItems');
  if (!list) return;
  const proposalType = proposal.proposalType || activeAgentProposalType || 'study';
  const items = proposalItems(proposal);
  const isPending = proposal?.status === 'pending';
  const title = proposalType === 'admission' ? '报考方案建议' : '下周学习计划';
  const titleEl = document.getElementById('agentProposalTitle');
  const metaEl = document.getElementById('agentProposalMeta');
  const badgeEl = document.getElementById('agentProposalBadge');
  const rationaleEl = document.getElementById('agentProposalRationale');
  const applyButton = document.getElementById('agentApplyProposalBtn');
  if (titleEl) titleEl.textContent = title;
  if (metaEl) metaEl.textContent = proposal?.createdAt ? '已根据当前云端数据生成' : '生成后会先等待你的确认';
  if (badgeEl) badgeEl.textContent = isPending ? '待确认' : proposal?.status === 'applied' ? '已应用' : '待生成';
  if (rationaleEl) rationaleEl.textContent = proposal?.rationale || proposal?.summary || fallbackStudyProposal.rationale;
  if (applyButton) {
    applyButton.disabled = !isPending;
    applyButton.textContent = isPending ? '✓ 应用这份计划' : proposal?.status === 'applied' ? '✓ 已应用到云端' : '先在对话中生成计划';
  }
  list.innerHTML = items.length ? items.map((item) => `
    <article class="agent-plan-item"><i>${escapeHtml(item.icon)}</i><span><strong>${escapeHtml(item.subject)} · ${escapeHtml(item.title)}</strong><small>${escapeHtml(item.note)}</small></span><b>${escapeHtml(String(item.hours))}</b></article>
  `).join('') : '<p class="agent-plan-empty">暂无待确认的方案。先发起对话，再选择生成计划。</p>';
}

function coachIntakeQuestions(metadata) {
  const questions = metadata?.coach?.questions;
  if (!Array.isArray(questions)) return [];
  return questions
    .filter((question) => typeof question === 'string' && question.trim())
    .slice(0, 6)
    .map((question) => question.trim().slice(0, 120));
}

function appendAgentMessage(text, type = 'user', { canCreateProposal = false, questions = [] } = {}) {
  const list = document.getElementById('agentMessages');
  if (!list) return null;
  const article = document.createElement('article');
  article.className = `agent-message is-${type}`;
  const intakeList = type === 'assistant' && questions.length
    ? `<ol class="agent-intake-questions">${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ol>`
    : '';
  article.innerHTML = type === 'assistant'
    ? `<i>✦</i><div><p>${escapeHtml(text)}</p>${intakeList}${canCreateProposal ? '<button type="button" data-create-agent-proposal>生成待确认计划 ↗</button>' : ''}</div>`
    : `<p>${escapeHtml(text)}</p>`;
  list.append(article);
  article.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return article;
}

function renderAgentConversation(messages = []) {
  const list = document.getElementById('agentMessages');
  if (!list) return;
  list.innerHTML = '';
  if (!messages.length) {
    appendAgentMessage('你好，我是你的考研复习规划教练。我会先结合云端学习、计划与收藏院校了解你的情况；信息不足时会用几个关键问题补齐，再给你可执行的方案。', 'assistant');
    return;
  }
  messages.forEach((message) => {
    appendAgentMessage(message.content || '', message.role === 'assistant' ? 'assistant' : 'user', {
      canCreateProposal: Boolean(message.metadata?.canCreateProposal),
      questions: coachIntakeQuestions(message.metadata),
    });
  });
}

function updateAgentContext(context) {
  const section = document.querySelector('.agent-context');
  if (!section) return;
  const totalSeconds = Number(context?.study30d?.duration_s || 0);
  const sessions = Number(context?.study30d?.session_count || 0);
  const topSubject = context?.study30d?.bySubject?.[0]?.subject || '暂未记录';
  const title = section.querySelector('b');
  const updated = section.querySelector('small');
  const chips = section.querySelectorAll('p span');
  if (title) title.textContent = '教练正在结合你的云端数据给建议';
  if (updated) updated.textContent = '刚刚同步';
  if (chips[0]) chips[0].textContent = `近 30 天 ${formatDuration(totalSeconds)}`;
  if (chips[1]) chips[1].textContent = `${sessions} 条学习记录`;
  if (chips[2]) chips[2].textContent = `${topSubject}投入最多`;
}

async function ensureAgentConversation() {
  const user = getMyAuthProfile();
  if (!user) throw new AgentApiError('请先登录后再使用 AI 学习顾问', 401);
  if (activeAgentConversationUserId !== user.id) {
    activeAgentConversationId = null;
    activeAgentConversationUserId = user.id;
  }
  if (activeAgentConversationId) {
    try {
      return await getAgentConversation(activeAgentConversationId);
    } catch (error) {
      // 会话可能已在其他设备删除。仅在 404 时重建，其他错误应由调用方显示。
      if (!(error instanceof AgentApiError) || error.status !== 404) throw error;
      activeAgentConversationId = null;
    }
  }
  const conversations = await listAgentConversations();
  const existing = (conversations?.data || []).find((item) => item.agentType === KAOYAN_COACH_AGENT_TYPE);
  if (existing?.id) {
    activeAgentConversationId = existing.id;
    activeAgentConversationUserId = user.id;
    return getAgentConversation(existing.id);
  }
  const created = await createAgentConversation({
    agentType: KAOYAN_COACH_AGENT_TYPE,
    title: '',
    context: { entry: 'prep', experience: 'kaoyan-coach' },
  });
  const createdId = created?.conversation?.id;
  if (!createdId) throw new AgentApiError('创建 AI 对话失败，请稍后重试', 502, created || null);
  activeAgentConversationId = createdId;
  activeAgentConversationUserId = user.id;
  return { conversation: created?.conversation, messages: [] };
}

function promptAgentLogin() {
  alert('登录后即可保存考研规划对话、同步学习数据并应用待确认计划。');
  openMyScreen();
  document.getElementById('myAuthForm')?.classList.remove('hidden');
  document.getElementById('myOpenAuthBtn').hidden = true;
  document.getElementById('myAuthNameInput')?.focus();
}

async function openAgentChat() {
  if (!getMyAuthProfile()) {
    promptAgentLogin();
    return;
  }
  navigateTo('agentChat');
  setText('agentStatus', '✦ 同步中');
  setText('agentChatStatus', '正在同步对话与学习数据');
  const list = document.getElementById('agentMessages');
  if (list) list.innerHTML = '<article class="agent-message is-assistant"><i>✦</i><p>正在同步对话与学习数据…</p></article>';
  try {
    const [conversation, context] = await Promise.all([ensureAgentConversation(), getAgentContext()]);
    renderAgentConversation(conversation?.messages || []);
    updateAgentContext(context?.context);
    setText('agentStatus', '✦ 已同步');
    setText('agentChatStatus', '已同步 · 当前对话保存到云端');
  } catch (error) {
    setText('agentStatus', '✦ 未同步');
    setText('agentChatStatus', '暂时无法连接云端服务');
    const section = document.querySelector('.agent-context');
    if (section) {
      const title = section.querySelector('b');
      const updated = section.querySelector('small');
      if (title) title.textContent = '云端数据暂未同步';
      if (updated) updated.textContent = '请稍后重试';
      section.querySelectorAll('p span').forEach((chip) => { chip.textContent = '—'; });
    }
    renderAgentConversation([]);
    appendAgentMessage(`暂时无法同步对话：${error instanceof Error ? error.message : '请稍后重试'}`, 'assistant');
  }
}

async function askAgent(question, proposalType = activeAgentProposalType) {
  const text = String(question || '').trim();
  if (!text) return;
  if (!getMyAuthProfile()) {
    promptAgentLogin();
    return;
  }
  if (agentChatLoading) return;
  activeAgentProposalType = proposalType === 'admission' ? 'admission' : 'study';
  activeAgentQuestions[activeAgentProposalType] = text;
  agentChatLoading = true;
  appendAgentMessage(text, 'user');
  const input = document.getElementById('agentChatInput');
  if (input) input.value = '';
  const submit = document.querySelector('#agentChatForm button[type="submit"]');
  if (submit) submit.disabled = true;
  const pending = appendAgentMessage('正在结合你的学习、计划和收藏院校整理建议…', 'assistant');
  try {
    const conversation = await ensureAgentConversation();
    const conversationId = conversation?.conversation?.id || activeAgentConversationId;
    const response = await sendAgentConversationMessage(conversationId, text);
    pending?.remove();
    appendAgentMessage(response?.message?.content || '我暂时没有生成有效回复，请重试。', 'assistant', {
      canCreateProposal: response?.message?.metadata?.canCreateProposal === true,
      questions: coachIntakeQuestions(response?.message?.metadata),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 服务暂时不可用，请稍后重试。';
    const textEl = pending?.querySelector('p');
    if (textEl) textEl.textContent = `未能生成回复：${message}`;
  } finally {
    agentChatLoading = false;
    if (submit) submit.disabled = false;
  }
}

async function generateAgentProposal(proposalType = activeAgentProposalType) {
  if (!getMyAuthProfile()) {
    promptAgentLogin();
    return;
  }
  const type = proposalType === 'admission' ? 'admission' : 'study';
  activeAgentProposalType = type;
  const question = activeAgentQuestions[type] || (type === 'admission'
    ? '请基于我的当前报考信息，给出一份可确认的择校方案。'
    : '请基于我的当前学习记录，生成一份下周可执行的学习计划。');
  activeAgentProposal = {
    ...fallbackStudyProposal,
    proposalType: type,
    status: 'generating',
    summary: '正在生成待确认的云端计划，请稍候…',
    rationale: '模型建议不会直接修改任何数据，生成后仍需由你确认。',
  };
  renderAgentProposal(activeAgentProposal);
  navigateTo('agentProposal');
  try {
    const response = await createAgentProposal({
      proposalType: type,
      question,
      agentType: KAOYAN_COACH_AGENT_TYPE,
      context: { clientEntry: 'agent-chat' },
    });
    activeAgentProposal = response?.proposal || fallbackStudyProposal;
  } catch (error) {
    activeAgentProposal = {
      ...fallbackStudyProposal,
      proposalType: type,
      status: 'failed',
      summary: `计划生成失败：${error instanceof Error ? error.message : '请稍后重试'}`,
      rationale: '你的现有学习计划没有被修改。',
    };
  }
  renderAgentProposal(activeAgentProposal);
}

async function loadLatestAgentProposal() {
  if (!getMyAuthProfile()) return fallbackStudyProposal;
  const response = await listAgentProposals();
  const pending = (response?.data || []).find((proposal) => proposal.status === 'pending');
  activeAgentProposal = pending || fallbackStudyProposal;
  if (pending?.proposalType) activeAgentProposalType = pending.proposalType;
  return activeAgentProposal;
}

async function openAgentProposal() {
  if (!getMyAuthProfile()) {
    promptAgentLogin();
    return;
  }
  navigateTo('agentProposal');
  try {
    renderAgentProposal(await loadLatestAgentProposal());
  } catch (error) {
    renderAgentProposal({
      ...fallbackStudyProposal,
      status: 'failed',
      summary: `暂时无法读取计划：${error instanceof Error ? error.message : '请稍后重试'}`,
    });
  }
}

function openDetailPage(result) {
  _detailReturnScreen = _activeScreen;
  showDetail(result, {
    degree: currentDegree,
    zone: currentZone,
    favoriteNames: favoriteNamesForCurrentView(),
  });
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
  const profileNavButton = document.getElementById('profileNavBtn');
  profileNavButton.addEventListener('pointerup', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    openMyScreen();
  });
  profileNavButton.addEventListener('click', openMyScreen);
  document.getElementById('prepTaskList').addEventListener('click', handlePrepTaskClick);
  document.getElementById('startStudyBtn').addEventListener('click', toggleStudyTimer);
  document.getElementById('openTimerBtn').addEventListener('click', toggleStudyTimer);
  document.getElementById('dailyCheckinBtn').addEventListener('click', () => {
    const button = document.getElementById('dailyCheckinBtn');
    button.textContent = '✓ 已打卡（本机）';
    button.disabled = true;
  });
  document.getElementById('prepStatsBtn').addEventListener('click', openAgentProposal);
  document.getElementById('agentChatBackBtn').addEventListener('click', () => navigateTo('agentProposal'));
  document.getElementById('agentProposalBackBtn').addEventListener('click', () => navigateTo('prep'));
  document.getElementById('agentPlanLink')?.addEventListener('click', () => generateAgentProposal());
  document.getElementById('agentMessages').addEventListener('click', (event) => {
    if (event.target.closest('[data-create-agent-proposal]')) generateAgentProposal();
  });
  document.getElementById('agentOpenChatBtn').addEventListener('click', openAgentChat);
  document.querySelectorAll('[data-agent-prompt]').forEach((button) => {
    button.addEventListener('click', () => askAgent(button.dataset.agentPrompt, button.dataset.agentProposalType));
  });
  document.getElementById('agentChatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    askAgent(document.getElementById('agentChatInput').value);
  });
  document.getElementById('agentAdjustProposalBtn').addEventListener('click', openAgentChat);
  document.getElementById('agentApplyProposalBtn').addEventListener('click', async () => {
    const button = document.getElementById('agentApplyProposalBtn');
    if (!activeAgentProposal?.id || activeAgentProposal.status !== 'pending') return;
    button.disabled = true;
    button.textContent = '正在应用…';
    try {
      const response = await applyAgentProposal(activeAgentProposal.id);
      activeAgentProposal = { ...activeAgentProposal, status: 'applied' };
      if (response?.planType === 'study' && response?.plan) {
        studyPlanState = response.plan;
        renderStudyPlan(response.plan.plan);
      }
      if (response?.planType === 'admission' && response?.plan) {
        admissionPlanState = response.plan;
      }
      await refreshAuthenticatedData();
      renderAgentProposal(activeAgentProposal);
    } catch (error) {
      if (error instanceof AgentApiError && error.status === 409) {
        await refreshAuthenticatedData();
        try { await loadLatestAgentProposal(); } catch { /* 保留原提案错误提示 */ }
        renderAgentProposal(activeAgentProposal);
      } else {
        button.disabled = false;
        button.textContent = '应用这份计划';
      }
      alert(error instanceof Error ? error.message : '应用计划失败，请稍后再试。');
    }
  });
  document.getElementById('themeToggleBtn').addEventListener('click', toggleStudyTheme);
  document.getElementById('myOpenAuthBtn').addEventListener('click', () => {
    document.getElementById('myAuthForm').classList.remove('hidden');
    document.getElementById('myOpenAuthBtn').hidden = true;
    setAuthFormMode(document.getElementById('myAuthForm').dataset.mode || 'register');
    document.getElementById('myAuthNameInput').focus();
  });
  document.getElementById('myCloseAuthBtn').addEventListener('click', () => {
    document.getElementById('myAuthForm').classList.add('hidden');
    document.getElementById('myOpenAuthBtn').hidden = false;
    showAuthError('');
  });
  document.getElementById('myAuthSwitchBtn').addEventListener('click', () => {
    const form = document.getElementById('myAuthForm');
    setAuthFormMode(form.dataset.mode === 'login' ? 'register' : 'login');
  });
  document.getElementById('myAuthForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = document.getElementById('myAuthForm');
    const username = document.getElementById('myAuthNameInput').value.trim();
    const password = document.getElementById('myAuthPasswordInput').value;
    const email = document.getElementById('myAuthAccountInput').value.trim();
    const submit = document.getElementById('myAuthSubmitBtn');
    showAuthError('');
    submit.disabled = true;
    submit.textContent = form.dataset.mode === 'login' ? '登录中…' : '注册中…';
    try {
      if (form.dataset.mode === 'login') await login({ username, password });
      else await register({ username, password, email });
      localStorage.removeItem('my_auth_profile');
      form.reset();
      form.classList.add('hidden');
      document.getElementById('myOpenAuthBtn').hidden = true;
      activeAgentConversationId = null;
      activeAgentConversationUserId = null;
      await refreshAuthenticatedData();
      renderMyPage();
    } catch (error) {
      showAuthError(error instanceof Error ? error.message : '登录失败，请稍后重试。');
    } finally {
      submit.disabled = false;
      submit.textContent = form.dataset.mode === 'login' ? '登录' : '注册并登录';
    }
  });
  document.getElementById('myLogoutBtn').addEventListener('click', async () => {
    const button = document.getElementById('myLogoutBtn');
    button.disabled = true;
    try {
      await logout();
      activeAgentConversationId = null;
      activeAgentConversationUserId = null;
      activeAgentProposal = null;
      await refreshAuthenticatedData();
      renderMyPage();
    } catch (error) {
      alert(error instanceof Error ? error.message : '退出登录失败，请稍后重试。');
    } finally {
      button.disabled = false;
    }
  });
  window.addEventListener('kaoyan-auth-change', (event) => {
    const nextUserId = Number(event.detail?.user?.id) || null;
    if (nextUserId !== authenticatedUserId) {
      authenticatedUserId = nextUserId;
      // 让旧账号的异步请求失效，并且不在切换后短暂展示其计划或对话。
      authenticatedDataLoadVersion += 1;
      resetAuthenticatedUiState();
      if (nextUserId) {
        cloudFavoritesState = { userId: nextUserId, records: [], loaded: false, loading: true, error: null };
      } else {
        renderOfflinePrepTasks();
      }
    }
    renderMyStudyData();
    renderPrepStudyData();
    renderPrepPlanMeta();
    renderAgentStudyOverview();
    renderMyPage();
  });
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
  document.getElementById('detailFavBtn').addEventListener('click', async () => {
    const name = document.getElementById('detailName').textContent;
    await toggleUniversityFavorite(name);
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
    if (['home', 'prep', 'practice', 'results', 'fail', 'my', 'agentChat', 'agentProposal'].includes(view)) setActiveScreen(view);
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
  const auth = getMyAuthProfile();
  const profileName = document.getElementById('myProfileName');
  const profileMeta = document.getElementById('myProfileMeta');
  const authTitle = document.getElementById('myAuthTitle');
  const authDescription = document.getElementById('myAuthDescription');
  const authButton = document.getElementById('myOpenAuthBtn');
  const logoutButton = document.getElementById('myLogoutBtn');
  const authForm = document.getElementById('myAuthForm');
  const authCard = document.getElementById('myAuthCard');
  if (auth) {
    if (authCard) authCard.dataset.authState = 'signed-in';
    profileName.textContent = auth.username || '研友';
    profileMeta.textContent = auth.email ? `已登录 · ${auth.email}` : '已登录 · 云端同步已开启';
    authTitle.textContent = '账号已登录';
    authDescription.textContent = '学习记录、计划和 AI 建议会同步到当前账号。';
    authButton.hidden = true;
    authButton.disabled = false;
    logoutButton.hidden = false;
    if (authForm) authForm.classList.add('hidden');
  } else {
    if (authCard) authCard.dataset.authState = 'signed-out';
    profileName.textContent = '未登录';
    profileMeta.textContent = '登录后同步你的备考数据';
    authTitle.textContent = '登录后，学习数据不会丢';
    authDescription.textContent = '跨设备同步目标院校、学习计划与 AI 建议。';
    authButton.textContent = '登录 / 注册';
    authButton.hidden = false;
    authButton.disabled = false;
    logoutButton.hidden = true;
  }
  // 报考方案优先显示已确认的云端计划；本地目标仅保留为离线回退。
  const localTarget = getTargetScore() || {};
  const cloudTarget = normalizedAdmissionPlan(admissionPlanState.plan);
  const hasCloudTarget = Boolean(cloudTarget.university || cloudTarget.major || cloudTarget.score || cloudTarget.majorCode);
  const localDegree = localTarget.score ? (localTarget.degree === 'xueshuo' ? '学硕' : '专硕') : '学硕';
  const targetName = hasCloudTarget
    ? [cloudTarget.university, cloudTarget.major].filter(Boolean).join(' · ') || '已保存云端报考方案'
    : '北京邮电大学 · 软件工程';
  setText('myTargetPlanLabel', hasCloudTarget ? '已确认的云端报考方案' : '本机目标档案');
  setText('myTargetUniversity', targetName);
  setText('myTargetScore', hasCloudTarget ? (cloudTarget.score || '—') : (localTarget.score || '365'));
  setText('myTargetDegree', hasCloudTarget ? (cloudTarget.degree || '待补充') : localDegree);
  setText('myTargetCategory', hasCloudTarget ? (cloudTarget.category || '待补充') : (localTarget.category || '工学'));
  setText('myTargetPlanCode', hasCloudTarget ? (cloudTarget.majorCode || '已同步') : '083500');

  // 收藏院校：登录后仅展示当前账号的 MySQL 数据；离线时保留本机收藏。
  const cloudFavorites = cloudFavoritesForCurrentUser();
  const favs = favoriteRecordsForView();
  setText('myFavCount', String(favs.length));
  const favSyncStatus = document.getElementById('myFavSyncStatus');
  if (favSyncStatus) {
    favSyncStatus.textContent = !auth
      ? '本机收藏'
      : cloudFavorites?.loading
        ? '正在同步…'
        : cloudFavorites?.loaded
          ? '已同步'
          : '同步失败';
  }
  const favList = document.getElementById('myFavList');
  if (favList && favs.length === 0) {
    const emptyText = !auth
      ? '登录后可跨设备保存收藏院校。'
      : cloudFavorites?.loading
        ? '正在读取你的云端收藏…'
        : cloudFavorites?.error
          ? '暂时无法读取云端收藏，请稍后重试。'
          : '暂未收藏院校；在学校详情页点 ☆ 即可加入。';
    favList.innerHTML = `<p id="myFavEmpty" class="my-favorites-empty">${escapeHtml(emptyText)}</p>`;
  } else if (favList) {
    favList.innerHTML = favs.map((favorite) => {
      const name = favorite.universityName;
      const localUniversity = findUniversity(name);
      const province = favorite.province || localUniversity?.province || '';
      const level = favorite.level || localUniversity?.level || '';
      const zone = favorite.zone || localUniversity?.zone || '';
      const meta = [province, level, zone ? `${zone}区` : ''].filter(Boolean).join(' · ');
      return `<article class="my-favorite-row">
        <button class="my-favorite-item" type="button" data-uni-name="${escapeHtml(name)}"><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(meta || '已收藏院校')}</small></span></button>
        <button class="my-favorite-remove" type="button" data-uni-name="${escapeHtml(name)}" title="取消收藏" aria-label="取消收藏 ${escapeHtml(name)}">×</button>
      </article>`;
    }).join('');
  }

  // 浏览历史
  const history = getBrowseHistory();
  const hist = Array.isArray(history) ? history : [];
  const histList = document.getElementById('myHistoryList');
  const histEmpty = ensureMyListPlaceholder(histList, 'myHistoryEmpty');
  if (histList && hist.length === 0) {
    histList.innerHTML = '';
    histList.appendChild(histEmpty);
    histEmpty.style.display = '';
  } else if (histList) {
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
    histList.appendChild(histEmpty);
  }
  renderMyStudyData();
}

function ensureMyListPlaceholder(list, id) {
  if (!list) return document.createElement('div');
  let placeholder = document.getElementById(id);
  if (!placeholder) {
    placeholder = document.createElement('div');
    placeholder.id = id;
  }
  return placeholder;
}

function initMyPageEvents() {
  // 编辑目标
  document.getElementById('myEditTargetBtn').addEventListener('click', async () => {
    if (admissionPlanSaving) return;
    const localTarget = getTargetScore() || {};
    const cloudTarget = normalizedAdmissionPlan(admissionPlanState.plan);
    const isCloud = Boolean(getMyAuthProfile());
    const currentDegree = cloudTarget.degree.includes('专') ? 'zhuanshuo'
      : cloudTarget.degree.includes('学') ? 'xueshuo'
        : (localTarget.degree || 'xueshuo');
    const newScore = prompt('请输入目标分数（0-500）：', cloudTarget.score || localTarget.score || '');
    if (newScore === null) return;
    const score = parseInt(newScore, 10);
    if (isNaN(score) || score < 0 || score > 500) { alert('请输入 0-500 之间的分数'); return; }

    const degree = confirm(`当前为${currentDegree === 'xueshuo' ? '学硕' : '专硕'}。点击「确定」选择学硕，点击「取消」选择专硕`) ? 'xueshuo' : 'zhuanshuo';

    const categories = getCategories(degree);
    const catList = categories.join(' / ');
    const category = prompt(`请输入目标门类（${catList}）：`, cloudTarget.category || localTarget.category || '工学');
    if (!category || !categories.includes(category)) {
      alert(`无效门类。可选：${catList}`);
      return;
    }

    const nextLocalTarget = { score, degree, category };
    if (!isCloud) {
      saveTargetScore(nextLocalTarget);
      renderMyPage();
      return;
    }

    admissionPlanSaving = true;
    try {
      const nextPlan = {
        ...(admissionPlanState.plan && typeof admissionPlanState.plan === 'object' ? admissionPlanState.plan : {}),
        targetScore: score,
        degree: degree === 'xueshuo' ? '学硕' : '专硕',
        category,
      };
      const response = await updateUserPlan('admission', nextPlan, admissionPlanState.revision);
      admissionPlanState = {
        plan: response?.plan || nextPlan,
        revision: Number(response?.revision ?? admissionPlanState.revision),
        updatedAt: response?.updatedAt || admissionPlanState.updatedAt,
      };
      saveTargetScore(nextLocalTarget);
      renderPrepPlanMeta();
      renderMyPage();
    } catch (error) {
      if (error instanceof StudyApiError && error.status === 409) await refreshAuthenticatedData();
      alert(error instanceof Error ? `报考方案同步失败：${error.message}` : '报考方案同步失败，请稍后重试。');
    } finally {
      admissionPlanSaving = false;
    }
  });

  // 收藏列表：点击跳转详情 / 删除
  document.getElementById('myFavList').addEventListener('click', async (e) => {
    const delBtn = e.target.closest('.my-favorite-remove');
    if (delBtn) {
      e.stopPropagation();
      await toggleUniversityFavorite(delBtn.dataset.uniName);
      return;
    }
    const item = e.target.closest('.my-favorite-item');
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
