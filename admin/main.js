import './styles.css';
import {
  API_BASE,
  ApiError,
  apiRequest,
  getAccessToken,
  getAuthenticatedUser,
  login,
  logout,
  restoreAuthSession,
} from '../src/auth-api.js';
import { escapeHtml } from '../src/utils.js';

const root = document.getElementById('admin-app');
const PAGE_SIZE = 20;
const DB_PAGE_SIZE = 25;
const DB_EXPORT_FORMATS = ['csv', 'txt', 'sql', 'xlsx'];
const DB_IMPORT_FORMATS = ['csv', 'txt', 'json', 'sql', 'xlsx', 'db'];
const AGENT_EXTRACTION_CAPABILITIES = [
  ['natural_language_ingest', '口述 / 文本抽取'],
  ['file_ingest', '文件内容解析'],
];
const AGENT_REVIEW_CAPABILITIES = [
  ['content_review', '内容合规审核'],
  ['duplicate_detection', '重复数据检测'],
  ['field_anomaly_check', '字段异常检查'],
  ['referential_consistency_check', '关联一致性检查'],
  ['repair_plan', '修复建议生成'],
  ['operational_alerting', '运行异常告警'],
];
const DB_TABLE_PRIORITY = [
  'universities',
  'programs',
  'program_admissions',
  'admission_scores',
  'national_lines',
  'uni_details',
  'uni_requirements',
  'uni_photos',
];

const NAV_ITEMS = [
  { id: 'dashboard', icon: '◫', label: '运营概览', subtitle: '平台运行与核心指标' },
  { id: 'database', icon: '▦', label: '数据库管理', subtitle: '完整表维护、导入导出与 Agent 审核' },
  { id: 'schools', icon: '⌂', label: '院校资料', subtitle: '学校与基础档案管理' },
  { id: 'users', icon: '♙', label: '用户管理', subtitle: '账号、权限与使用状态' },
  { id: 'agents', icon: '✦', label: 'Agent 工作台', subtitle: '口述与文件入库、自动审核、运行日志与告警' },
  { id: 'quality', icon: '◈', label: '数据治理', subtitle: '来源、核验与待处理问题' },
  { id: 'audit', icon: '≡', label: '日志与审计', subtitle: '后台操作审计与访问日志' },
];

const state = {
  user: null,
  section: 'dashboard',
  menuOpen: false,
  modal: null,
  toast: null,
  accessDenied: false,
  dashboard: null,
  database: {
    status: null,
    selectedTable: '',
    schema: null,
    rows: [],
    total: 0,
    page: 1,
    pageSize: DB_PAGE_SIZE,
    keyword: '',
    orderBy: '',
    orderDir: 'ASC',
    loading: false,
    loadingRows: false,
    importResult: null,
  },
  schools: { data: [], total: 0, page: 1, pageSize: PAGE_SIZE, keyword: '', catalogStatus: '', loading: false },
  users: { data: [], total: 0, page: 1, pageSize: PAGE_SIZE, keyword: '', role: '', status: '', loading: false },
  agents: {
    configurations: [],
    flags: [],
    tables: [],
    modelSettings: {
      data: null,
      loading: false,
      saving: false,
      testing: false,
      testResult: null,
      error: '',
    },
    tab: 'workbench',
    currentJob: null,
    draft: { instruction: '', table: '', mode: 'insert', format: 'csv', sourceType: 'text' },
    submitting: false,
    dictating: false,
    loading: false,
    jobs: { data: [], total: 0, page: 1, pageSize: PAGE_SIZE, loading: false },
    runs: { data: [], total: 0, page: 1, pageSize: PAGE_SIZE, loading: false },
    alerts: { data: [], total: 0, openTotal: 0, page: 1, pageSize: PAGE_SIZE, status: 'open', loading: false },
  },
  quality: { issues: [], total: 0, page: 1, loading: false },
  audit: {
    tab: 'operations',
    data: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    loading: false,
    access: { data: [], total: 0, page: 1, pageSize: PAGE_SIZE, loading: false },
  },
};

let activeSpeechRecognition = null;

function html(value) {
  return escapeHtml(String(value ?? ''));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isoTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatBytes(value) {
  const bytes = number(value);
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function badge(value) {
  const text = String(value || '未知');
  const normalized = text.toLowerCase();
  const tone = ['active', 'verified', 'enabled', 'admin', 'success', 'succeeded', 'applied', 'completed', 'resolved', 'low', 'passed'].includes(normalized) || ['正常', '启用', '管理员', '已核验', '已完成', '已入库', '低风险', '审核通过'].includes(text)
    ? 'active'
    : ['pending', 'warning', 'pending_review', 'waiting_for_confirmation', 'awaiting_confirmation', 'queued', 'running', 'reviewing', 'acknowledged', 'medium'].includes(normalized) || ['待处理', '待核验', '审核中', '中风险', '已确认', '待确认', '需人工确认'].includes(text)
      ? 'pending'
      : ['disabled', 'blocked', 'suspended', 'danger', 'failed', 'rejected', 'critical', 'error', 'high', '已停用', '禁用'].includes(normalized) || ['已停用', '禁用', '失败', '已驳回', '已阻断', '高风险', '严重'].includes(text)
        ? 'disabled'
        : ['user', '普通用户'].includes(normalized) || text === '普通用户'
          ? 'user'
          : 'info';
  return `<span class="admin-badge admin-badge--${tone}">${html(text)}</span>`;
}

function currentNav() {
  return NAV_ITEMS.find((item) => item.id === state.section) || NAV_ITEMS[0];
}

function isSuperAdministrator() {
  return state.user?.role === 'super_admin';
}

function statusLabel(value) {
  const status = String(value || '').toLowerCase();
  return ({
    pending: '待处理',
    pending_review: '待审核',
    waiting_for_confirmation: '待确认',
    awaiting_confirmation: '待确认',
    queued: '排队中',
    running: '执行中',
    reviewing: '审核中',
    reviewed: '已审核',
    passed: '审核通过',
    warning: '需人工确认',
    blocked: '已阻断',
    approved: '已批准',
    applied: '已入库',
    completed: '已入库',
    succeeded: '已完成',
    success: '成功',
    failed: '失败',
    rejected: '已驳回',
    open: '待处理',
    acknowledged: '已确认',
    resolved: '已解决',
  })[status] || value || '未知';
}

function agentRiskLabel(value) {
  const risk = String(value || '').toLowerCase();
  return ({ low: '低风险', medium: '中风险', high: '高风险', critical: '严重', blocked: '已阻断' })[risk] || value || '未评估';
}

function modelStatusLabel(value) {
  const status = String(value || '').toLowerCase();
  return ({ completed: '语义审核完成', not_configured: '仅规则审核', failed: '语义审核失败', pending: '等待审核' })[status]
    || value || '未记录';
}

function durationLabel(value) {
  const milliseconds = number(value);
  if (!milliseconds) return '—';
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function unwrapList(payload, keys = ['data', 'items']) {
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return Array.isArray(payload) ? payload : [];
}

function paginationOf(payload, fallback) {
  return {
    page: number(payload?.page, fallback.page),
    pageSize: number(payload?.pageSize, fallback.pageSize),
    total: number(payload?.total, fallback.total),
  };
}

function databaseTables() {
  return (state.database.status?.tables || []).filter((table) => table.readable !== false);
}

function chooseDatabaseTable(tables, preferred = state.database.selectedTable) {
  const names = tables.map((table) => table.name).filter(Boolean);
  if (preferred && names.includes(preferred)) return preferred;
  return DB_TABLE_PRIORITY.find((table) => names.includes(table)) || names[0] || '';
}

function databasePrimaryKey() {
  const primary = state.database.schema?.primaryKey || [];
  return primary.length === 1 ? primary[0] : '';
}

function databaseColumns() {
  return state.database.schema?.columns || [];
}

function databaseEditableColumns({ creating = false } = {}) {
  if (state.database.schema?.writeBlocked) return [];
  return databaseColumns().filter((column) => column.writable && (creating || !column.primaryKey));
}

function databaseCell(value) {
  if (value === null || value === undefined || value === '') return '<span class="admin-table-note">—</span>';
  if (typeof value === 'object') return html(JSON.stringify(value));
  return html(String(value));
}

function databaseFieldValue(value) {
  if (value === null || value === undefined || value === '[redacted]') return '';
  return String(value);
}

function databaseFormatLabel(format) {
  return format === 'db' ? 'DB' : format.toUpperCase();
}

function tableDisplayName(name) {
  const labels = {
    universities: '学校主表',
    uni_details: '学校详情',
    uni_requirements: '报考要求',
    uni_photos: '学校图片',
    programs: '专业目录',
    program_admissions: '专业招生',
    admission_scores: '院校分数',
    national_lines: '国家线',
  };
  return labels[name] || name;
}

async function adminRequest(path, options = {}) {
  return apiRequest(path, { ...options, requiresAuth: true });
}

function showToast(message, { error = false } = {}) {
  state.toast = { message, error };
  render();
  window.setTimeout(() => {
    if (state.toast?.message !== message) return;
    state.toast = null;
    render();
  }, 3600);
}

function requestErrorMessage(error) {
  if (error instanceof ApiError) return error.message;
  return '操作未完成，请稍后重试';
}

function metric(label, value, note, tone) {
  return `<article class="admin-metric admin-metric--${tone}">
    <span class="admin-metric-label">${html(label)}</span>
    <strong>${html(value)}</strong>
    <small>${html(note)}</small>
  </article>`;
}

function empty(message) {
  return `<div class="admin-empty">${html(message)}</div>`;
}

function auditActorName(entry) {
  return entry?.actor?.username || entry?.actorUsername || entry?.actor_username || entry?.actor || '系统';
}

function auditResourceName(entry) {
  const type = entry?.resourceType || entry?.entityType || entry?.entity_type || '系统';
  const id = entry?.resourceId || entry?.entityId || '';
  return id ? `${type} #${id}` : type;
}

function auditSummary(entry) {
  if (entry?.summary || entry?.detail) return entry.summary || entry.detail;
  const changed = entry?.metadata?.changedFields;
  if (Array.isArray(changed) && changed.length) return `变更：${changed.join('、')}`;
  if (entry?.metadata?.softDelete) return '归档操作';
  return entry?.resourceId ? `记录 #${entry.resourceId}` : '—';
}

function loading(label = '正在同步后台数据…') {
  return `<div class="admin-empty"><span class="admin-loading"><i class="admin-spinner"></i>${html(label)}</span></div>`;
}

function sectionContent() {
  switch (state.section) {
    case 'database': return renderDatabase();
    case 'schools': return renderSchools();
    case 'users': return renderUsers();
    case 'agents': return renderAgents();
    case 'quality': return renderQuality();
    case 'audit': return renderAudit();
    default: return renderDashboard();
  }
}

function renderTopbarActions() {
  if (state.section === 'database') {
    const hasTable = Boolean(state.database.selectedTable);
    const operator = isSuperAdministrator();
    const canWrite = Boolean(operator && hasTable && state.database.schema && !state.database.schema.writeBlocked);
    return `<button class="admin-button admin-button--ghost" data-action="refresh">↻ 刷新数据</button><button class="admin-button admin-button--ghost" data-action="open-db-export" ${operator && hasTable ? '' : 'disabled'}>导出当前表</button><button class="admin-button admin-button--lime" data-action="open-db-import" ${operator ? '' : 'disabled'}>导入文件</button><button class="admin-button admin-button--ghost" data-action="new-db-row" ${canWrite ? '' : 'disabled'}>新增记录</button>`;
  }
  if (state.section === 'agents') return `<button class="admin-button admin-button--ghost" data-action="refresh">↻ 刷新数据</button>${isSuperAdministrator() ? '<button class="admin-button admin-button--lime" data-action="open-agent-workbench">✦ 新建入库审核</button>' : ''}`;
  return `<button class="admin-button admin-button--ghost" data-action="refresh">↻ 刷新数据</button>${state.section === 'schools' ? '<button class="admin-button admin-button--lime" data-action="new-school">＋ 新增院校</button>' : ''}`;
}

function renderLogin() {
  root.innerHTML = `<main class="admin-login">
    <section class="admin-login-card" aria-labelledby="adminLoginTitle">
      <div class="admin-brand"><span class="admin-brand-mark">✦</span><span><strong>考研择校 · 管理后台</strong><small>受权限保护的运营工作台</small></span></div>
      <h1 id="adminLoginTitle">管理员登录</h1>
      <p>使用已被授予管理员角色的账号登录。普通用户无法访问后台资料。</p>
      <form class="admin-form" id="adminLoginForm">
        <div class="admin-field"><label for="adminUsername">昵称 / 用户名</label><input id="adminUsername" name="username" autocomplete="username" required maxlength="32" /></div>
        <div class="admin-field"><label for="adminPassword">密码</label><input id="adminPassword" name="password" type="password" autocomplete="current-password" required maxlength="128" /></div>
        <p class="admin-error" id="adminLoginError" role="alert"></p>
        <button class="admin-button admin-button--lime" type="submit">登录管理后台</button>
      </form>
      <p class="admin-login-note">首次管理员授权需要在服务器使用受控的 bootstrap 命令完成；后台不会提供公开提权入口。</p>
    </section>
  </main>`;
}

function renderShell() {
  const nav = currentNav();
  const userName = state.user?.username || '管理员';
  root.innerHTML = `<div class="admin-shell${state.menuOpen ? ' is-menu-open' : ''}">
    <aside class="admin-sidebar" aria-label="后台导航">
      <div class="admin-brand"><span class="admin-brand-mark">✦</span><span class="admin-brand-copy"><strong>考研择校</strong><small>运营管理后台</small></span></div>
      <nav class="admin-nav">
        <p class="admin-nav-label">运营与内容</p>
        ${NAV_ITEMS.slice(0, 3).map(renderNav).join('')}
        <p class="admin-nav-label">账号与 AI</p>
        ${NAV_ITEMS.slice(3, 5).map(renderNav).join('')}
        <p class="admin-nav-label">安全与质量</p>
        ${NAV_ITEMS.slice(5).map(renderNav).join('')}
      </nav>
      <div class="admin-sidebar-footer"><div class="admin-account"><span class="admin-avatar">${html(userName.slice(0, 1) || '管')}</span><span class="admin-account-copy"><strong>${html(userName)}</strong><small>管理员会话</small></span><button class="admin-logout" data-action="logout" aria-label="退出登录">↪</button></div></div>
    </aside>
    <main class="admin-main">
      <header class="admin-topbar">
        <div><button class="admin-button admin-button--ghost admin-button--small admin-mobile-menu" data-action="toggle-menu">☰</button><h1 class="admin-page-title">${html(nav.label)}</h1><p class="admin-page-subtitle">${html(nav.subtitle)}</p></div>
        <div class="admin-topbar-actions">${renderTopbarActions()}</div>
      </header>
      ${state.accessDenied ? renderAccessDenied() : sectionContent()}
    </main>
  </div>${renderModal()}${renderToast()}`;
}

function renderNav(item) {
  const alertCount = item.id === 'agents' && isSuperAdministrator() ? number(state.agents.alerts?.openTotal) : 0;
  return `<button class="admin-nav-item${item.id === state.section ? ' is-active' : ''}" data-section="${item.id}"><span class="admin-nav-icon">${item.icon}</span><span>${html(item.label)}</span>${alertCount ? `<em class="admin-nav-count">${alertCount > 99 ? '99+' : alertCount}</em>` : ''}</button>`;
}

function renderAccessDenied() {
  return `<section class="admin-card"><div class="admin-empty"><div><strong style="display:block;color:#8d4444;font-size:16px;margin-bottom:8px">当前账号没有后台权限</strong>请联系平台运维人员，在服务器中为该账号授予管理员角色后重新登录。</div></div></section>`;
}

function renderDashboard() {
  if (!state.dashboard) return `<section class="admin-section">${loading()}</section>`;
  const source = state.dashboard;
  const users = number(source.users?.total ?? source.userCount ?? source.totalUsers);
  const activeUsers = number(source.users?.active ?? source.activeUsers);
  const universities = number(source.catalog?.universities ?? source.universities ?? source.universityCount);
  const issues = number(source.catalog?.openCatalogIssues ?? source.catalog?.openIssues ?? source.openIssues ?? source.catalogDataIssues);
  const agentRuns = number(source.agents?.runsLast24Hours ?? source.agents?.runs24h ?? source.agentRuns24h ?? source.agentRuns);
  const recent = unwrapList(source.recentAudit ?? source.audit, ['items', 'data']);
  const issueList = unwrapList(source.issues ?? source.catalogIssues, ['items', 'data']);
  return `<section class="admin-section">
    <div class="admin-metrics">
      ${metric('注册用户', users.toLocaleString(), `活跃 ${activeUsers.toLocaleString()} 人`, 'green')}
      ${metric('院校主表', universities.toLocaleString(), '可由后台维护', 'lime')}
      ${metric('AI 调用（24h）', agentRuns.toLocaleString(), '不包含密钥或原始对话', 'blue')}
      ${metric('待治理问题', issues.toLocaleString(), '需人工核验与处理', 'orange')}
    </div>
    <div class="admin-grid">
      <section class="admin-card"><header class="admin-card-head"><div><h2>最近后台操作</h2><p>所有变更会保留操作者和时间</p></div><button class="admin-button admin-button--ghost admin-button--small" data-section="audit">查看全部</button></header>${recent.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>时间</th><th>操作</th><th>对象</th><th>操作者</th></tr></thead><tbody>${recent.slice(0, 6).map((item) => `<tr><td>${html(isoTime(item.createdAt ?? item.created_at))}</td><td>${html(item.actionLabel ?? item.action ?? item.operation ?? '更新')}</td><td>${html(auditResourceName(item))}</td><td>${html(auditActorName(item))}</td></tr>`).join('')}</tbody></table></div>` : empty('暂无后台操作记录')}</section>
      <section class="admin-card"><header class="admin-card-head"><div><h2>数据治理提醒</h2><p>优先处理歧义名称与缺失主表</p></div><button class="admin-button admin-button--ghost admin-button--small" data-section="quality">处理问题</button></header><div class="admin-card-body">${issueList.length ? `<div class="admin-issue-list">${issueList.slice(0, 4).map(renderIssue).join('')}</div>` : empty('当前没有待处理问题')}</div></section>
    </div>
  </section>`;
}

function renderDatabase() {
  const data = state.database;
  if (data.loading && !data.status) return `<section class="admin-section">${loading('正在读取数据库健康信息…')}</section>`;
  const status = data.status;
  if (!status) return `<section class="admin-section">${empty('暂未取得数据库健康信息')}</section>`;
  const tables = status.tables || [];
  const operator = isSuperAdministrator();
  const selected = operator ? (data.selectedTable || chooseDatabaseTable(tables)) : '';
  const columns = databaseColumns();
  const rows = data.rows || [];
  const pk = databasePrimaryKey();
  const canWrite = Boolean(operator && selected && data.schema && !data.schema.writeBlocked);
  return `<section class="admin-section">
    <div class="admin-metrics">
      ${metric('数据表', number(status.totals?.tables).toLocaleString(), `${number(status.migrationCount)} 项迁移已执行`, 'green')}
      ${metric('估算记录', number(status.totals?.estimatedRows).toLocaleString(), '来自 MySQL 表统计信息', 'lime')}
      ${metric('数据容量', formatBytes(status.totals?.dataBytes), `索引 ${formatBytes(status.totals?.indexBytes)}`, 'blue')}
      ${metric(operator ? '当前表' : '当前权限', operator ? (selected ? tableDisplayName(selected) : '未选择') : '只读概览', canWrite ? '可由超级管理员写入' : operator ? '受保护或未加载' : '表级数据仅对超级管理员开放', 'orange')}
    </div>
    ${renderDatabaseCommandBar(selected, canWrite, operator)}
    <div class="admin-db-layout">
      <section class="admin-card admin-db-tables"><header class="admin-card-head"><div><h2>数据库表</h2><p>${html(status.databaseName || '—')} · ${html(isoTime(status.checkedAt))}</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-database">刷新</button></header><div class="admin-db-table-list">${tables.length ? tables.map((table) => `<button class="admin-db-table-item${table.name === selected ? ' is-active' : ''}" ${operator ? 'data-action="select-db-table"' : 'disabled'} data-table="${html(table.name)}"><span><strong>${html(tableDisplayName(table.name))}</strong><small>${html(table.name)}</small></span><em>${number(table.estimatedRows).toLocaleString()}</em></button>`).join('') : empty('数据库中没有可展示的数据表')}</div></section>
      <section class="admin-card admin-db-workbench">
        <header class="admin-card-head"><div><h2>${selected ? html(tableDisplayName(selected)) : '表数据'}</h2><p>${selected ? `${html(selected)} · ${columns.length} 个字段 · ${number(data.total).toLocaleString()} 行` : '请选择一张数据表'}</p></div><div class="admin-table-actions"><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-db-table" ${selected ? '' : 'disabled'}>刷新表</button><button class="admin-button admin-button--lime admin-button--small" data-action="new-db-row" ${canWrite ? '' : 'disabled'}>新增记录</button></div></header>
        ${operator ? renderDatabaseToolbar(selected, columns) : ''}
        ${operator ? (data.loadingRows && !rows.length ? loading('正在读取表数据…') : renderDatabaseRows(rows, columns, pk)) : empty('当前账号可查看数据库健康与表规模。直接查看、导入、导出和修改表数据需要超级管理员权限。')}
        ${operator ? renderPagination('database', data) : ''}
      </section>
    </div>
    ${renderDatabaseReviewPanel(data.importResult)}
  </section>`;
}

function renderDatabaseCommandBar(selected, canWrite, operator = isSuperAdministrator()) {
  if (!operator) return `<section class="admin-callout"><span><strong>需要用自然语言或文件整理数据？</strong><small>前往 Agent 工作台查看审核任务；只有超级管理员可确认入库。</small></span><button class="admin-button admin-button--ghost admin-button--small" data-section="agents">前往 Agent 工作台</button></section>`;
  return `<section class="admin-card admin-db-command"><div class="admin-db-command-main"><span class="admin-db-command-label">当前目标表</span><strong>${selected ? html(tableDisplayName(selected)) : '未选择数据表'}</strong><small>${selected ? html(selected) : '导入时可以在弹窗内选择目标表'}</small></div><div class="admin-db-command-actions"><button class="admin-db-command-button admin-db-command-button--primary" data-action="open-db-import"><span>导入文件</span><small>CSV / JSON / TXT / XLSX / SQL / DB</small></button><button class="admin-db-command-button" data-action="open-db-export" ${selected ? '' : 'disabled'}><span>导出当前表</span><small>CSV / TXT / SQL / XLSX</small></button><button class="admin-db-command-button" data-action="new-db-row" ${canWrite ? '' : 'disabled'}><span>新增记录</span><small>按字段创建一行</small></button></div></section>`;
}

function renderDatabaseToolbar(selected, columns) {
  return `<div class="admin-toolbar"><div class="admin-toolbar-left"><input class="admin-search" id="dbSearch" value="${html(state.database.keyword)}" placeholder="搜索当前表文本字段" ${selected ? '' : 'disabled'} /><select class="admin-select" id="dbOrderBy" ${selected ? '' : 'disabled'}><option value="">默认排序</option>${columns.map((column) => `<option value="${html(column.name)}" ${state.database.orderBy === column.name ? 'selected' : ''}>${html(column.name)}</option>`).join('')}</select><select class="admin-select" id="dbOrderDir" ${selected ? '' : 'disabled'}><option value="ASC" ${state.database.orderDir !== 'DESC' ? 'selected' : ''}>升序</option><option value="DESC" ${state.database.orderDir === 'DESC' ? 'selected' : ''}>降序</option></select><button class="admin-button admin-button--ghost admin-button--small" data-action="search-db-table" ${selected ? '' : 'disabled'}>查询</button></div><div class="admin-toolbar-right"><span class="admin-loading">${state.database.loadingRows ? '<i class="admin-spinner"></i>同步中' : `第 ${number(state.database.page, 1).toLocaleString()} 页`}</span></div></div>`;
}

function renderDatabaseRows(rows, columns, pk) {
  if (!state.database.selectedTable) return empty('请选择左侧数据库表');
  if (!state.database.schema) return empty('暂未读取到表结构');
  if (!rows.length) return empty('当前表没有匹配的数据行');
  const editable = Boolean(pk && !state.database.schema.writeBlocked);
  return `<div class="admin-table-wrap admin-db-row-wrap"><table class="admin-table admin-db-row-table"><thead><tr>${columns.map((column) => `<th title="${html(column.columnType || column.dataType)}">${html(column.name)}${column.primaryKey ? ' *' : ''}</th>`).join('')}<th>操作</th></tr></thead><tbody>${rows.map((row, index) => `<tr>${columns.map((column) => `<td>${databaseCell(row[column.name])}${column.sensitive ? '<span class="admin-table-note">敏感字段</span>' : ''}</td>`).join('')}<td><span class="admin-table-actions">${editable ? `<button class="admin-button admin-button--ghost admin-button--small" data-action="edit-db-row" data-index="${index}">编辑</button><button class="admin-button admin-button--danger admin-button--small" data-action="delete-db-row" data-index="${index}">删除</button>` : '<span class="admin-table-note">不可写</span>'}</span></td></tr>`).join('')}</tbody></table></div>`;
}

function renderDatabaseReviewPanel(importResult) {
  if (!importResult) return '';
  return `<section class="admin-card"><header class="admin-card-head"><div><h2>最近导入结果</h2><p>${html(importResult.table || '')}</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="clear-db-import-result">清除</button></header>${renderImportResult(importResult)}</section>`;
}

function renderImportResult(result) {
  if (!result) return '';
  const preview = result.preview || [];
  const previewColumns = [...new Set(preview.flatMap((row) => Object.keys(row)))].slice(0, 12);
  const review = result.review || {};
  return `<div class="admin-import-result"><div class="admin-issue-meta"><strong>${result.dryRun ? '导入预览' : '导入完成'} · ${number(result.rowCount).toLocaleString()} 行</strong>${badge(result.mode || result.format || 'import')}</div><p>表 ${html(result.table)} · ${html(result.format)} · ${html(result.checksum || '')}</p>${review.agentType ? `<div class="admin-agent-review"><strong>${html(review.displayName || review.agentType)}</strong><span>${html(review.modelReady ? '可执行模型审核' : '等待接入模型审核')}</span><small>${html(review.note || '')}</small></div>` : ''}${preview.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${previewColumns.map((column) => `<th>${html(column)}</th>`).join('')}</tr></thead><tbody>${preview.map((row) => `<tr>${previewColumns.map((column) => `<td>${databaseCell(row[column])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}</div>`;
}

function renderSchools() {
  const data = state.schools;
  const rows = data.data || [];
  return `<section class="admin-card">
    <div class="admin-toolbar"><div class="admin-toolbar-left"><input class="admin-search" id="schoolSearch" value="${html(data.keyword)}" placeholder="搜索院校名称、省份或院校代码" /><button class="admin-button admin-button--ghost admin-button--small" data-action="search-schools">搜索</button></div><div class="admin-toolbar-right"><select class="admin-select" id="schoolStatus"><option value="">全部状态</option><option value="active" ${data.catalogStatus === 'active' ? 'selected' : ''}>正常</option><option value="archived" ${data.catalogStatus === 'archived' ? 'selected' : ''}>已归档</option></select><span class="admin-loading">${data.loading ? '<i class="admin-spinner"></i>同步中' : `共 ${number(data.total).toLocaleString()} 所`}</span></div></div>
    ${data.loading && !rows.length ? loading('正在读取院校资料…') : rows.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>院校</th><th>地区 / 分区</th><th>层次</th><th>核验</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${rows.map(renderSchoolRow).join('')}</tbody></table></div>` : empty('没有匹配的院校资料')}
    ${renderPagination('schools', data)}
  </section>`;
}

function renderSchoolRow(school) {
  const archived = (school.catalogStatus ?? school.catalog_status) === 'archived';
  const lifecycleControl = archived
    ? `<button class="admin-button admin-button--lime admin-button--small" data-action="restore-school" data-id="${number(school.id)}">恢复</button>`
    : `<button class="admin-button admin-button--danger admin-button--small" data-action="delete-school" data-id="${number(school.id)}">归档</button>`;
  return `<tr><td><span class="admin-table-title">${html(school.name)}</span><span class="admin-table-note">${html(school.institutionCode ?? school.institution_code ?? '未填写院校代码')}</span></td><td>${html([school.province, school.city].filter(Boolean).join(' · ') || '—')}<span class="admin-table-note">${html(school.zone || '—')} 区</span></td><td>${badge(school.level || '未标注')}</td><td>${badge(school.verificationStatus ?? school.verification_status ?? 'pending')}</td><td>${html(isoTime(school.updatedAt ?? school.updated_at))}</td><td><span class="admin-table-actions"><button class="admin-button admin-button--ghost admin-button--small" data-action="edit-school" data-id="${number(school.id)}">编辑</button>${lifecycleControl}</span></td></tr>`;
}

function renderUsers() {
  const data = state.users;
  const rows = data.data || [];
  return `<section class="admin-card"><div class="admin-toolbar"><div class="admin-toolbar-left"><input class="admin-search" id="userSearch" value="${html(data.keyword)}" placeholder="搜索昵称或邮箱" /><select class="admin-select" id="userRole"><option value="">全部角色</option><option value="admin">管理员</option><option value="user">普通用户</option></select><select class="admin-select" id="userStatus"><option value="">全部状态</option><option value="active">正常</option><option value="suspended">已暂停</option><option value="disabled">已停用</option></select><button class="admin-button admin-button--ghost admin-button--small" data-action="search-users">筛选</button></div><div class="admin-toolbar-right"><span class="admin-loading">${data.loading ? '<i class="admin-spinner"></i>同步中' : `共 ${number(data.total).toLocaleString()} 人`}</span></div></div>
    ${data.loading && !rows.length ? loading('正在读取用户列表…') : rows.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>注册时间</th><th>最近活动</th><th>操作</th></tr></thead><tbody>${rows.map(renderUserRow).join('')}</tbody></table></div>` : empty('没有匹配的用户')}
    ${renderPagination('users', data)}
  </section>`;
}

function renderUserRow(user) {
  const role = String(user.role || 'user');
  const status = String(user.status || 'active');
  const protectedTarget = role === 'super_admin' || number(user.id) === number(state.user?.id);
  const canChangeRole = state.user?.role === 'super_admin' && !protectedTarget;
  const canChangeStatus = !protectedTarget && (state.user?.role === 'super_admin' || role === 'user');
  const roleLabel = role === 'super_admin' ? '超级管理员' : role === 'admin' ? '管理员' : '普通用户';
  const statusLabel = status === 'active' ? '正常' : status === 'suspended' ? '已暂停' : '已停用';
  const controls = canChangeRole || canChangeStatus
    ? `<span class="admin-table-actions">${canChangeRole ? `<button class="admin-button admin-button--ghost admin-button--small" data-action="toggle-user-role" data-id="${number(user.id)}" data-role="${html(role)}">${role === 'admin' ? '设为用户' : '设为管理员'}</button>` : ''}${canChangeStatus ? `<button class="admin-button admin-button--${status === 'active' ? 'danger' : 'ghost'} admin-button--small" data-action="toggle-user-status" data-id="${number(user.id)}" data-status="${html(status)}">${status === 'active' ? '停用' : '恢复'}</button>` : ''}</span>`
    : `<span class="admin-table-note">${protectedTarget ? '受保护账号' : '无此操作权限'}</span>`;
  return `<tr><td><span class="admin-table-title">${html(user.username)}</span><span class="admin-table-note">${html(user.email || '未填写邮箱')}</span></td><td>${badge(roleLabel)}</td><td>${badge(statusLabel)}</td><td>${html(isoTime(user.createdAt ?? user.created_at))}</td><td>${html(isoTime(user.lastLoginAt ?? user.last_login_at ?? user.lastActiveAt))}</td><td>${controls}</td></tr>`;
}

function renderAgents() {
  const data = state.agents;
  const tabs = (isSuperAdministrator() ? [
    ['workbench', '入库工作台'],
    ['jobs', '审核任务', number(data.jobs?.total)],
    ['runs', '执行日志'],
    ['alerts', '告警中心', number(data.alerts?.openTotal)],
    ['settings', '配置与开关'],
  ] : [
    ['workbench', 'Agent 概览'],
    ['settings', '配置与开关'],
  ]);
  return `<section class="admin-section">
    <div class="admin-tabs" role="tablist" aria-label="Agent 管理导航">${tabs.map(([key, label, count]) => `<button class="admin-tab${data.tab === key ? ' is-active' : ''}" type="button" role="tab" aria-selected="${data.tab === key}" data-action="agent-tab" data-tab="${key}">${label}${count ? `<em>${count > 99 ? '99+' : count}</em>` : ''}</button>`).join('')}</div>
    ${data.loading && !data.configurations.length && !data.jobs.data.length ? loading('正在同步 Agent 工作台…') : renderAgentTab()}
  </section>`;
}

function renderAgentTab() {
  if (!isSuperAdministrator() && !['workbench', 'settings'].includes(state.agents.tab)) return renderAgentWorkbench();
  switch (state.agents.tab) {
    case 'jobs': return renderAgentJobs();
    case 'runs': return renderAgentRuns();
    case 'alerts': return renderAgentAlerts();
    case 'settings': return renderAgentSettings();
    default: return renderAgentWorkbench();
  }
}

function renderAgentWorkbench() {
  const data = state.agents;
  const canOperate = isSuperAdministrator();
  if (!canOperate) {
    return `<section class="admin-card"><header class="admin-card-head"><div><h2>Agent 管理概览</h2><p>入库草稿、执行日志与告警可能包含未发布数据。</p></div>${badge('只读')}</header><div class="admin-card-body"><div class="admin-callout admin-callout--warning">只有超级管理员可以发起或查看数据入库审核。你仍可在“配置与开关”中查看公开状态。</div></div></section>`;
  }
  const tables = data.tables || [];
  const selectedTable = data.draft?.table || data.currentJob?.targetTable || state.database.selectedTable || chooseDatabaseTable(tables);
  const speechSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const recentJobs = data.jobs.data.slice(0, 5);
  return `<div class="admin-agent-workbench">
    <section class="admin-card admin-agent-compose">
      <header class="admin-card-head"><div><h2>口述或导入数据</h2><p>Agent 会自动抽取字段、检查异常并生成待确认预览。</p></div>${badge(canOperate ? '可发起审核' : '只读')}</header>
      <div class="admin-card-body">
        ${canOperate ? '' : '<div class="admin-callout admin-callout--warning">只有超级管理员可以发起 Agent 审核、查看入库任务、执行日志与告警；当前账号可查看公开配置。</div>'}
        <form id="databaseAgentReviewForm" class="admin-agent-form">
          <input type="hidden" name="sourceType" value="${data.draft?.sourceType === 'voice' ? 'voice' : 'text'}" />
          <div class="admin-field admin-field--wide"><label for="agentInstruction">口述内容 / 文件审核备注</label><div class="admin-dictation"><textarea id="agentInstruction" name="instruction" maxlength="8000" placeholder="例如：新增海滨大学，位于山东青岛，A 区，双非。上传文件时可补充来源和审核重点；文件字段仍须使用数据库字段名。" ${canOperate ? '' : 'disabled'}>${html(data.draft?.instruction || '')}</textarea><button class="admin-dictation-button" type="button" data-action="toggle-agent-dictation" aria-pressed="false" ${canOperate && speechSupported ? '' : 'disabled'}><span class="admin-dictation-dot"></span><span data-speech-button-label>开始口述</span></button></div><small class="admin-field-help" id="agentSpeechStatus">${speechSupported ? '口述会实时转成可编辑文字，不会向本平台上传原始录音。文件备注会用于语义审核，不会执行自由格式的数据变换。' : '当前浏览器不支持语音输入；文件备注仅用于语义审核。'}</small></div>
          <div class="admin-agent-form-grid">
            <div class="admin-field"><label for="agentTargetTable">目标数据表 *</label><input id="agentTargetTable" name="table" list="agentTargetTables" required maxlength="64" value="${html(selectedTable)}" placeholder="universities" ${canOperate ? '' : 'disabled'} /><datalist id="agentTargetTables">${tables.map((table) => `<option value="${html(table.name)}">${html(tableDisplayName(table.name))}</option>`).join('')}</datalist></div>
            <div class="admin-field"><label for="agentImportMode">入库模式</label><select id="agentImportMode" name="mode" ${canOperate ? '' : 'disabled'}><option value="insert" ${data.draft?.mode !== 'upsert' ? 'selected' : ''}>新增记录</option><option value="upsert" ${data.draft?.mode === 'upsert' ? 'selected' : ''}>唯一键冲突时更新</option></select></div>
            <div class="admin-field"><label for="databaseAgentFile">可选数据文件</label><input class="admin-file admin-file--wide" id="databaseAgentFile" name="file" type="file" accept=".csv,.txt,.tsv,.json,.sql,.xlsx,.db" ${canOperate ? '' : 'disabled'} /></div>
            <div class="admin-field"><label for="agentFileFormat">文件格式</label><select id="agentFileFormat" name="format" ${canOperate ? '' : 'disabled'}>${DB_IMPORT_FORMATS.map((format) => `<option value="${format}" ${format === (data.draft?.format || 'csv') ? 'selected' : ''}>${databaseFormatLabel(format)}${format === 'txt' ? '（TAB）' : ''}</option>`).join('')}</select></div>
            <div class="admin-field admin-field--wide" data-agent-source-table ${data.draft?.format === 'db' ? '' : 'hidden'}><label for="agentSourceTable">DB 源表名</label><input id="agentSourceTable" name="sourceTable" maxlength="64" value="${html(selectedTable)}" ${canOperate ? '' : 'disabled'} /></div>
          </div>
          <div class="admin-agent-submit"><span><strong>安全确认</strong><small>Agent 只生成审核建议，必须在预览中确认后才会写入数据库。</small></span><button class="admin-button admin-button--lime" type="submit" ${canOperate && !data.submitting ? '' : 'disabled'}>${data.submitting ? '<i class="admin-spinner"></i>正在审核…' : '生成审核预览'}</button></div>
        </form>
      </div>
    </section>
    ${data.currentJob ? renderAgentJobReview(data.currentJob, { featured: true }) : `<section class="admin-card admin-agent-review-empty"><div class="admin-empty"><div><strong>待审核预览</strong><span>提交口述内容或文件后，这里会展示自动字段映射、风险和建议数据。</span></div></div></section>`}
    <section class="admin-card admin-agent-recent"><header class="admin-card-head"><div><h2>最近审核任务</h2><p>所有入库确认、驳回与失败都会留痕。</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="agent-tab" data-tab="jobs">查看全部</button></header>${recentJobs.length ? renderAgentJobTable(recentJobs) : empty('暂无 Agent 审核任务')}</section>
    ${renderAgentRecentSignals()}
  </div>`;
}

function renderAgentRecentSignals() {
  if (!isSuperAdministrator()) return '';
  const runs = state.agents.runs.data.slice(0, 4);
  const alerts = state.agents.alerts.data.slice(0, 4);
  return `<div class="admin-grid admin-agent-signals">
    <section class="admin-card"><header class="admin-card-head"><div><h2>最近执行</h2><p>Agent 运行状态与耗时。</p></div>${isSuperAdministrator() ? '<button class="admin-button admin-button--ghost admin-button--small" data-action="agent-tab" data-tab="runs">全部日志</button>' : ''}</header><div class="admin-card-body">${!isSuperAdministrator() ? '<p class="admin-table-note">仅超级管理员可查看执行日志。</p>' : runs.length ? `<div class="admin-kpi-list">${runs.map((run) => `<div class="admin-kpi-row"><i class="admin-kpi-dot" style="--dot:${String(run.status).toLowerCase() === 'failed' ? '#c65d5d' : '#2b7652'}"></i><span class="admin-kpi-copy"><strong>${html(run.runType || 'database-agent')} #${number(run.id)}</strong><small>${html(isoTime(run.createdAt))} · ${html(run.model || '未记录模型')}</small></span><span class="admin-kpi-value">${html(durationLabel(run.durationMs))}</span></div>`).join('')}</div>` : empty('暂无 Agent 执行记录')}</div></section>
    <section class="admin-card"><header class="admin-card-head"><div><h2>最近告警</h2><p>待确认的运行与数据风险。</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="agent-tab" data-tab="alerts">告警中心</button></header><div class="admin-card-body">${alerts.length ? `<div class="admin-issue-list">${alerts.map((alert) => `<article class="admin-issue"><div class="admin-issue-meta"><strong>${html(alert.title || alert.alertType || '系统告警')}</strong>${badge(alert.severity || 'warning')}</div><p>${html(alert.message || '未提供告警说明')}</p><small class="admin-table-note">${html(isoTime(alert.lastDetectedAt || alert.createdAt))}</small></article>`).join('')}</div>` : empty('当前没有待处理告警')}</div></section>
  </div>`;
}

function agentJobStatus(job) {
  return job?.status || job?.reviewStatus || 'pending_review';
}

function agentJobCanApply(job) {
  const status = String(agentJobStatus(job)).toLowerCase();
  const reviewStatus = String(job?.reviewStatus || job?.review?.status || '').toLowerCase();
  return Boolean(isSuperAdministrator() && job?.id && job?.checksum
    && status === 'awaiting_confirmation'
    && reviewStatus !== 'blocked');
}

function agentJobCanReject(job) {
  return Boolean(isSuperAdministrator() && job?.id && ['awaiting_confirmation', 'blocked'].includes(String(agentJobStatus(job)).toLowerCase()));
}

function agentIssueText(issue) {
  if (typeof issue === 'string') return issue;
  return issue?.message || issue?.summary || issue?.code || JSON.stringify(issue || {});
}

function renderAgentJobReview(job, { featured = false } = {}) {
  const review = job.review || {};
  const preview = Array.isArray(job.preview) ? job.preview : [];
  const columns = [...new Set(preview.flatMap((row) => Object.keys(row || {})))].slice(0, 12);
  const issues = Array.isArray(review.issues) ? review.issues : [];
  const semanticSample = review.semanticReviewSample || {};
  const status = agentJobStatus(job);
  return `<section class="admin-card admin-agent-review-panel${featured ? ' is-featured' : ''}">
    <header class="admin-card-head"><div><h2>审核预览 #${number(job.id)}</h2><p>${html(job.sourceName || (job.sourceType === 'file' ? '导入文件' : '口述 / 文本'))} · ${html(job.targetTable || '未识别数据表')} · ${html(isoTime(job.createdAt))}</p></div><div class="admin-table-actions">${badge(statusLabel(status))}${badge(agentRiskLabel(review.riskLevel))}</div></header>
    <div class="admin-agent-review-summary">
      <div><span>建议行数</span><strong>${number(job.rowCount).toLocaleString()}</strong></div>
      <div><span>入库模式</span><strong>${job.mode === 'upsert' ? '新增或更新' : '新增'}</strong></div>
      <div><span>模型状态</span><strong>${html(modelStatusLabel(review.modelStatus || (job.model ? 'completed' : 'pending')))}</strong></div>
      <div><span>已写入</span><strong>${number(job.affectedRows).toLocaleString()}</strong></div>
    </div>
    <div class="admin-card-body admin-agent-review-copy">
      <div><h3>Agent 结论</h3><p>${html(review.summary || '审核结论生成中或暂无摘要。')}</p>${review.extractionSummary ? `<small><strong>抽取：</strong>${html(review.extractionSummary)}</small>` : ''}${review.recommendation ? `<small><strong>建议：</strong>${html(review.recommendation)}</small>` : ''}</div>
      <div><h3>风险与异常</h3>${issues.length ? `<ul>${issues.map((issue) => `<li>${html(agentIssueText(issue))}</li>`).join('')}</ul>` : '<p>未发现需要单独提示的异常。</p>'}</div>
    </div>
    ${semanticSample.sampled ? `<div class="admin-callout admin-callout--warning">语义模型已按首尾均匀抽样审核 ${number(semanticSample.sampleSize)} / ${number(semanticSample.totalRows)} 行；服务器硬规则已检查全部行。确认前请下载完整暂存数据核对。</div>` : ''}
    ${job.errorMessage ? `<div class="admin-callout admin-callout--danger">${html(job.errorMessage)}</div>` : ''}
    ${preview.length ? `<div class="admin-table-wrap admin-agent-preview"><table class="admin-table"><thead><tr>${columns.map((column) => `<th>${html(column)}</th>`).join('')}</tr></thead><tbody>${preview.slice(0, 10).map((row) => `<tr>${columns.map((column) => `<td>${databaseCell(row?.[column])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : empty('当前任务没有可展示的数据行')}
    <footer class="admin-agent-review-actions"><span class="admin-agent-checksum" title="${html(job.checksum || '')}">校验 ${html(String(job.checksum || '—').slice(0, 16))}${job.checksum ? '…' : ''} · 当前表格展示前 ${Math.min(10, preview.length)} 行</span><div><button class="admin-button admin-button--ghost" data-action="download-agent-job" data-id="${number(job.id)}" ${job.id && job.checksum ? '' : 'disabled'}>下载完整 JSON</button><button class="admin-button admin-button--danger" data-action="reject-agent-job" data-id="${number(job.id)}" ${agentJobCanReject(job) ? '' : 'disabled'}>驳回任务</button><button class="admin-button admin-button--lime" data-action="apply-agent-job" data-id="${number(job.id)}" ${agentJobCanApply(job) ? '' : 'disabled'}>确认并入库</button></div></footer>
  </section>`;
}

function renderAgentJobTable(rows) {
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>时间</th><th>来源</th><th>目标表</th><th>数据量</th><th>风险</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.map((job) => `<tr><td>${html(isoTime(job.createdAt))}</td><td><span class="admin-table-title">${html(job.sourceName || (job.sourceType === 'file' ? '文件导入' : '口述 / 文本'))}</span><span class="admin-table-note">#${number(job.id)} · ${html(job.model || '未记录模型')}</span></td><td>${html(job.targetTable || '—')}</td><td>${number(job.rowCount).toLocaleString()} 行</td><td>${badge(agentRiskLabel(job.review?.riskLevel))}</td><td>${badge(statusLabel(agentJobStatus(job)))}</td><td><button class="admin-button admin-button--ghost admin-button--small" data-action="view-agent-job" data-id="${number(job.id)}">查看审核</button></td></tr>`).join('')}</tbody></table></div>`;
}

function renderAgentJobs() {
  const data = state.agents.jobs;
  if (!isSuperAdministrator()) return `<section class="admin-card"><header class="admin-card-head"><div><h2>数据入库审核任务</h2><p>任务预览可能包含未入库的敏感数据。</p></div></header>${empty('只有超级管理员可以查看数据入库审核任务。')}</section>`;
  return `<section class="admin-card"><header class="admin-card-head"><div><h2>数据入库审核任务</h2><p>查看口述与文件的解析、审核和入库结果。</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-agent-jobs">刷新</button></header>${data.loading && !data.data.length ? loading('正在读取审核任务…') : data.data.length ? renderAgentJobTable(data.data) : empty('暂无 Agent 审核任务')}${renderPagination('agent-jobs', data)}</section>`;
}

function renderAgentRuns() {
  const data = state.agents.runs;
  const rows = data.data || [];
  if (!isSuperAdministrator()) return `<section class="admin-card"><header class="admin-card-head"><div><h2>Agent 执行日志</h2><p>执行日志包含数据入库 Agent 的脱敏运行摘要。</p></div></header>${empty('只有超级管理员可以查看 Agent 执行日志。')}</section>`;
  return `<section class="admin-card"><header class="admin-card-head"><div><h2>Agent 执行日志</h2><p>仅展示脱敏运行摘要、耗时和错误码，不回显密钥或原始对话。</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-agent-runs">刷新</button></header>${data.loading && !rows.length ? loading('正在读取执行日志…') : rows.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>开始时间</th><th>运行 / 操作者</th><th>类型</th><th>模型</th><th>状态</th><th>耗时</th><th>结果</th></tr></thead><tbody>${rows.map((run) => `<tr><td>${html(isoTime(run.createdAt || run.startedAt))}</td><td><span class="admin-table-title">#${number(run.id)}</span><span class="admin-table-note">${html(run.actor?.username || (run.jobId ? `任务 #${number(run.jobId)}` : '系统'))}</span></td><td>${html(run.runType || run.type || 'database-review')}</td><td>${html(run.model || '—')}</td><td>${badge(statusLabel(run.status))}</td><td>${html(durationLabel(run.durationMs ?? run.duration_ms))}</td><td>${run.errorCode || run.errorMessage ? `<span class="admin-table-title admin-text-danger">${html(run.errorCode || '执行失败')}</span><span class="admin-table-note">${html(run.errorMessage || '')}</span>` : `<span class="admin-table-note">输入 ${number(run.inputChars ?? run.input_chars).toLocaleString()} / 输出 ${number(run.outputChars ?? run.output_chars).toLocaleString()}</span>`}</td></tr>`).join('')}</tbody></table></div>` : empty('暂无 Agent 执行日志')}${renderPagination('agent-runs', data)}</section>`;
}

function renderAgentAlerts() {
  const data = state.agents.alerts;
  const rows = data.data || [];
  return `<section class="admin-card"><header class="admin-card-head"><div><h2>自动告警中心</h2><p>集中处理 Agent 失败、高风险审核、异常访问和数据写入问题。</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-agent-alerts">刷新</button></header><div class="admin-toolbar"><div class="admin-toolbar-left"><select class="admin-select" id="agentAlertStatus"><option value="open" ${data.status === 'open' ? 'selected' : ''}>待处理</option><option value="acknowledged" ${data.status === 'acknowledged' ? 'selected' : ''}>已确认</option><option value="resolved" ${data.status === 'resolved' ? 'selected' : ''}>已解决</option><option value="" ${data.status === '' ? 'selected' : ''}>全部告警</option></select><button class="admin-button admin-button--ghost admin-button--small" data-action="filter-agent-alerts">筛选</button></div><div class="admin-toolbar-right"><span class="admin-loading">共 ${number(data.total).toLocaleString()} 条</span></div></div>${data.loading && !rows.length ? loading('正在读取告警…') : rows.length ? `<div class="admin-alert-list">${rows.map(renderAgentAlert).join('')}</div>` : empty('当前没有匹配的告警')}${renderPagination('agent-alerts', data)}</section>`;
}

function renderAgentAlert(alert) {
  const status = String(alert.status || 'open');
  const severity = alert.severity || alert.riskLevel || 'warning';
  return `<article class="admin-alert admin-alert--${html(String(severity).toLowerCase())}"><div class="admin-alert-icon">!</div><div class="admin-alert-copy"><div class="admin-issue-meta"><strong>${html(alert.title || alert.alertType || alert.type || '系统告警')}</strong><span>${badge(severity)} ${badge(statusLabel(status))}</span></div><p>${html(alert.message || alert.summary || alert.description || '未提供告警说明')}</p><small>${html(isoTime(alert.lastDetectedAt || alert.createdAt))}${alert.resourceType || alert.resourceId || alert.sourceType || alert.sourceId ? ` · ${html(alert.resourceType || alert.sourceType || '来源')} ${html(alert.resourceId || alert.sourceId || '')}` : ''}${number(alert.occurrenceCount) > 1 ? ` · 已发生 ${number(alert.occurrenceCount)} 次` : ''}</small></div><div class="admin-alert-actions">${status === 'open' ? `<button class="admin-button admin-button--ghost admin-button--small" data-action="set-agent-alert-status" data-id="${number(alert.id)}" data-status="acknowledged">确认</button>` : `<button class="admin-button admin-button--ghost admin-button--small" data-action="set-agent-alert-status" data-id="${number(alert.id)}" data-status="open">重新打开</button>`}${status !== 'resolved' ? `<button class="admin-button admin-button--lime admin-button--small" data-action="set-agent-alert-status" data-id="${number(alert.id)}" data-status="resolved">标记解决</button>` : ''}</div></article>`;
}

function renderAgentSettings() {
  const configs = state.agents.configurations || [];
  const flags = state.agents.flags || [];
  const databaseManager = configs.find((item) => (item.key || item.configurationKey) === 'database-manager');
  const otherConfigs = configs.filter((item) => item !== databaseManager);
  return `<section class="admin-section admin-agent-settings">
    ${renderAgentModelSettings()}
    <section class="admin-card">
      <header class="admin-card-head"><div><h2>工作流策略</h2><p>查看数据抽取、内容审核、人工确认与安全入库流程。</p></div>${databaseManager ? badge(databaseManager.enabled === true ? '启用' : '已停用') : ''}</header>
      <div class="admin-card-body">${databaseManager ? renderDatabaseManagerWorkflow(databaseManager) : empty('暂无数据库管理 Agent 配置')}</div>
    </section>
    ${otherConfigs.length ? `<section class="admin-card"><header class="admin-card-head"><div><h2>其他智能体配置</h2><p>已审核的固定智能体策略。</p></div></header><div class="admin-card-body"><div class="admin-config-grid">${otherConfigs.map(renderConfiguration).join('')}</div></div></section>` : ''}
    <div class="admin-grid admin-agent-settings-footer">
      <section class="admin-card"><header class="admin-card-head"><div><h2>功能开关</h2><p>关闭后新请求不会进入对应能力。</p></div></header><div class="admin-card-body">${flags.length ? `<div class="admin-issue-list">${flags.map(renderFlag).join('')}</div>` : empty('暂无功能开关')}</div></section>
      <section class="admin-card"><header class="admin-card-head"><div><h2>管理原则</h2><p>AI 只能生成建议和待确认提案；模型没有数据库写权限。</p></div></header><div class="admin-card-body"><div class="admin-kpi-list"><div class="admin-kpi-row"><i class="admin-kpi-dot"></i><span class="admin-kpi-copy"><strong>凭据安全</strong><small>密钥可由超级管理员替换或清除，但后台永远不会读取或回显明文。</small></span></div><div class="admin-kpi-row"><i class="admin-kpi-dot" style="--dot:#efaa56"></i><span class="admin-kpi-copy"><strong>变更可追溯</strong><small>模型配置、工作流、审核、入库和告警处置都会写入后台审计日志。</small></span></div></div></div></section>
    </div>
  </section>`;
}

function renderAgentModelSettings() {
  const modelState = state.agents.modelSettings;
  const settings = modelState.data;
  const canMutate = isSuperAdministrator();
  if (modelState.loading && !settings) {
    return `<section class="admin-card"><header class="admin-card-head"><div><h2>模型连接</h2><p>管理 Agent 共用的模型服务与服务器端凭据。</p></div></header>${loading('正在读取模型连接…')}</section>`;
  }
  if (!canMutate) {
    return `<section class="admin-card"><header class="admin-card-head"><div><h2>模型连接</h2><p>模型与凭据属于全局敏感配置。</p></div>${badge('只读')}</header><div class="admin-card-body"><div class="admin-callout admin-callout--warning">只有超级管理员可以查看模型连接状态或修改 API Key。</div></div></section>`;
  }
  if (!settings) {
    return `<section class="admin-card"><header class="admin-card-head"><div><h2>模型连接</h2><p>管理 Agent 共用的模型服务与服务器端凭据。</p></div></header><div class="admin-card-body">${modelState.error ? `<div class="admin-callout admin-callout--danger admin-callout--embedded">${html(modelState.error)}</div>` : empty('模型连接配置暂不可用')}</div></section>`;
  }
  const busy = modelState.loading || modelState.saving || modelState.testing;
  const disabled = busy ? 'disabled' : '';
  const credentialMode = settings.credentialMode || settings.credentialSource || (settings.keyConfigured ? 'database' : 'disabled');
  const credentialSource = settings.credentialSource || credentialMode;
  const keyStatus = credentialSource === 'environment'
    ? '由服务器环境变量提供；在此保存新密钥后会切换为数据库加密凭据'
    : credentialSource === 'disabled'
      ? credentialMode === 'database' && settings.keyConfigured
        ? '数据库凭据已保存，但当前服务器无法使用；请检查主密钥配置'
        : '模型凭据已禁用或尚未配置'
      : settings.keyConfigured
      ? `数据库加密凭据已配置${settings.keyLastFour ? ` · ••••${html(settings.keyLastFour)}` : ''}`
      : '未配置';
  const credentialBadge = credentialSource === 'environment'
    ? '环境密钥'
    : credentialSource === 'disabled' ? '凭据已禁用' : settings.keyConfigured ? '数据库密钥' : '密钥未配置';
  const credentialModeLabel = ({ database: '数据库加密', environment: '服务器环境变量', disabled: '已禁用' })[credentialMode] || '未知';
  const testResult = modelState.testResult;
  return `<section class="admin-card admin-model-settings-card">
    <header class="admin-card-head"><div><h2>模型连接</h2><p>配置 Agent 调用的模型、兼容接口地址与 API Key。</p></div>${badge(credentialBadge)}</header>
    <div class="admin-card-body">
      ${credentialSource === 'environment' ? '<div class="admin-callout admin-callout--warning">当前模型调用由服务器环境变量控制。下面的连接参数会在你输入并保存新 API Key、切换为数据库加密凭据后生效。</div>' : ''}
      ${settings.credentialEncryptionConfigured === false ? '<div class="admin-callout admin-callout--warning">服务器尚未配置模型凭据加密主密钥。环境凭据仍可测试，但在运维完成 AGENT_CREDENTIAL_ENCRYPTION_KEY 配置前不能保存新的 API Key。</div>' : ''}
      <form id="agentModelSettingsForm" class="admin-model-form" autocomplete="off">
        <div class="admin-agent-form-grid">
          <div class="admin-field"><label for="agentModelProvider">服务商 *</label><input id="agentModelProvider" name="provider" list="agentModelProviders" maxlength="40" required value="${html(settings.provider || '')}" placeholder="deepseek" ${disabled} /><datalist id="agentModelProviders"><option value="deepseek"></option><option value="openai"></option><option value="azure-openai"></option><option value="custom"></option></datalist></div>
          <div class="admin-field"><label for="agentModelName">模型 *</label><input id="agentModelName" name="model" maxlength="128" required value="${html(settings.model || '')}" placeholder="deepseek-chat" ${disabled} /></div>
          <div class="admin-field admin-field--wide"><label for="agentModelBaseUrl">API 基础地址 *</label><input id="agentModelBaseUrl" name="baseUrl" type="url" maxlength="500" required value="${html(settings.baseUrl || '')}" placeholder="https://api.deepseek.com/v1" ${disabled} /><small class="admin-field-help">仅允许服务器白名单中的 HTTPS 模型域名；内网地址、IP、查询参数和非 443 端口会被拒绝。</small></div>
          <div class="admin-field admin-field--wide"><label for="agentModelApiKey">API Key</label><input id="agentModelApiKey" name="apiKey" type="password" minlength="8" maxlength="2048" autocomplete="new-password" placeholder="留空则保留现有密钥" ${disabled} /><small class="admin-field-help">${keyStatus}。密钥只会提交到服务器保存，这个输入框不会回填明文。</small></div>
        </div>
        <div class="admin-model-actions">
          <span class="admin-model-meta">凭据模式：${html(credentialModeLabel)} · 修订 ${number(settings.revision)}${settings.updatedAt ? ` · 更新于 ${html(isoTime(settings.updatedAt))}` : ''}<br />连接测试使用服务器当前已保存的配置</span>
          <div>
            <button class="admin-button admin-button--ghost admin-button--small" type="button" data-action="test-agent-model" ${settings.keyConfigured && !busy ? '' : 'disabled'}>${modelState.testing ? '<i class="admin-spinner"></i>正在测试…' : '测试连接'}</button>
            ${credentialMode === 'database' && settings.canClearKey ? `<button class="admin-button admin-button--danger admin-button--small" type="button" data-action="clear-agent-api-key" ${settings.keyConfigured && !busy ? '' : 'disabled'}>清除密钥</button>` : ''}
            <button class="admin-button admin-button--lime admin-button--small" type="submit" ${disabled}>${modelState.saving ? '<i class="admin-spinner"></i>正在保存…' : '保存模型配置'}</button>
          </div>
        </div>
      </form>
      ${testResult ? renderAgentModelTestResult(testResult) : ''}
    </div>
  </section>`;
}

function renderAgentModelTestResult(result) {
  const ok = result.ok === true;
  const details = [result.provider, result.model, result.durationMs === undefined ? '' : durationLabel(result.durationMs)].filter(Boolean);
  return `<div class="admin-model-test admin-model-test--${ok ? 'success' : 'error'}" role="status"><span class="admin-model-test-icon">${ok ? '✓' : '!'}</span><span><strong>${ok ? '模型连接测试通过' : '模型连接测试失败'}</strong><small>${html(details.join(' · ') || (ok ? '服务响应正常' : '服务未通过连接检查'))}${!ok && result.errorCode ? ` · 错误码：${html(result.errorCode)}` : ''}</small></span></div>`;
}

function renderDatabaseManagerWorkflow(item) {
  const settings = item.settings || {};
  const capabilities = new Set(Array.isArray(settings.capabilities) ? settings.capabilities : []);
  const supportedFormats = new Set(Array.isArray(settings.supportedFormats) ? settings.supportedFormats : []);
  const canMutate = isSuperAdministrator();
  const safe = settings.writeAccess === false && settings.requiresHumanConfirmation === true;
  const key = item.key || item.configurationKey || 'database-manager';
  const runtimeFlag = state.agents.flags.find((flag) => (flag.key || flag.flagKey) === 'agent-database-manager');
  const rolloutPercentage = number(runtimeFlag?.rolloutPercentage, 100);
  const runtimeEnabled = item.enabled === true && runtimeFlag?.enabled === true && rolloutPercentage > 0;
  const json = JSON.stringify(settings, null, 2);
  const capabilityStatus = (options) => options.map(([value, label]) => `<span class="admin-workflow-chip${capabilities.has(value) ? ' is-on' : ''}">${capabilities.has(value) ? '✓' : '–'} ${html(label)}</span>`).join('');
  return `<div class="admin-workflow-editor" data-workflow-key="${html(key)}">
    <div class="admin-workflow-status-grid">
      <div class="admin-workflow-summary ${safe ? 'is-safe' : 'is-unsafe'}"><span class="admin-workflow-summary-icon">${safe ? '✓' : '!'}</span><span><strong>${safe ? '安全边界已锁定' : '安全边界配置异常'}</strong><small>必须人工确认，模型无直接数据库写权限。</small></span></div>
      <div class="admin-workflow-summary ${runtimeEnabled ? 'is-safe' : 'is-paused'}"><span class="admin-workflow-summary-icon">${runtimeEnabled ? '●' : 'Ⅱ'}</span><span><strong>${runtimeEnabled ? '工作流正在运行' : '工作流当前受限'}</strong><small>Agent ${item.enabled === true ? '已启用' : '已停用'} · 功能开关 ${runtimeFlag?.enabled === true ? '已开启' : '已关闭'} · 发布 ${rolloutPercentage}%</small></span></div>
    </div>
    <div class="admin-workflow-note">以下四个阶段是服务端固定安全链；能力标签、格式和数值来自策略元数据，仅用于状态展示，不是可关闭的运行时检查。</div>
    <div class="admin-workflow-stages">
      <article class="admin-workflow-stage">
        <header><span>01</span><div><strong>数据抽取</strong><small>将口述、文本或文件转换为结构化待审数据。</small></div></header>
        <div class="admin-workflow-options">${capabilityStatus(AGENT_EXTRACTION_CAPABILITIES)}</div>
        <div class="admin-workflow-subsection"><strong>策略元数据 · 文件格式</strong><div class="admin-workflow-formats">${DB_IMPORT_FORMATS.map((format) => `<span class="${supportedFormats.has(format) ? 'is-on' : ''}">${databaseFormatLabel(format)}</span>`).join('')}</div></div>
      </article>
      <article class="admin-workflow-stage">
        <header><span>02</span><div><strong>自动审核</strong><small>在进入人工确认前运行数据质量与内容检查。</small></div></header>
        <div class="admin-workflow-options">${capabilityStatus(AGENT_REVIEW_CAPABILITIES)}</div>
        <div class="admin-workflow-value"><span><strong>预览策略元数据</strong><small>管理台记录的最大预览行数</small></span><em>${number(settings.maxPreviewRows, 20)} 行</em></div>
      </article>
      <article class="admin-workflow-stage admin-workflow-stage--locked">
        <header><span>03</span><div><strong>人工确认</strong><small>超级管理员核对风险、行数与校验和。</small></div></header>
        <label class="admin-safety-lock"><input type="checkbox" checked disabled /><span><strong>必须人工确认</strong><small>requiresHumanConfirmation = true</small></span><em>强制</em></label>
        <div class="admin-workflow-note">任何模型输出都只能形成待审提案，不能绕过确认步骤。</div>
      </article>
      <article class="admin-workflow-stage admin-workflow-stage--locked">
        <header><span>04</span><div><strong>安全入库</strong><small>复核数据库状态后，由服务器事务执行写入。</small></div></header>
        <label class="admin-safety-lock"><input type="checkbox" checked disabled /><span><strong>禁止模型直接写库</strong><small>writeAccess = false</small></span><em>强制</em></label>
        <div class="admin-workflow-value"><span><strong>暂存策略元数据</strong><small>配置中记录的待审保留周期</small></span><em>${number(settings.stagingTtlHours, 24)} 小时</em></div>
      </article>
    </div>
    <details class="admin-config-advanced">
      <summary>高级 JSON 策略元数据</summary>
      <p>用于审计、兼容和界面展示，不代表所有字段都会改变运行时行为。Agent 启停与发布比例请使用本页实际控制项；安全边界字段不能修改。</p>
      <label class="admin-config-label" for="agent-settings-${html(key)}">完整公开策略</label>
      <textarea class="admin-config-json" id="agent-settings-${html(key)}" data-config-settings="${html(key)}" spellcheck="false" ${canMutate ? '' : 'readonly'}>${html(json)}</textarea>
      ${canMutate ? '<button class="admin-button admin-button--ghost admin-button--small" type="button" data-action="save-config" data-key="database-manager">保存高级 JSON</button>' : ''}
    </details>
    ${canMutate ? `<div class="admin-workflow-actions"><span>Agent 启停会在下一次模型调用和数据库写入前生效；发布范围由下方功能开关控制。</span><button class="admin-button admin-button--${item.enabled === true ? 'danger' : 'lime'} admin-button--small" type="button" data-action="toggle-agent-config" data-key="${html(key)}" data-enabled="${item.enabled === true}">${item.enabled === true ? '停用 Agent' : '启用 Agent'}</button></div>` : '<small class="admin-table-note">仅超级管理员可修改工作流运行状态</small>'}
  </div>`;
}

function renderConfiguration(item) {
  const key = item.key || item.configurationKey || '';
  const enabled = item.enabled === true;
  const settings = JSON.stringify(item.settings || {}, null, 2);
  const canMutate = state.user?.role === 'super_admin';
  const controls = canMutate
    ? `<div class="admin-config-actions"><button class="admin-button admin-button--ghost admin-button--small" data-action="save-config" data-key="${html(key)}">保存设置</button><button class="admin-button admin-button--${enabled ? 'danger' : 'lime'} admin-button--small" data-action="toggle-agent-config" data-key="${html(key)}" data-enabled="${enabled}">${enabled ? '停用助手' : '启用助手'}</button></div>`
    : '<small class="admin-table-note">仅超级管理员可修改全局智能体配置</small>';
  return `<article class="admin-config-card"><div class="admin-issue-meta"><h3>${html(item.displayName || item.label || key)}</h3>${badge(enabled ? '启用' : '已停用')}</div><p>${html(item.description || '平台智能体运行配置')}</p><label class="admin-config-label" for="agent-settings-${html(key)}">公开策略设置（JSON）</label><textarea class="admin-config-json" id="agent-settings-${html(key)}" data-config-settings="${html(key)}" spellcheck="false" ${canMutate ? '' : 'readonly'}>${html(settings)}</textarea>${controls}</article>`;
}

function renderFlag(item) {
  const key = item.key || item.flagKey || '';
  const enabled = item.enabled === true || item.value === true || item.value === 'true';
  const rolloutPercentage = Math.max(0, Math.min(100, number(item.rolloutPercentage, 100)));
  const protectedConsole = key === 'admin-console';
  const canMutate = state.user?.role === 'super_admin';
  const control = protectedConsole
    ? '<small class="admin-table-note">紧急开关仅允许服务器运维恢复</small>'
    : !canMutate
      ? `<small class="admin-table-note">发布比例 ${rolloutPercentage}% · 仅超级管理员可修改</small>`
      : `<div class="admin-flag-controls"><label><span>发布比例</span><span class="admin-rollout-input"><input type="number" min="0" max="100" step="1" value="${rolloutPercentage}" data-flag-rollout="${html(key)}" aria-label="${html(item.displayName || key)}发布比例" /><em>%</em></span></label><button class="admin-button admin-button--ghost admin-button--small" data-action="save-flag-rollout" data-key="${html(key)}">保存比例</button><button class="admin-button admin-button--${enabled ? 'danger' : 'lime'} admin-button--small" data-action="toggle-flag" data-key="${html(key)}" data-enabled="${enabled}">${enabled ? '关闭功能' : '启用功能'}</button></div>`;
  return `<article class="admin-issue admin-flag-card"><div class="admin-issue-meta"><strong>${html(item.displayName || item.label || key)}</strong>${badge(enabled ? (rolloutPercentage > 0 ? '启用' : '发布暂停') : '已停用')}</div><p>${html(item.description || '平台功能控制开关')}</p>${control}</article>`;
}

function renderQuality() {
  const data = state.quality;
  const issues = data.issues || [];
  return `<section class="admin-card"><header class="admin-card-head"><div><h2>待处理资料问题</h2><p>导入过程检测到的缺失主表、名称歧义和待核验资料。</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-quality">刷新</button></header><div class="admin-card-body">${data.loading && !issues.length ? loading('正在读取资料问题…') : issues.length ? `<div class="admin-issue-list">${issues.map((issue) => `<article class="admin-issue"><div class="admin-issue-meta"><strong>${html(issue.entityKey ?? issue.entity_key ?? '未知对象')}</strong>${badge(issue.severity ?? 'warning')}</div><p>${html(issue.issueCode ?? issue.issue_code ?? '资料需要人工处理')}</p><div class="admin-issue-meta"><small>${html(isoTime(issue.createdAt ?? issue.created_at))}</small>${String(issue.status || 'open') === 'open' ? `<button class="admin-button admin-button--ghost admin-button--small" data-action="resolve-issue" data-id="${number(issue.id)}">标记已处理</button>` : badge(issue.status)}</div></article>`).join('')}</div>` : empty('没有待处理的数据问题')}</div>${renderPagination('quality', data)}</section>`;
}

function renderAudit() {
  const data = state.audit;
  return `<section class="admin-section"><div class="admin-tabs" role="tablist" aria-label="日志类型"><button class="admin-tab${data.tab === 'operations' ? ' is-active' : ''}" role="tab" aria-selected="${data.tab === 'operations'}" data-action="audit-tab" data-tab="operations">操作审计</button><button class="admin-tab${data.tab === 'access' ? ' is-active' : ''}" role="tab" aria-selected="${data.tab === 'access'}" data-action="audit-tab" data-tab="access">访问日志</button></div>${data.tab === 'access' ? renderAccessLogs() : renderOperationAudit()}</section>`;
}

function renderOperationAudit() {
  const data = state.audit;
  const rows = data.data || [];
  return `<section class="admin-card"><header class="admin-card-head"><div><h2>后台操作审计</h2><p>记录管理员对用户、院校、智能体和数据治理的关键变更。</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-audit">刷新</button></header>${data.loading && !rows.length ? loading('正在读取审计记录…') : rows.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th><th>说明</th></tr></thead><tbody>${rows.map((entry) => `<tr><td>${html(isoTime(entry.createdAt ?? entry.created_at))}</td><td>${html(auditActorName(entry))}</td><td>${html(entry.actionLabel ?? entry.action ?? entry.operation ?? '更新')}</td><td>${html(auditResourceName(entry))}</td><td>${html(auditSummary(entry))}</td></tr>`).join('')}</tbody></table></div>` : empty('暂无后台操作记录')}${renderPagination('audit', data)}</section>`;
}

function renderAccessLogs() {
  const data = state.audit.access;
  const rows = data.data || [];
  if (!isSuperAdministrator()) return `<section class="admin-card"><header class="admin-card-head"><div><h2>后台访问日志</h2><p>访问日志包含来源 IP 与客户端摘要。</p></div></header>${empty('只有超级管理员可以查看后台访问日志。')}</section>`;
  return `<section class="admin-card"><header class="admin-card-head"><div><h2>后台访问日志</h2><p>查看脱敏的管理端请求、响应状态、来源 IP 与耗时。</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-access-logs">刷新</button></header>${data.loading && !rows.length ? loading('正在读取访问日志…') : rows.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>时间</th><th>访问者</th><th>请求</th><th>响应</th><th>来源 IP</th><th>耗时</th><th>客户端</th></tr></thead><tbody>${rows.map((entry) => {
    const status = number(entry.statusCode ?? entry.status_code ?? entry.responseStatus);
    return `<tr><td>${html(isoTime(entry.createdAt ?? entry.created_at ?? entry.timestamp))}</td><td>${html(entry.username || entry.actorUsername || entry.actor?.username || entry.user?.username || '匿名 / 系统')}</td><td><span class="admin-table-title">${html(entry.method || 'GET')} ${html(entry.path || entry.url || entry.route || '—')}</span><span class="admin-table-note">${html(entry.requestId || entry.request_id || '')}</span></td><td>${badge(status ? String(status) : '未知')}</td><td>${html(entry.ipAddress || entry.ip_address || '—')}</td><td>${html(durationLabel(entry.durationMs ?? entry.duration_ms))}</td><td><span class="admin-table-note admin-access-agent" title="${html(entry.userAgent || entry.user_agent || '')}">${html(entry.userAgent || entry.user_agent || '—')}</span></td></tr>`;
  }).join('')}</tbody></table></div>` : empty('暂无后台访问日志')}${renderPagination('access-logs', data)}</section>`;
}

function renderIssue(issue) {
  return `<article class="admin-issue"><div class="admin-issue-meta"><strong>${html(issue.entityKey ?? issue.entity_key ?? '待处理资料')}</strong>${badge(issue.severity ?? 'warning')}</div><p>${html(issue.issueCode ?? issue.issue_code ?? '需要人工核验')}</p></article>`;
}

function renderPagination(kind, data) {
  const total = number(data.total);
  const page = Math.max(1, number(data.page, 1));
  const pageSize = Math.max(1, number(data.pageSize, PAGE_SIZE));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<div class="admin-pagination"><span>第 ${page} / ${pages} 页</span><button class="admin-button admin-button--ghost admin-button--small" data-action="page" data-kind="${kind}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button><button class="admin-button admin-button--ghost admin-button--small" data-action="page" data-kind="${kind}" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>下一页</button></div>`;
}

function renderModal() {
  if (!state.modal) return '';
  if (state.modal.type === 'database-import') return renderDatabaseImportModal();
  if (state.modal.type === 'database-export') return renderDatabaseExportModal();
  if (state.modal.type === 'database-row') return renderDatabaseRowModal();
  if (state.modal.type === 'agent-job') return renderAgentJobModal();
  if (state.modal.type !== 'school') return '';
  const school = state.modal.school || {};
  const detail = school.detail || {};
  const isEdit = Boolean(school.id);
  return `<div class="admin-modal-backdrop" data-action="close-modal"><section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="schoolModalTitle" onclick="event.stopPropagation()"><header class="admin-modal-head"><h2 id="schoolModalTitle">${isEdit ? '编辑院校资料' : '新增院校'}</h2><button class="admin-modal-close" data-action="close-modal">关闭</button></header><div class="admin-modal-body"><form id="schoolForm" class="admin-modal-form" data-id="${number(school.id)}"><div class="admin-field admin-field--wide"><label>院校名称 *</label><input name="name" required maxlength="191" value="${html(school.name)}" /></div><div class="admin-field"><label>省份 *</label><input name="province" required maxlength="64" value="${html(school.province)}" /></div><div class="admin-field"><label>城市</label><input name="city" maxlength="64" value="${html(school.city)}" /></div><div class="admin-field"><label>分区 *</label><select name="zone"><option value="A" ${school.zone !== 'B' ? 'selected' : ''}>A 区</option><option value="B" ${school.zone === 'B' ? 'selected' : ''}>B 区</option></select></div><div class="admin-field"><label>院校层次 *</label><select name="level">${['985', '211', '双一流', '双非'].map((value) => `<option value="${value}" ${school.level === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="admin-field"><label>院校类型</label><input name="type" maxlength="64" value="${html(school.type || '综合')}" /></div><div class="admin-field"><label>院校代码</label><input name="institutionCode" maxlength="64" value="${html(school.institutionCode ?? school.institution_code ?? '')}" /></div><div class="admin-field"><label>核验状态</label><select name="verificationStatus">${['pending', 'verified', 'unverified', 'needs_review', 'rejected'].map((value) => `<option value="${value}" ${(school.verificationStatus ?? school.verification_status ?? 'pending') === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="admin-field"><label>资料状态</label><select name="catalogStatus">${['active', 'archived'].map((value) => `<option value="${value}" ${(school.catalogStatus ?? school.catalog_status ?? 'active') === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="admin-field admin-field--wide"><label>院校地址</label><input name="address" maxlength="500" value="${html(detail.address || school.address || '')}" /></div><div class="admin-field admin-field--wide"><label>官网</label><input name="website" maxlength="500" value="${html(detail.website || school.website || '')}" /></div><div class="admin-field"><label>咨询电话</label><input name="phone" maxlength="128" value="${html(detail.phone || school.phone || '')}" /></div><div class="admin-field"><label>英文名称</label><input name="englishName" maxlength="191" value="${html(detail.englishName ?? detail.english_name ?? '')}" /></div><div class="admin-field admin-field--wide"><label>院校简介</label><textarea name="description">${html(detail.description || '')}</textarea></div><div class="admin-field admin-field--wide"><label>特色说明</label><textarea name="features">${html(detail.features || '')}</textarea></div><div class="admin-modal-footer admin-field--wide"><button type="button" class="admin-button admin-button--ghost" data-action="close-modal">取消</button><button type="submit" class="admin-button admin-button--lime">${isEdit ? '保存修改' : '创建院校'}</button></div></form></div></section></div>`;
}

function renderAgentJobModal() {
  const job = state.modal?.job;
  if (!job) return '';
  return `<div class="admin-modal-backdrop" data-action="close-modal"><section class="admin-modal admin-modal--agent" role="dialog" aria-modal="true" aria-labelledby="agentJobModalTitle" onclick="event.stopPropagation()"><header class="admin-modal-head"><h2 id="agentJobModalTitle">Agent 审核任务 #${number(job.id)}</h2><button class="admin-modal-close" data-action="close-modal">关闭</button></header><div class="admin-modal-body admin-modal-body--flush">${renderAgentJobReview(job)}</div></section></div>`;
}

function renderDatabaseTableOptions(selected = state.database.selectedTable) {
  const tables = databaseTables();
  return tables.map((table) => `<option value="${html(table.name)}" ${table.name === selected ? 'selected' : ''}>${html(tableDisplayName(table.name))} · ${html(table.name)}</option>`).join('');
}

function renderDatabaseImportModal() {
  const selected = state.modal?.table || state.database.selectedTable || chooseDatabaseTable(databaseTables());
  return `<div class="admin-modal-backdrop" data-action="close-modal">
    <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="dbImportModalTitle" onclick="event.stopPropagation()">
      <header class="admin-modal-head"><h2 id="dbImportModalTitle">生成兼容导入预览</h2><button class="admin-modal-close" data-action="close-modal">关闭</button></header>
      <div class="admin-modal-body"><form id="dbImportForm" class="admin-form">
        <div class="admin-field"><label>目标表</label><select name="table" required>${renderDatabaseTableOptions(selected)}</select></div>
        <div class="admin-field"><label>文件格式</label><select name="format">${DB_IMPORT_FORMATS.map((format) => `<option value="${format}" ${format === 'txt' ? 'selected' : ''}>${databaseFormatLabel(format)}${format === 'txt' ? '（TAB）' : ''}</option>`).join('')}</select></div>
        <div class="admin-field"><label>导入模式</label><select name="mode"><option value="insert">插入</option><option value="upsert">按唯一键更新</option></select></div>
        <div class="admin-field"><label>写入方式</label><p class="admin-table-note">此入口只生成预览；正式入库请到 Agent 工作台审核并确认校验和。</p></div>
        <div class="admin-field admin-field--wide"><label>选择文件</label><input class="admin-file admin-file--wide" name="file" type="file" accept=".csv,.txt,.tsv,.json,.sql,.xlsx,.db" required /></div>
        <div class="admin-field admin-field--wide"><label>DB 源表名</label><input name="sourceTable" value="${html(selected || '')}" maxlength="64" /></div>
        <div class="admin-modal-footer admin-field--wide"><button type="button" class="admin-button admin-button--ghost" data-action="close-modal">取消</button><button type="submit" class="admin-button admin-button--lime">生成预览</button></div>
      </form></div>
    </section>
  </div>`;
}

function renderDatabaseExportModal() {
  const selected = state.modal?.table || state.database.selectedTable;
  return `<div class="admin-modal-backdrop" data-action="close-modal"><section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="dbExportModalTitle" onclick="event.stopPropagation()"><header class="admin-modal-head"><h2 id="dbExportModalTitle">导出数据库表</h2><button class="admin-modal-close" data-action="close-modal">关闭</button></header><div class="admin-modal-body"><form id="dbExportForm" class="admin-form"><div class="admin-field"><label>目标表</label><select name="table" required>${renderDatabaseTableOptions(selected)}</select></div><div class="admin-field"><label>文件格式</label><select name="format">${DB_EXPORT_FORMATS.map((format) => `<option value="${format}" ${format === 'xlsx' ? 'selected' : ''}>${databaseFormatLabel(format)}</option>`).join('')}</select></div><div class="admin-modal-footer admin-field--wide"><button type="button" class="admin-button admin-button--ghost" data-action="close-modal">取消</button><button type="submit" class="admin-button admin-button--lime">导出文件</button></div></form></div></section></div>`;
}

function renderDatabaseRowModal() {
  const modal = state.modal || {};
  const creating = modal.mode === 'create';
  const row = modal.row || {};
  const columns = databaseEditableColumns({ creating });
  return `<div class="admin-modal-backdrop" data-action="close-modal"><section class="admin-modal admin-modal--wide" role="dialog" aria-modal="true" aria-labelledby="dbRowModalTitle" onclick="event.stopPropagation()"><header class="admin-modal-head"><h2 id="dbRowModalTitle">${creating ? '新增数据库记录' : '编辑数据库记录'}</h2><button class="admin-modal-close" data-action="close-modal">关闭</button></header><div class="admin-modal-body"><form id="dbRowForm" class="admin-modal-form admin-modal-form--db" data-table="${html(modal.table || state.database.selectedTable)}" data-id="${html(modal.id ?? '')}" data-mode="${creating ? 'create' : 'edit'}">${columns.length ? columns.map((column) => renderDatabaseField(column, row[column.name])).join('') : `<div class="admin-field admin-field--wide">${empty('当前表没有可编辑字段')}</div>`}<div class="admin-modal-footer admin-field--wide"><button type="button" class="admin-button admin-button--ghost" data-action="close-modal">取消</button><button type="submit" class="admin-button admin-button--lime" ${columns.length ? '' : 'disabled'}>${creating ? '创建记录' : '保存修改'}</button></div></form></div></section></div>`;
}

function renderDatabaseField(column, value) {
  const fieldValue = databaseFieldValue(value);
  const wide = ['text', 'mediumtext', 'longtext', 'json'].includes(column.dataType) || String(fieldValue).length > 80;
  const label = `${column.name}${column.nullable ? '' : ' *'}`;
  if (wide) {
    return `<div class="admin-field admin-field--wide"><label>${html(label)} · ${html(column.columnType || column.dataType)}</label><textarea name="${html(column.name)}" data-db-field="${html(column.name)}">${html(fieldValue)}</textarea></div>`;
  }
  const type = ['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'float', 'double', 'real'].includes(column.dataType) ? 'number' : 'text';
  return `<div class="admin-field"><label>${html(label)} · ${html(column.columnType || column.dataType)}</label><input name="${html(column.name)}" data-db-field="${html(column.name)}" type="${type}" value="${html(fieldValue)}" /></div>`;
}

function renderToast() {
  if (!state.toast) return '';
  return `<div class="admin-toast${state.toast.error ? ' admin-toast--error' : ''}" role="status">${html(state.toast.message)}</div>`;
}

async function loadDashboard() {
  state.dashboard = null;
  render();
  try {
    const dashboard = await adminRequest('/api/admin/dashboard');
    const [auditResult, issuesResult, alertsResult] = await Promise.allSettled([
      adminRequest('/api/admin/audit?page=1&pageSize=6'),
      adminRequest('/api/admin/catalog/issues?page=1&pageSize=4&status=open'),
      isSuperAdministrator()
        ? adminRequest('/api/admin/alerts?page=1&pageSize=4&status=open')
        : Promise.resolve({ page: 1, pageSize: 4, total: 0, data: [] }),
    ]);
    state.dashboard = {
      ...dashboard,
      recentAudit: auditResult.status === 'fulfilled' ? unwrapList(auditResult.value) : [],
      catalogIssues: issuesResult.status === 'fulfilled' ? unwrapList(issuesResult.value) : [],
    };
    if (alertsResult.status === 'fulfilled') {
      state.agents.alerts = {
        ...state.agents.alerts,
        ...paginationOf(alertsResult.value, state.agents.alerts),
        openTotal: number(alertsResult.value?.total),
        data: unwrapList(alertsResult.value),
      };
    }
    state.accessDenied = false;
  } catch (error) {
    handleAdminError(error);
  }
  render();
}

async function loadDatabase() {
  state.database.loading = true;
  render();
  try {
    const status = await adminRequest('/api/admin/database/status');
    const selectedTable = isSuperAdministrator() ? chooseDatabaseTable(status.tables || [], state.database.selectedTable) : '';
    state.database = {
      ...state.database,
      status,
      selectedTable,
      loading: false,
      schema: selectedTable === state.database.selectedTable ? state.database.schema : null,
      rows: selectedTable === state.database.selectedTable ? state.database.rows : [],
      total: selectedTable === state.database.selectedTable ? state.database.total : 0,
    };
    state.accessDenied = false;
    if (selectedTable) await loadDatabaseTable({ table: selectedTable, page: state.database.page || 1 });
  } catch (error) {
    state.database.loading = false;
    handleAdminError(error);
  }
  render();
}

async function loadDatabaseTable({ table = state.database.selectedTable, page = state.database.page } = {}) {
  if (!table || !isSuperAdministrator()) return;
  const sameTable = table === state.database.selectedTable;
  state.database = {
    ...state.database,
    selectedTable: table,
    page: Math.max(1, page),
    loadingRows: true,
    schema: sameTable ? state.database.schema : null,
    rows: sameTable ? state.database.rows : [],
    total: sameTable ? state.database.total : 0,
    importResult: sameTable ? state.database.importResult : null,
  };
  render();
  try {
    const query = new URLSearchParams({
      page: String(Math.max(1, page)),
      pageSize: String(state.database.pageSize || DB_PAGE_SIZE),
    });
    if (state.database.keyword) query.set('keyword', state.database.keyword);
    if (state.database.orderBy) query.set('orderBy', state.database.orderBy);
    if (state.database.orderDir) query.set('orderDir', state.database.orderDir);
    const encodedTable = encodeURIComponent(table);
    const [schema, payload] = await Promise.all([
      adminRequest(`/api/admin/database/tables/${encodedTable}/schema`),
      adminRequest(`/api/admin/database/tables/${encodedTable}/rows?${query}`),
    ]);
    state.database = {
      ...state.database,
      schema,
      rows: unwrapList(payload),
      ...paginationOf(payload, state.database),
      loadingRows: false,
    };
    state.accessDenied = false;
  } catch (error) {
    state.database.loadingRows = false;
    handleAdminError(error);
  }
  render();
}

async function loadSchools({ page = state.schools.page } = {}) {
  state.schools.loading = true;
  render();
  try {
    const query = new URLSearchParams({ page: String(Math.max(1, page)), pageSize: String(PAGE_SIZE) });
    if (state.schools.keyword) query.set('keyword', state.schools.keyword);
    if (state.schools.catalogStatus) query.set('catalogStatus', state.schools.catalogStatus);
    const payload = await adminRequest(`/api/admin/universities?${query}`);
    state.schools = { ...state.schools, ...paginationOf(payload, state.schools), data: unwrapList(payload), loading: false };
  } catch (error) {
    state.schools.loading = false;
    handleAdminError(error);
  }
  render();
}

async function loadUsers({ page = state.users.page } = {}) {
  state.users.loading = true;
  render();
  try {
    const query = new URLSearchParams({ page: String(Math.max(1, page)), pageSize: String(PAGE_SIZE) });
    if (state.users.keyword) query.set('keyword', state.users.keyword);
    if (state.users.role) query.set('role', state.users.role);
    if (state.users.status) query.set('status', state.users.status);
    const payload = await adminRequest(`/api/admin/users?${query}`);
    state.users = { ...state.users, ...paginationOf(payload, state.users), data: unwrapList(payload), loading: false };
  } catch (error) {
    state.users.loading = false;
    handleAdminError(error);
  }
  render();
}

async function loadAgents() {
  const canReadOperations = isSuperAdministrator();
  state.agents.loading = true;
  state.agents.modelSettings = {
    ...state.agents.modelSettings,
    data: canReadOperations ? state.agents.modelSettings.data : null,
    loading: canReadOperations,
    testResult: canReadOperations ? state.agents.modelSettings.testResult : null,
    error: '',
  };
  render();
  try {
    const results = await Promise.allSettled([
      adminRequest('/api/admin/agent-configurations'),
      adminRequest('/api/admin/feature-flags'),
      adminRequest('/api/admin/database/status'),
      canReadOperations
        ? adminRequest(`/api/admin/database-agent/jobs?page=${state.agents.jobs.page}&pageSize=${state.agents.jobs.pageSize}`)
        : Promise.resolve({ page: 1, pageSize: PAGE_SIZE, total: 0, data: [] }),
      canReadOperations
        ? adminRequest(`/api/admin/database-agent/runs?page=${state.agents.runs.page}&pageSize=${state.agents.runs.pageSize}`)
        : Promise.resolve({ page: 1, pageSize: PAGE_SIZE, total: 0, data: [] }),
      canReadOperations
        ? adminRequest(`/api/admin/alerts?page=${state.agents.alerts.page}&pageSize=${state.agents.alerts.pageSize}&status=${encodeURIComponent(state.agents.alerts.status)}`)
        : Promise.resolve({ page: 1, pageSize: PAGE_SIZE, total: 0, data: [] }),
      canReadOperations
        ? adminRequest('/api/admin/agent-model-settings')
        : Promise.resolve(null),
    ]);
    const value = (index, fallback = {}) => results[index].status === 'fulfilled' ? results[index].value : fallback;
    const configPayload = value(0);
    const flagPayload = value(1);
    const databaseStatus = value(2);
    const jobsPayload = value(3);
    const runsPayload = value(4);
    const alertsPayload = value(5);
    const modelPayload = value(6, null);
    const modelFailure = results[6].status === 'rejected' ? results[6].reason : null;
    state.agents = {
      ...state.agents,
      configurations: unwrapList(configPayload, ['configurations', 'data']),
      flags: unwrapList(flagPayload, ['flags', 'data']),
      tables: (databaseStatus.tables || state.agents.tables).filter((table) => table.writable !== false),
      jobs: { ...state.agents.jobs, ...paginationOf(jobsPayload, state.agents.jobs), data: unwrapList(jobsPayload), loading: false },
      runs: { ...state.agents.runs, ...paginationOf(runsPayload, state.agents.runs), data: unwrapList(runsPayload), loading: false },
      alerts: { ...state.agents.alerts, ...paginationOf(alertsPayload, state.agents.alerts), openTotal: number(alertsPayload?.total), data: unwrapList(alertsPayload), loading: false },
      modelSettings: {
        ...state.agents.modelSettings,
        data: modelPayload ? normalizeAgentModelSettings(modelPayload) : state.agents.modelSettings.data,
        loading: false,
        error: modelFailure ? requestErrorMessage(modelFailure) : '',
      },
      loading: false,
    };
    const failure = results.slice(0, 6).find((result) => result.status === 'rejected');
    if (failure) handleAdminError(failure.reason);
    else if (modelFailure instanceof ApiError && modelFailure.status === 401) handleAdminError(modelFailure);
    else state.accessDenied = false;
  } catch (error) {
    state.agents.loading = false;
    handleAdminError(error);
  }
  render();
}

function normalizeAgentModelSettings(payload) {
  const source = payload?.settings || payload?.data || payload || {};
  const environmentFallbackConfigured = payload?.environmentFallbackConfigured === true
    || source.environmentFallbackConfigured === true;
  const credentialMode = ['database', 'environment', 'disabled'].includes(source.credentialMode)
    ? source.credentialMode
    : (['database', 'environment', 'disabled'].includes(source.credentialSource)
      ? source.credentialSource
      : (source.keyConfigured === true ? 'database' : environmentFallbackConfigured ? 'environment' : 'disabled'));
  const storedKeyConfigured = source.keyConfigured === true;
  const credentialSource = ['database', 'environment', 'disabled'].includes(source.credentialSource)
    ? source.credentialSource
    : credentialMode === 'environment'
      ? (environmentFallbackConfigured ? 'environment' : 'disabled')
      : credentialMode === 'database' && storedKeyConfigured ? 'database' : 'disabled';
  const keyConfigured = storedKeyConfigured || credentialSource === 'environment';
  return {
    provider: String(source.provider || ''),
    baseUrl: String(source.baseUrl || ''),
    model: String(source.model || ''),
    keyConfigured,
    keyLastFour: storedKeyConfigured ? String(source.keyLastFour || '').slice(-4) : '',
    credentialMode,
    credentialSource,
    canClearKey: source.canClearKey === true
      || (source.canClearKey === undefined && credentialMode === 'database' && storedKeyConfigured),
    credentialEncryptionConfigured: payload?.credentialEncryptionConfigured !== false
      && source.credentialEncryptionConfigured !== false,
    environmentFallbackConfigured,
    revision: Math.max(0, Math.trunc(number(source.revision))),
    updatedAt: source.updatedAt || null,
  };
}

async function loadAgentModelSettings() {
  if (!isSuperAdministrator()) return;
  state.agents.modelSettings = { ...state.agents.modelSettings, loading: true, error: '' };
  render();
  try {
    const payload = await adminRequest('/api/admin/agent-model-settings');
    state.agents.modelSettings = {
      ...state.agents.modelSettings,
      data: normalizeAgentModelSettings(payload),
      loading: false,
      error: '',
    };
  } catch (error) {
    state.agents.modelSettings = {
      ...state.agents.modelSettings,
      loading: false,
      error: requestErrorMessage(error),
    };
    if (error instanceof ApiError && error.status === 401) handleAdminError(error);
  }
  render();
}

async function loadAgentJobs({ page = state.agents.jobs.page } = {}) {
  if (!isSuperAdministrator()) return;
  state.agents.jobs.loading = true;
  render();
  try {
    const data = state.agents.jobs;
    const payload = await adminRequest(`/api/admin/database-agent/jobs?page=${Math.max(1, page)}&pageSize=${data.pageSize}`);
    state.agents.jobs = { ...data, ...paginationOf(payload, data), data: unwrapList(payload), loading: false };
  } catch (error) {
    state.agents.jobs.loading = false;
    handleAdminError(error);
  }
  render();
}

async function loadAgentRuns({ page = state.agents.runs.page } = {}) {
  if (!isSuperAdministrator()) return;
  state.agents.runs.loading = true;
  render();
  try {
    const data = state.agents.runs;
    const payload = await adminRequest(`/api/admin/database-agent/runs?page=${Math.max(1, page)}&pageSize=${data.pageSize}`);
    state.agents.runs = { ...data, ...paginationOf(payload, data), data: unwrapList(payload), loading: false };
  } catch (error) {
    state.agents.runs.loading = false;
    handleAdminError(error);
  }
  render();
}

async function loadAgentAlerts({ page = state.agents.alerts.page, status = state.agents.alerts.status } = {}) {
  if (!isSuperAdministrator()) return;
  state.agents.alerts.loading = true;
  state.agents.alerts.status = status;
  render();
  try {
    const data = state.agents.alerts;
    const query = new URLSearchParams({ page: String(Math.max(1, page)), pageSize: String(data.pageSize) });
    if (status) query.set('status', status);
    const payload = await adminRequest(`/api/admin/alerts?${query}`);
    state.agents.alerts = { ...data, ...paginationOf(payload, data), openTotal: status === 'open' ? number(payload?.total) : data.openTotal, status, data: unwrapList(payload), loading: false };
  } catch (error) {
    state.agents.alerts.loading = false;
    handleAdminError(error);
  }
  render();
}

async function loadQuality({ page = state.quality.page } = {}) {
  state.quality.loading = true;
  render();
  try {
    const payload = await adminRequest(`/api/admin/catalog/issues?page=${Math.max(1, page)}&pageSize=${PAGE_SIZE}`);
    state.quality = { ...state.quality, ...paginationOf(payload, state.quality), issues: unwrapList(payload, ['issues', 'data']), loading: false };
  } catch (error) {
    state.quality.loading = false;
    handleAdminError(error);
  }
  render();
}

async function loadAudit({ page = state.audit.page } = {}) {
  state.audit.loading = true;
  render();
  try {
    const payload = await adminRequest(`/api/admin/audit?page=${Math.max(1, page)}&pageSize=${PAGE_SIZE}`);
    state.audit = { ...state.audit, ...paginationOf(payload, state.audit), data: unwrapList(payload), loading: false };
  } catch (error) {
    state.audit.loading = false;
    handleAdminError(error);
  }
  render();
}

async function loadAccessLogs({ page = state.audit.access.page } = {}) {
  if (!isSuperAdministrator()) return;
  state.audit.access.loading = true;
  render();
  try {
    const data = state.audit.access;
    const payload = await adminRequest(`/api/admin/access-logs?page=${Math.max(1, page)}&pageSize=${data.pageSize}`);
    state.audit.access = { ...data, ...paginationOf(payload, data), data: unwrapList(payload), loading: false };
  } catch (error) {
    state.audit.access.loading = false;
    handleAdminError(error);
  }
  render();
}

async function loadActiveSection() {
  if (state.accessDenied) return;
  switch (state.section) {
    case 'database': return loadDatabase();
    case 'schools': return loadSchools({ page: state.schools.page });
    case 'users': return loadUsers({ page: state.users.page });
    case 'agents': return loadAgents();
    case 'quality': return loadQuality({ page: state.quality.page });
    case 'audit': return state.audit.tab === 'access'
      ? loadAccessLogs({ page: state.audit.access.page })
      : loadAudit({ page: state.audit.page });
    default: return loadDashboard();
  }
}

function handleAdminError(error) {
  if (error instanceof ApiError && error.status === 401) {
    state.user = getAuthenticatedUser();
    state.accessDenied = false;
    state.agents.modelSettings = { ...state.agents.modelSettings, data: null, testResult: null, error: '' };
    render();
    return;
  }
  if (error instanceof ApiError && error.status === 403) {
    state.accessDenied = true;
    return;
  }
  showToast(requestErrorMessage(error), { error: true });
}

async function handleLogin(form) {
  const fields = new FormData(form);
  const errorNode = document.getElementById('adminLoginError');
  const button = form.querySelector('button[type="submit"]');
  if (errorNode) errorNode.textContent = '';
  if (button) button.disabled = true;
  try {
    await login({ username: fields.get('username'), password: fields.get('password') });
    state.user = getAuthenticatedUser();
    state.accessDenied = false;
    render();
    await loadDashboard();
  } catch (error) {
    if (errorNode) errorNode.textContent = requestErrorMessage(error);
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveSchool(form) {
  const fields = new FormData(form);
  const id = number(form.dataset.id);
  const body = {
    name: String(fields.get('name') || '').trim(),
    province: String(fields.get('province') || '').trim(),
    city: String(fields.get('city') || '').trim(),
    zone: String(fields.get('zone') || 'A'),
    level: String(fields.get('level') || '双非'),
    type: String(fields.get('type') || '综合').trim(),
    institutionCode: String(fields.get('institutionCode') || '').trim(),
    verificationStatus: String(fields.get('verificationStatus') || 'pending'),
    catalogStatus: String(fields.get('catalogStatus') || 'active'),
    detail: {
      address: String(fields.get('address') || '').trim(),
      website: String(fields.get('website') || '').trim(),
      phone: String(fields.get('phone') || '').trim(),
      englishName: String(fields.get('englishName') || '').trim(),
      description: String(fields.get('description') || '').trim(),
      features: String(fields.get('features') || '').trim(),
    },
  };
  if (!body.name || !body.province) return showToast('请填写院校名称和省份', { error: true });
  try {
    await adminRequest(id ? `/api/admin/universities/${id}` : '/api/admin/universities', { method: id ? 'PATCH' : 'POST', body });
    state.modal = null;
    showToast(id ? '院校资料已更新' : '院校已创建');
    await loadSchools({ page: state.schools.page });
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function editSchool(id) {
  const known = state.schools.data.find((school) => number(school.id) === id);
  try {
    const school = await adminRequest(`/api/admin/universities/${id}`);
    state.modal = { type: 'school', school: school?.data || school || known || {} };
  } catch (error) {
    state.modal = { type: 'school', school: known || {} };
    showToast(`未能读取完整资料：${requestErrorMessage(error)}`, { error: true });
  }
  render();
}

async function deleteSchool(id) {
  const school = state.schools.data.find((item) => number(item.id) === id);
  if (!window.confirm(`确认归档“${school?.name || '该院校'}”？归档后不会在用户端资料中展示，历史关联数据会保留。`)) return;
  try {
    await adminRequest(`/api/admin/universities/${id}`, { method: 'DELETE' });
    showToast('院校已归档');
    await loadSchools({ page: state.schools.page });
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function restoreSchool(id) {
  const school = state.schools.data.find((item) => number(item.id) === id);
  if (!window.confirm(`确认恢复“${school?.name || '该院校'}”？关联的基础资料会重新在用户端可见。`)) return;
  try {
    await adminRequest(`/api/admin/universities/${id}`, { method: 'PATCH', body: { catalogStatus: 'active' } });
    showToast('院校资料已恢复');
    await loadSchools({ page: state.schools.page });
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

function openDatabaseRowModal(mode, index = -1) {
  const table = state.database.selectedTable;
  const pk = databasePrimaryKey();
  if (!table || !state.database.schema || state.database.schema.writeBlocked) return;
  const row = mode === 'edit' ? state.database.rows[index] || {} : {};
  state.modal = {
    type: 'database-row',
    mode: mode === 'edit' ? 'edit' : 'create',
    table,
    id: mode === 'edit' && pk ? row[pk] : '',
    row,
  };
  render();
}

function collectDatabaseRow(form) {
  const fields = new FormData(form);
  return Object.fromEntries([...fields.entries()].map(([key, value]) => [key, String(value)]));
}

async function saveDatabaseRow(form) {
  const table = form.dataset.table || state.database.selectedTable;
  const id = form.dataset.id;
  const creating = form.dataset.mode === 'create';
  const row = collectDatabaseRow(form);
  try {
    await adminRequest(
      creating
        ? `/api/admin/database/tables/${encodeURIComponent(table)}/rows`
        : `/api/admin/database/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(id)}`,
      { method: creating ? 'POST' : 'PATCH', body: { row } },
    );
    state.modal = null;
    showToast(creating ? '数据库记录已创建' : '数据库记录已保存');
    await loadDatabaseTable({ table, page: state.database.page });
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function deleteDatabaseRow(index) {
  const table = state.database.selectedTable;
  const pk = databasePrimaryKey();
  const row = state.database.rows[index];
  if (!table || !pk || !row) return;
  const id = row[pk];
  if (!window.confirm(`确认删除 ${table} 中 ${pk}=${id} 的记录？`)) return;
  try {
    await adminRequest(`/api/admin/database/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('数据库记录已删除');
    await loadDatabaseTable({ table, page: state.database.page });
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function readFileContent(file, format) {
  if (['xlsx', 'db'].includes(format)) {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return { contentBase64: window.btoa(binary) };
  }
  return { content: await file.text() };
}

async function exportDatabaseTable(form = null) {
  const fields = form ? new FormData(form) : null;
  const table = String(fields?.get('table') || state.database.selectedTable || '').trim();
  if (!table) return;
  const format = String(fields?.get('format') || 'xlsx');
  const query = new URLSearchParams({ format, limit: '20000' });
  if (table === state.database.selectedTable) {
    if (state.database.keyword) query.set('keyword', state.database.keyword);
    if (state.database.orderBy) query.set('orderBy', state.database.orderBy);
    if (state.database.orderDir) query.set('orderDir', state.database.orderDir);
  }
  try {
    const response = await fetch(`${API_BASE}/api/admin/database/tables/${encodeURIComponent(table)}/export?${query}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new ApiError(payload.error || `导出失败（${response.status}）`, response.status, payload);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || `${table}.${format}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    state.modal = null;
    showToast('导出文件已生成');
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function importDatabaseTable(form = null) {
  const fields = form ? new FormData(form) : null;
  const table = String(fields?.get('table') || state.database.selectedTable || '').trim();
  const file = fields?.get('file') instanceof File && fields.get('file').name ? fields.get('file') : null;
  if (!table || !file) return showToast('请选择要导入的文件', { error: true });
  const format = String(fields?.get('format') || 'csv');
  const dryRun = true;
  const mode = String(fields?.get('mode') || 'insert');
  try {
    const body = {
      format,
      mode,
      dryRun,
      ...(await readFileContent(file, format)),
    };
    const sourceTable = String(fields?.get('sourceTable') || '').trim();
    if (format === 'db' && sourceTable) body.sourceTable = sourceTable;
    const result = await adminRequest(`/api/admin/database/tables/${encodeURIComponent(table)}/import`, { method: 'POST', body });
    state.database.importResult = result;
    state.modal = null;
    showToast('兼容导入预览已生成；请到 Agent 工作台确认入库');
    if (table !== state.database.selectedTable) await loadDatabaseTable({ table, page: 1 });
    else render();
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

function rememberAgentJob(job) {
  if (!job?.id) return;
  const jobs = state.agents.jobs;
  const existing = jobs.data.some((item) => number(item.id) === number(job.id));
  state.agents.currentJob = job;
  state.agents.jobs = {
    ...jobs,
    total: existing ? jobs.total : jobs.total + 1,
    data: existing
      ? jobs.data.map((item) => number(item.id) === number(job.id) ? job : item)
      : [job, ...jobs.data].slice(0, jobs.pageSize),
  };
  if (state.modal?.type === 'agent-job' && number(state.modal.job?.id) === number(job.id)) state.modal.job = job;
}

function findAgentJob(id) {
  const jobId = number(id);
  if (number(state.agents.currentJob?.id) === jobId) return state.agents.currentJob;
  if (number(state.modal?.job?.id) === jobId) return state.modal.job;
  return state.agents.jobs.data.find((item) => number(item.id) === jobId) || null;
}

async function createDatabaseAgentReview(form) {
  if (!isSuperAdministrator()) return showToast('只有超级管理员可以发起入库审核', { error: true });
  const fields = new FormData(form);
  const table = String(fields.get('table') || '').trim();
  const instruction = String(fields.get('instruction') || '').trim();
  const mode = String(fields.get('mode') || 'insert');
  const format = String(fields.get('format') || 'csv');
  const sourceType = String(fields.get('sourceType') || 'text') === 'voice' ? 'voice' : 'text';
  const fileValue = fields.get('file');
  const file = fileValue instanceof File && fileValue.name ? fileValue : null;
  if (!table) return showToast('请填写目标数据表', { error: true });
  if (!instruction && !file) return showToast('请口述、输入处理要求或选择数据文件', { error: true });
  state.agents.draft = { instruction, table, mode, format, sourceType };
  state.agents.submitting = true;
  stopAgentDictation();
  render();
  try {
    const body = {
      table,
      sourceType: file ? 'file' : sourceType,
      mode,
      ...(instruction ? { instruction } : {}),
    };
    if (file) {
      body.sourceName = file.name;
      body.format = format;
      Object.assign(body, await readFileContent(file, format));
      const sourceTable = String(fields.get('sourceTable') || '').trim();
      if (format === 'db' && sourceTable) body.sourceTable = sourceTable;
    }
    const payload = await adminRequest('/api/admin/database-agent/reviews', { method: 'POST', body });
    if (!payload?.job) throw new Error('服务器未返回审核任务');
    state.agents.submitting = false;
    state.agents.draft = { instruction: '', table, mode, format, sourceType: 'text' };
    rememberAgentJob(payload.job);
    showToast('Agent 审核预览已生成');
    await loadAgentJobs({ page: 1 });
  } catch (error) {
    state.agents.submitting = false;
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function applyAgentJob(id) {
  const job = findAgentJob(id);
  if (!job || !agentJobCanApply(job)) return;
  if (!window.confirm(`确认将审核任务 #${job.id} 的 ${number(job.rowCount)} 行建议写入 ${job.targetTable || '目标数据表'}？`)) return;
  try {
    const payload = await adminRequest(`/api/admin/database-agent/jobs/${encodeURIComponent(job.id)}/apply`, {
      method: 'POST',
      body: { checksum: job.checksum, rowCount: number(job.rowCount) },
    });
    if (payload?.job) rememberAgentJob(payload.job);
    showToast(`任务已入库${payload?.job?.affectedRows !== undefined ? `，影响 ${number(payload.job.affectedRows)} 行` : ''}`);
    await loadAgentJobs({ page: state.agents.jobs.page });
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
    await loadAgentJobs({ page: state.agents.jobs.page });
  }
}

async function downloadAgentJob(id) {
  const job = findAgentJob(id);
  if (!job || !isSuperAdministrator()) return;
  try {
    const payload = await adminRequest(`/api/admin/database-agent/jobs/${encodeURIComponent(job.id)}/export`);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `database-agent-job-${job.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('完整暂存数据已下载，请核对行数与校验和');
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function rejectAgentJob(id) {
  const job = findAgentJob(id);
  if (!job || !agentJobCanReject(job)) return;
  if (!window.confirm(`确认驳回审核任务 #${job.id}？该任务不会写入数据库。`)) return;
  try {
    const payload = await adminRequest(`/api/admin/database-agent/jobs/${encodeURIComponent(job.id)}/reject`, { method: 'POST' });
    if (payload?.job) rememberAgentJob(payload.job);
    showToast('审核任务已驳回');
    await loadAgentJobs({ page: state.agents.jobs.page });
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function setAgentAlertStatus(id, status) {
  try {
    const payload = await adminRequest(`/api/admin/alerts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
    if (payload?.alert) {
      state.agents.alerts.data = state.agents.alerts.data.map((item) => number(item.id) === number(id) ? payload.alert : item);
    }
    showToast(status === 'resolved' ? '告警已解决' : status === 'acknowledged' ? '告警已确认' : '告警已重新打开');
    await loadAgentAlerts({ page: 1, status: state.agents.alerts.status });
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

function updateAgentSpeechUi(active, message = '') {
  state.agents.dictating = active;
  const button = root.querySelector('[data-action="toggle-agent-dictation"]');
  const label = button?.querySelector('[data-speech-button-label]');
  const status = root.querySelector('#agentSpeechStatus');
  if (button) {
    button.classList.toggle('is-recording', active);
    button.setAttribute('aria-pressed', String(active));
  }
  if (label) label.textContent = active ? '停止口述' : '开始口述';
  if (status && message) status.textContent = message;
}

function stopAgentDictation(message = '') {
  const recognition = activeSpeechRecognition;
  activeSpeechRecognition = null;
  if (recognition) {
    recognition.onend = null;
    try { recognition.stop(); } catch { /* Recognition may already be stopped. */ }
  }
  updateAgentSpeechUi(false, message);
}

function toggleAgentDictation() {
  if (activeSpeechRecognition) return stopAgentDictation('口述已停止，可继续编辑后生成审核预览。');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const input = root.querySelector('#agentInstruction');
  if (!Recognition || !input) return updateAgentSpeechUi(false, '当前浏览器无法使用语音输入。');
  const recognition = new Recognition();
  const prefix = input.value.trim();
  let committed = '';
  recognition.lang = 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = String(event.results[index][0]?.transcript || '').trim();
      if (event.results[index].isFinal) committed += `${transcript}。`;
      else interim += transcript;
    }
    input.value = [prefix, committed, interim].filter(Boolean).join(prefix ? '\n' : '');
    state.agents.draft.instruction = input.value;
    if (committed || interim) {
      state.agents.draft.sourceType = 'voice';
      const sourceType = root.querySelector('#databaseAgentReviewForm [name="sourceType"]');
      if (sourceType) sourceType.value = 'voice';
    }
  };
  recognition.onerror = (event) => {
    activeSpeechRecognition = null;
    const message = event.error === 'not-allowed'
      ? '麦克风权限被拒绝，请在浏览器设置中允许后重试。'
      : event.error === 'no-speech' ? '未检测到语音，请靠近麦克风后重试。' : `语音输入已停止：${event.error || '未知错误'}`;
    updateAgentSpeechUi(false, message);
  };
  recognition.onend = () => {
    activeSpeechRecognition = null;
    updateAgentSpeechUi(false, '口述已转成文字，可继续编辑后生成审核预览。');
  };
  activeSpeechRecognition = recognition;
  try {
    recognition.start();
    updateAgentSpeechUi(true, '正在聆听…点击“停止口述”完成输入。');
  } catch (error) {
    activeSpeechRecognition = null;
    updateAgentSpeechUi(false, `无法启动语音输入：${error.message || '未知错误'}`);
  }
}

async function patchUser(id, body) {
  try {
    await adminRequest(`/api/admin/users/${id}`, { method: 'PATCH', body });
    showToast('用户权限已更新');
    await loadUsers({ page: state.users.page });
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

function findUnsafeAgentSettingPath(value, path = []) {
  if (!value || typeof value !== 'object') return '';
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (/(?:url|endpoint|tool|sql|prompt|instruction|command|script)/iu.test(key)) return nextPath.join('.');
    const nested = findUnsafeAgentSettingPath(child, nextPath);
    if (nested) return nested;
  }
  return '';
}

async function saveAgentConfig(key) {
  const input = [...root.querySelectorAll('[data-config-settings]')]
    .find((node) => node.dataset.configSettings === key);
  if (!input) return;
  let settings;
  try {
    settings = JSON.parse(input.value || '{}');
  } catch {
    showToast('策略设置必须是有效的 JSON 对象', { error: true });
    return;
  }
  if (!settings || Array.isArray(settings) || typeof settings !== 'object') {
    showToast('策略设置必须是 JSON 对象', { error: true });
    return;
  }
  if (key === 'database-manager'
    && (settings.writeAccess !== false || settings.requiresHumanConfirmation !== true)) {
    showToast('安全边界不能修改：必须保持人工确认且禁止模型直接写库', { error: true });
    return;
  }
  const unsafePath = key === 'database-manager' ? findUnsafeAgentSettingPath(settings) : '';
  if (unsafePath) {
    showToast(`高级策略不能定义地址、工具、SQL、提示词或命令：${unsafePath}`, { error: true });
    return;
  }
  try {
    await adminRequest(`/api/admin/agent-configurations/${encodeURIComponent(key)}`, { method: 'PATCH', body: { settings } });
    showToast('智能体配置已保存');
    await loadAgents();
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function saveAgentModelSettings(form) {
  if (!isSuperAdministrator() || state.agents.modelSettings.loading
    || state.agents.modelSettings.saving || state.agents.modelSettings.testing) return;
  const fields = new FormData(form);
  const provider = String(fields.get('provider') || '').trim();
  const baseUrl = String(fields.get('baseUrl') || '').trim();
  const model = String(fields.get('model') || '').trim();
  const apiKey = String(fields.get('apiKey') || '');
  if (!provider || !baseUrl || !model) {
    showToast('请填写服务商、API 基础地址和模型', { error: true });
    return;
  }
  if (apiKey && (apiKey.length < 8 || apiKey.trim() !== apiKey || /\s/u.test(apiKey))) {
    showToast('API Key 不能包含空白字符，且至少需要 8 个字符', { error: true });
    return;
  }
  const currentSettings = state.agents.modelSettings.data;
  if (apiKey && currentSettings?.credentialEncryptionConfigured === false) {
    showToast('服务器尚未配置凭据加密主密钥，暂时不能保存 API Key', { error: true });
    return;
  }
  const settingsChanged = currentSettings
    && (provider !== currentSettings.provider || baseUrl !== currentSettings.baseUrl || model !== currentSettings.model);
  if (!apiKey && !settingsChanged) {
    showToast('模型配置没有变化');
    return;
  }
  if (!apiKey && settingsChanged && currentSettings.credentialMode !== 'database') {
    showToast('环境或禁用凭据模式下，修改模型配置必须输入 API Key 并切换为数据库加密凭据', { error: true });
    return;
  }
  const endpointChanged = currentSettings
    && (provider !== currentSettings.provider || baseUrl !== currentSettings.baseUrl);
  if (!apiKey && endpointChanged && currentSettings.credentialMode === 'database' && currentSettings.keyConfigured) {
    showToast('修改服务商或 API 地址时必须重新输入 API Key', { error: true });
    return;
  }
  const replaceMessage = currentSettings?.credentialSource === 'environment'
    ? '确认保存新的模型 API Key？保存后将从服务器环境变量切换为数据库加密凭据。'
    : '确认替换当前模型 API Key？保存后无法从后台读取原密钥。';
  if (apiKey && currentSettings?.keyConfigured && !window.confirm(replaceMessage)) return;
  const body = {
    provider,
    baseUrl,
    model,
    credentialMode: apiKey ? 'database' : currentSettings.credentialMode,
    expectedRevision: number(currentSettings?.revision),
  };
  if (apiKey) {
    body.apiKey = apiKey;
  }
  state.agents.modelSettings = { ...state.agents.modelSettings, saving: true, testResult: null, error: '' };
  render();
  try {
    await adminRequest('/api/admin/agent-model-settings', { method: 'PATCH', body });
    state.agents.modelSettings.saving = false;
    showToast(apiKey ? '模型配置和新密钥已保存' : '模型配置已保存，原密钥保持不变');
    await loadAgentModelSettings();
  } catch (error) {
    state.agents.modelSettings = { ...state.agents.modelSettings, saving: false };
    showToast(requestErrorMessage(error), { error: true });
    if (error instanceof ApiError && error.status === 409) await loadAgentModelSettings();
  }
}

async function clearAgentApiKey() {
  if (!isSuperAdministrator() || !state.agents.modelSettings.data?.keyConfigured
    || state.agents.modelSettings.loading || state.agents.modelSettings.saving || state.agents.modelSettings.testing
    || state.agents.modelSettings.data?.credentialMode !== 'database'
    || !state.agents.modelSettings.data?.canClearKey) return;
  if (!window.confirm('确认清除数据库保存的模型 API Key？清除后此配置会进入凭据禁用状态，Agent 模型调用将停止，且无法恢复原密钥。')) return;
  const settings = state.agents.modelSettings.data;
  state.agents.modelSettings = { ...state.agents.modelSettings, saving: true, testResult: null, error: '' };
  render();
  try {
    await adminRequest('/api/admin/agent-model-settings', {
      method: 'PATCH',
      body: {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        clearApiKey: true,
        credentialMode: 'disabled',
        expectedRevision: number(settings.revision),
      },
    });
    state.agents.modelSettings.saving = false;
    showToast('数据库模型 API Key 已清除，正在重新读取生效来源');
    await loadAgentModelSettings();
  } catch (error) {
    state.agents.modelSettings = { ...state.agents.modelSettings, saving: false };
    showToast(requestErrorMessage(error), { error: true });
    if (error instanceof ApiError && error.status === 409) await loadAgentModelSettings();
  }
}

async function testAgentModelConnection() {
  if (!isSuperAdministrator() || !state.agents.modelSettings.data?.keyConfigured
    || state.agents.modelSettings.loading || state.agents.modelSettings.saving || state.agents.modelSettings.testing) return;
  state.agents.modelSettings = { ...state.agents.modelSettings, testing: true, testResult: null, error: '' };
  render();
  try {
    const payload = await adminRequest('/api/admin/agent-model-settings/test', { method: 'POST' });
    const result = payload?.result || payload || {};
    state.agents.modelSettings = {
      ...state.agents.modelSettings,
      testing: false,
      testResult: {
        ok: result.ok === true,
        provider: String(result.provider || ''),
        model: String(result.model || ''),
        durationMs: number(result.durationMs ?? result.latencyMs),
        errorCode: String(result.errorCode || ''),
      },
    };
    showToast(result.ok === true ? '模型连接测试通过' : '模型连接测试失败', { error: result.ok !== true });
  } catch (error) {
    state.agents.modelSettings = {
      ...state.agents.modelSettings,
      testing: false,
      testResult: {
        ok: false,
        provider: state.agents.modelSettings.data?.provider || '',
        model: state.agents.modelSettings.data?.model || '',
        durationMs: 0,
        errorCode: String(error?.code || (error?.status ? `HTTP_${error.status}` : 'REQUEST_FAILED')),
      },
    };
    showToast('模型连接测试失败', { error: true });
  }
}

async function setAgentConfiguration(key, enabled) {
  try {
    await adminRequest(`/api/admin/agent-configurations/${encodeURIComponent(key)}`, { method: 'PATCH', body: { enabled } });
    showToast(enabled ? '智能体已启用' : '智能体已停用');
    await loadAgents();
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function setFlag(key, enabled) {
  try {
    await adminRequest(`/api/admin/feature-flags/${encodeURIComponent(key)}`, { method: 'PATCH', body: { enabled } });
    showToast(enabled ? '功能已启用' : '功能已关闭');
    await loadAgents();
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function saveFlagRollout(key) {
  if (!isSuperAdministrator()) return;
  const input = [...root.querySelectorAll('[data-flag-rollout]')]
    .find((node) => node.dataset.flagRollout === key);
  const rolloutPercentage = Number(input?.value);
  if (!Number.isInteger(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100) {
    showToast('发布比例必须是 0–100 的整数', { error: true });
    return;
  }
  try {
    await adminRequest(`/api/admin/feature-flags/${encodeURIComponent(key)}`, { method: 'PATCH', body: { rolloutPercentage } });
    showToast(`发布比例已调整为 ${rolloutPercentage}%`);
    await loadAgents();
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

async function resolveIssue(id) {
  try {
    await adminRequest(`/api/admin/catalog/issues/${id}`, { method: 'PATCH', body: { status: 'resolved' } });
    showToast('问题已标记为已处理');
    await loadQuality({ page: state.quality.page });
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
  }
}

function setSection(next) {
  if (!NAV_ITEMS.some((item) => item.id === next)) return;
  if (state.section === 'agents' && next !== 'agents') stopAgentDictation();
  state.section = next;
  state.menuOpen = false;
  render();
  void loadActiveSection();
}

function render() {
  if (activeSpeechRecognition) stopAgentDictation();
  if (!state.user) renderLogin();
  else renderShell();
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.id === 'adminLoginForm') { event.preventDefault(); void handleLogin(form); }
  if (form.id === 'agentModelSettingsForm') { event.preventDefault(); void saveAgentModelSettings(form); }
  if (form.id === 'schoolForm') { event.preventDefault(); void saveSchool(form); }
  if (form.id === 'dbRowForm') { event.preventDefault(); void saveDatabaseRow(form); }
  if (form.id === 'dbImportForm') { event.preventDefault(); void importDatabaseTable(form); }
  if (form.id === 'dbExportForm') { event.preventDefault(); void exportDatabaseTable(form); }
  if (form.id === 'databaseAgentReviewForm') { event.preventDefault(); void createDatabaseAgentReview(form); }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'agentInstruction') state.agents.draft.instruction = event.target.value;
  if (event.target.id === 'agentTargetTable') state.agents.draft.table = event.target.value;
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'agentImportMode') state.agents.draft.mode = event.target.value;
  if (event.target.id === 'agentFileFormat') {
    state.agents.draft.format = event.target.value;
    const sourceTable = root.querySelector('[data-agent-source-table]');
    if (sourceTable) sourceTable.hidden = event.target.value !== 'db';
  }
  if (event.target.id === 'databaseAgentFile') {
    const extension = String(event.target.files?.[0]?.name || '').split('.').pop().toLowerCase();
    const normalized = extension === 'tsv' ? 'txt' : extension;
    const format = DB_IMPORT_FORMATS.includes(normalized) ? normalized : '';
    const select = root.querySelector('#agentFileFormat');
    if (format && select) {
      select.value = format;
      state.agents.draft.format = format;
      const sourceTable = root.querySelector('[data-agent-source-table]');
      if (sourceTable) sourceTable.hidden = format !== 'db';
    }
  }
});

document.addEventListener('click', (event) => {
  const section = event.target.closest('[data-section]');
  if (section) { setSection(section.dataset.section); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.classList.contains('admin-modal-backdrop') && event.target !== button) return;
  const { action } = button.dataset;
  if (action === 'toggle-menu') { state.menuOpen = !state.menuOpen; render(); return; }
  if (action === 'logout') {
    void logout().finally(() => {
      state.user = null;
      state.accessDenied = false;
      state.agents.modelSettings = { ...state.agents.modelSettings, data: null, testResult: null, error: '' };
      render();
    });
    return;
  }
  if (action === 'refresh') { void loadActiveSection(); return; }
  if (action === 'open-agent-workbench') { state.agents.tab = 'workbench'; render(); return; }
  if (action === 'agent-tab') {
    stopAgentDictation();
    state.agents.tab = button.dataset.tab || 'workbench';
    render();
    return;
  }
  if (action === 'toggle-agent-dictation') { toggleAgentDictation(); return; }
  if (action === 'view-agent-job') {
    const job = findAgentJob(button.dataset.id);
    if (job) { state.modal = { type: 'agent-job', job }; render(); }
    return;
  }
  if (action === 'download-agent-job') { void downloadAgentJob(button.dataset.id); return; }
  if (action === 'apply-agent-job') { void applyAgentJob(button.dataset.id); return; }
  if (action === 'reject-agent-job') { void rejectAgentJob(button.dataset.id); return; }
  if (action === 'refresh-agent-jobs') { void loadAgentJobs({ page: state.agents.jobs.page }); return; }
  if (action === 'refresh-agent-runs') { void loadAgentRuns({ page: state.agents.runs.page }); return; }
  if (action === 'refresh-agent-alerts') { void loadAgentAlerts({ page: state.agents.alerts.page }); return; }
  if (action === 'filter-agent-alerts') {
    state.agents.alerts.status = root.querySelector('#agentAlertStatus')?.value || '';
    void loadAgentAlerts({ page: 1, status: state.agents.alerts.status });
    return;
  }
  if (action === 'set-agent-alert-status') { void setAgentAlertStatus(button.dataset.id, button.dataset.status); return; }
  if (action === 'test-agent-model') { void testAgentModelConnection(); return; }
  if (action === 'clear-agent-api-key') { void clearAgentApiKey(); return; }
  if (action === 'audit-tab') {
    state.audit.tab = button.dataset.tab === 'access' ? 'access' : 'operations';
    render();
    if (state.audit.tab === 'access' && !state.audit.access.data.length) void loadAccessLogs({ page: 1 });
    return;
  }
  if (action === 'refresh-database') { void loadDatabase(); return; }
  if (action === 'select-db-table') {
    state.database.keyword = '';
    state.database.orderBy = '';
    state.database.orderDir = 'ASC';
    void loadDatabaseTable({ table: button.dataset.table, page: 1 });
    return;
  }
  if (action === 'refresh-db-table') { void loadDatabaseTable({ table: state.database.selectedTable, page: state.database.page }); return; }
  if (action === 'search-db-table') {
    state.database.keyword = root.querySelector('#dbSearch')?.value?.trim() || '';
    state.database.orderBy = root.querySelector('#dbOrderBy')?.value || '';
    state.database.orderDir = root.querySelector('#dbOrderDir')?.value || 'ASC';
    void loadDatabaseTable({ table: state.database.selectedTable, page: 1 });
    return;
  }
  if (action === 'new-db-row') { openDatabaseRowModal('create'); return; }
  if (action === 'edit-db-row') { openDatabaseRowModal('edit', number(button.dataset.index, -1)); return; }
  if (action === 'delete-db-row') { void deleteDatabaseRow(number(button.dataset.index, -1)); return; }
  if (action === 'open-db-import') { state.modal = { type: 'database-import', table: state.database.selectedTable || chooseDatabaseTable(databaseTables()) }; render(); return; }
  if (action === 'open-db-export') { state.modal = { type: 'database-export', table: state.database.selectedTable }; render(); return; }
  if (action === 'clear-db-import-result') { state.database.importResult = null; render(); return; }
  if (action === 'new-school') { state.modal = { type: 'school', school: { zone: 'A', level: '双非', type: '综合', verificationStatus: 'pending', catalogStatus: 'active' } }; render(); return; }
  if (action === 'close-modal') { state.modal = null; render(); return; }
  if (action === 'search-schools') { state.schools.keyword = root.querySelector('#schoolSearch')?.value?.trim() || ''; state.schools.catalogStatus = root.querySelector('#schoolStatus')?.value || ''; state.schools.page = 1; void loadSchools({ page: 1 }); return; }
  if (action === 'edit-school') { void editSchool(number(button.dataset.id)); return; }
  if (action === 'delete-school') { void deleteSchool(number(button.dataset.id)); return; }
  if (action === 'restore-school') { void restoreSchool(number(button.dataset.id)); return; }
  if (action === 'search-users') {
    state.users.keyword = root.querySelector('#userSearch')?.value?.trim() || '';
    state.users.role = root.querySelector('#userRole')?.value || '';
    state.users.status = root.querySelector('#userStatus')?.value || '';
    state.users.page = 1; void loadUsers({ page: 1 }); return;
  }
  if (action === 'toggle-user-role') { void patchUser(number(button.dataset.id), { role: button.dataset.role === 'admin' ? 'user' : 'admin' }); return; }
  if (action === 'toggle-user-status') { void patchUser(number(button.dataset.id), { status: button.dataset.status === 'active' ? 'disabled' : 'active' }); return; }
  if (action === 'save-config') { void saveAgentConfig(button.dataset.key); return; }
  if (action === 'toggle-agent-config') { void setAgentConfiguration(button.dataset.key, button.dataset.enabled !== 'true'); return; }
  if (action === 'toggle-flag') { void setFlag(button.dataset.key, button.dataset.enabled !== 'true'); return; }
  if (action === 'save-flag-rollout') { void saveFlagRollout(button.dataset.key); return; }
  if (action === 'refresh-quality') { void loadQuality({ page: state.quality.page }); return; }
  if (action === 'resolve-issue') { void resolveIssue(number(button.dataset.id)); return; }
  if (action === 'refresh-audit') { void loadAudit({ page: state.audit.page }); return; }
  if (action === 'refresh-access-logs') { void loadAccessLogs({ page: state.audit.access.page }); return; }
  if (action === 'page') {
    const page = number(button.dataset.page, 1);
    if (page < 1) return;
    if (button.dataset.kind === 'database') void loadDatabaseTable({ table: state.database.selectedTable, page });
    if (button.dataset.kind === 'schools') void loadSchools({ page });
    if (button.dataset.kind === 'users') void loadUsers({ page });
    if (button.dataset.kind === 'quality') void loadQuality({ page });
    if (button.dataset.kind === 'audit') void loadAudit({ page });
    if (button.dataset.kind === 'access-logs') void loadAccessLogs({ page });
    if (button.dataset.kind === 'agent-jobs') void loadAgentJobs({ page });
    if (button.dataset.kind === 'agent-runs') void loadAgentRuns({ page });
    if (button.dataset.kind === 'agent-alerts') void loadAgentAlerts({ page });
  }
}, true);

async function boot() {
  render();
  try {
    await restoreAuthSession();
    state.user = getAuthenticatedUser();
    if (!state.user) return render();
    render();
    await loadDashboard();
  } catch (error) {
    // A 401 clears the session in auth-api. Network failures keep the existing
    // token so the operator can retry instead of losing a working session.
    state.user = getAuthenticatedUser();
    if (state.user) {
      render();
      showToast(requestErrorMessage(error), { error: true });
    } else render();
  }
}

void boot();
