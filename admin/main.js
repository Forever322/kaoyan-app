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
const DB_IMPORT_FORMATS = ['csv', 'txt', 'sql', 'xlsx', 'db'];
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
  { id: 'agents', icon: '✦', label: '智能体管理', subtitle: '配置、开关与运行状态' },
  { id: 'quality', icon: '◈', label: '数据治理', subtitle: '来源、核验与待处理问题' },
  { id: 'audit', icon: '≡', label: '操作审计', subtitle: '后台管理操作记录' },
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
  agents: { configurations: [], flags: [], loading: false },
  quality: { issues: [], total: 0, page: 1, loading: false },
  audit: { data: [], total: 0, page: 1, loading: false },
};

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
  const tone = ['active', 'verified', 'enabled', 'admin'].includes(normalized) || ['正常', '启用', '管理员', '已核验'].includes(text)
    ? 'active'
    : ['pending', 'warning', 'pending_review', '待核验'].includes(normalized) || ['待处理', '待核验'].includes(text)
      ? 'pending'
      : ['disabled', 'blocked', 'suspended', 'danger', '已停用', '禁用'].includes(normalized) || ['已停用', '禁用'].includes(text)
        ? 'disabled'
        : ['user', '普通用户'].includes(normalized) || text === '普通用户'
          ? 'user'
          : 'info';
  return `<span class="admin-badge admin-badge--${tone}">${html(text)}</span>`;
}

function currentNav() {
  return NAV_ITEMS.find((item) => item.id === state.section) || NAV_ITEMS[0];
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
  return state.database.status?.tables || [];
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
    const canWrite = Boolean(hasTable && state.database.schema && !state.database.schema.writeBlocked);
    return `<button class="admin-button admin-button--ghost" data-action="refresh">↻ 刷新数据</button><button class="admin-button admin-button--ghost" data-action="open-db-export" ${hasTable ? '' : 'disabled'}>导出当前表</button><button class="admin-button admin-button--lime" data-action="open-db-import">导入文件</button><button class="admin-button admin-button--ghost" data-action="new-db-row" ${canWrite ? '' : 'disabled'}>新增记录</button>`;
  }
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
  return `<button class="admin-nav-item${item.id === state.section ? ' is-active' : ''}" data-section="${item.id}"><span class="admin-nav-icon">${item.icon}</span><span>${html(item.label)}</span></button>`;
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
  const selected = data.selectedTable || chooseDatabaseTable(tables);
  const columns = databaseColumns();
  const rows = data.rows || [];
  const pk = databasePrimaryKey();
  const canWrite = Boolean(selected && data.schema && !data.schema.writeBlocked);
  return `<section class="admin-section">
    <div class="admin-metrics">
      ${metric('数据表', number(status.totals?.tables).toLocaleString(), `${number(status.migrationCount)} 项迁移已执行`, 'green')}
      ${metric('估算记录', number(status.totals?.estimatedRows).toLocaleString(), '来自 MySQL 表统计信息', 'lime')}
      ${metric('数据容量', formatBytes(status.totals?.dataBytes), `索引 ${formatBytes(status.totals?.indexBytes)}`, 'blue')}
      ${metric('当前表', selected ? tableDisplayName(selected) : '未选择', canWrite ? '可由超级管理员写入' : '受保护或未加载', 'orange')}
    </div>
    ${renderDatabaseCommandBar(selected, canWrite)}
    <div class="admin-db-layout">
      <section class="admin-card admin-db-tables"><header class="admin-card-head"><div><h2>数据库表</h2><p>${html(status.databaseName || '—')} · ${html(isoTime(status.checkedAt))}</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-database">刷新</button></header><div class="admin-db-table-list">${tables.length ? tables.map((table) => `<button class="admin-db-table-item${table.name === selected ? ' is-active' : ''}" data-action="select-db-table" data-table="${html(table.name)}"><span><strong>${html(tableDisplayName(table.name))}</strong><small>${html(table.name)}</small></span><em>${number(table.estimatedRows).toLocaleString()}</em></button>`).join('') : empty('数据库中没有可展示的数据表')}</div></section>
      <section class="admin-card admin-db-workbench">
        <header class="admin-card-head"><div><h2>${selected ? html(tableDisplayName(selected)) : '表数据'}</h2><p>${selected ? `${html(selected)} · ${columns.length} 个字段 · ${number(data.total).toLocaleString()} 行` : '请选择一张数据表'}</p></div><div class="admin-table-actions"><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-db-table" ${selected ? '' : 'disabled'}>刷新表</button><button class="admin-button admin-button--lime admin-button--small" data-action="new-db-row" ${canWrite ? '' : 'disabled'}>新增记录</button></div></header>
        ${renderDatabaseToolbar(selected, columns)}
        ${data.loadingRows && !rows.length ? loading('正在读取表数据…') : renderDatabaseRows(rows, columns, pk)}
        ${renderPagination('database', data)}
      </section>
    </div>
    ${renderDatabaseReviewPanel(data.importResult)}
  </section>`;
}

function renderDatabaseCommandBar(selected, canWrite) {
  return `<section class="admin-card admin-db-command"><div class="admin-db-command-main"><span class="admin-db-command-label">当前目标表</span><strong>${selected ? html(tableDisplayName(selected)) : '未选择数据表'}</strong><small>${selected ? html(selected) : '导入时可以在弹窗内选择目标表'}</small></div><div class="admin-db-command-actions"><button class="admin-db-command-button admin-db-command-button--primary" data-action="open-db-import"><span>导入文件</span><small>TXT / CSV / XLSX / SQL / DB</small></button><button class="admin-db-command-button" data-action="open-db-export" ${selected ? '' : 'disabled'}><span>导出当前表</span><small>CSV / TXT / SQL / XLSX</small></button><button class="admin-db-command-button" data-action="new-db-row" ${canWrite ? '' : 'disabled'}><span>新增记录</span><small>按字段创建一行</small></button></div></section>`;
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
  if (data.loading && !data.configurations.length && !data.flags.length) return `<section class="admin-section">${loading('正在读取智能体配置…')}</section>`;
  const configs = data.configurations || [];
  const flags = data.flags || [];
  return `<section class="admin-section"><div class="admin-grid"><section class="admin-card"><header class="admin-card-head"><div><h2>智能体运行配置</h2><p>仅展示可安全调整的公开配置，不显示模型密钥。</p></div></header><div class="admin-card-body">${configs.length ? `<div class="admin-config-grid">${configs.map(renderConfiguration).join('')}</div>` : empty('暂无可管理的智能体配置')}</div></section><section class="admin-card"><header class="admin-card-head"><div><h2>功能开关</h2><p>关闭后新请求不会进入对应能力。</p></div></header><div class="admin-card-body">${flags.length ? `<div class="admin-issue-list">${flags.map(renderFlag).join('')}</div>` : empty('暂无功能开关')}</div></section></div><section class="admin-card"><header class="admin-card-head"><div><h2>管理原则</h2><p>AI 只能生成建议和待确认提案；模型没有数据库写权限。</p></div></header><div class="admin-card-body"><div class="admin-kpi-list"><div class="admin-kpi-row"><i class="admin-kpi-dot"></i><span class="admin-kpi-copy"><strong>配置安全</strong><small>API 密钥只保留在服务器环境变量中，后台不会读取或回显。</small></span></div><div class="admin-kpi-row"><i class="admin-kpi-dot" style="--dot:#efaa56"></i><span class="admin-kpi-copy"><strong>变更可追溯</strong><small>智能体配置和开关的修改会写入后台审计日志。</small></span></div></div></div></section></section>`;
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
  const protectedConsole = key === 'admin-console';
  const canMutate = state.user?.role === 'super_admin';
  const control = protectedConsole
    ? '<small class="admin-table-note">紧急开关仅允许服务器运维恢复</small>'
    : !canMutate
      ? '<small class="admin-table-note">仅超级管理员可修改全局功能开关</small>'
    : `<button class="admin-button admin-button--ghost admin-button--small" data-action="toggle-flag" data-key="${html(key)}" data-enabled="${enabled}">${enabled ? '关闭功能' : '启用功能'}</button>`;
  return `<article class="admin-issue"><div class="admin-issue-meta"><strong>${html(item.displayName || item.label || key)}</strong>${badge(enabled ? '启用' : '已停用')}</div><p>${html(item.description || '平台功能控制开关')}</p>${control}</article>`;
}

function renderQuality() {
  const data = state.quality;
  const issues = data.issues || [];
  return `<section class="admin-card"><header class="admin-card-head"><div><h2>待处理资料问题</h2><p>导入过程检测到的缺失主表、名称歧义和待核验资料。</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-quality">刷新</button></header><div class="admin-card-body">${data.loading && !issues.length ? loading('正在读取资料问题…') : issues.length ? `<div class="admin-issue-list">${issues.map((issue) => `<article class="admin-issue"><div class="admin-issue-meta"><strong>${html(issue.entityKey ?? issue.entity_key ?? '未知对象')}</strong>${badge(issue.severity ?? 'warning')}</div><p>${html(issue.issueCode ?? issue.issue_code ?? '资料需要人工处理')}</p><div class="admin-issue-meta"><small>${html(isoTime(issue.createdAt ?? issue.created_at))}</small>${String(issue.status || 'open') === 'open' ? `<button class="admin-button admin-button--ghost admin-button--small" data-action="resolve-issue" data-id="${number(issue.id)}">标记已处理</button>` : badge(issue.status)}</div></article>`).join('')}</div>` : empty('没有待处理的数据问题')}</div>${renderPagination('quality', data)}</section>`;
}

function renderAudit() {
  const data = state.audit;
  const rows = data.data || [];
  return `<section class="admin-card"><header class="admin-card-head"><div><h2>后台操作审计</h2><p>记录管理员对用户、院校、智能体和数据治理的关键变更。</p></div><button class="admin-button admin-button--ghost admin-button--small" data-action="refresh-audit">刷新</button></header>${data.loading && !rows.length ? loading('正在读取审计记录…') : rows.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>对象</th><th>说明</th></tr></thead><tbody>${rows.map((entry) => `<tr><td>${html(isoTime(entry.createdAt ?? entry.created_at))}</td><td>${html(auditActorName(entry))}</td><td>${html(entry.actionLabel ?? entry.action ?? entry.operation ?? '更新')}</td><td>${html(auditResourceName(entry))}</td><td>${html(auditSummary(entry))}</td></tr>`).join('')}</tbody></table></div>` : empty('暂无后台操作记录')}${renderPagination('audit', data)}</section>`;
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
  if (state.modal.type !== 'school') return '';
  const school = state.modal.school || {};
  const detail = school.detail || {};
  const isEdit = Boolean(school.id);
  return `<div class="admin-modal-backdrop" data-action="close-modal"><section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="schoolModalTitle" onclick="event.stopPropagation()"><header class="admin-modal-head"><h2 id="schoolModalTitle">${isEdit ? '编辑院校资料' : '新增院校'}</h2><button class="admin-modal-close" data-action="close-modal">关闭</button></header><div class="admin-modal-body"><form id="schoolForm" class="admin-modal-form" data-id="${number(school.id)}"><div class="admin-field admin-field--wide"><label>院校名称 *</label><input name="name" required maxlength="191" value="${html(school.name)}" /></div><div class="admin-field"><label>省份 *</label><input name="province" required maxlength="64" value="${html(school.province)}" /></div><div class="admin-field"><label>城市</label><input name="city" maxlength="64" value="${html(school.city)}" /></div><div class="admin-field"><label>分区 *</label><select name="zone"><option value="A" ${school.zone !== 'B' ? 'selected' : ''}>A 区</option><option value="B" ${school.zone === 'B' ? 'selected' : ''}>B 区</option></select></div><div class="admin-field"><label>院校层次 *</label><select name="level">${['985', '211', '双一流', '双非'].map((value) => `<option value="${value}" ${school.level === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="admin-field"><label>院校类型</label><input name="type" maxlength="64" value="${html(school.type || '综合')}" /></div><div class="admin-field"><label>院校代码</label><input name="institutionCode" maxlength="64" value="${html(school.institutionCode ?? school.institution_code ?? '')}" /></div><div class="admin-field"><label>核验状态</label><select name="verificationStatus">${['pending', 'verified', 'unverified', 'needs_review', 'rejected'].map((value) => `<option value="${value}" ${(school.verificationStatus ?? school.verification_status ?? 'pending') === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="admin-field"><label>资料状态</label><select name="catalogStatus">${['active', 'archived'].map((value) => `<option value="${value}" ${(school.catalogStatus ?? school.catalog_status ?? 'active') === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="admin-field admin-field--wide"><label>院校地址</label><input name="address" maxlength="500" value="${html(detail.address || school.address || '')}" /></div><div class="admin-field admin-field--wide"><label>官网</label><input name="website" maxlength="500" value="${html(detail.website || school.website || '')}" /></div><div class="admin-field"><label>咨询电话</label><input name="phone" maxlength="128" value="${html(detail.phone || school.phone || '')}" /></div><div class="admin-field"><label>英文名称</label><input name="englishName" maxlength="191" value="${html(detail.englishName ?? detail.english_name ?? '')}" /></div><div class="admin-field admin-field--wide"><label>院校简介</label><textarea name="description">${html(detail.description || '')}</textarea></div><div class="admin-field admin-field--wide"><label>特色说明</label><textarea name="features">${html(detail.features || '')}</textarea></div><div class="admin-modal-footer admin-field--wide"><button type="button" class="admin-button admin-button--ghost" data-action="close-modal">取消</button><button type="submit" class="admin-button admin-button--lime">${isEdit ? '保存修改' : '创建院校'}</button></div></form></div></section></div>`;
}

function renderDatabaseTableOptions(selected = state.database.selectedTable) {
  const tables = databaseTables();
  return tables.map((table) => `<option value="${html(table.name)}" ${table.name === selected ? 'selected' : ''}>${html(tableDisplayName(table.name))} · ${html(table.name)}</option>`).join('');
}

function renderDatabaseImportModal() {
  const selected = state.modal?.table || state.database.selectedTable || chooseDatabaseTable(databaseTables());
  return `<div class="admin-modal-backdrop" data-action="close-modal"><section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="dbImportModalTitle" onclick="event.stopPropagation()"><header class="admin-modal-head"><h2 id="dbImportModalTitle">导入数据库文件</h2><button class="admin-modal-close" data-action="close-modal">关闭</button></header><div class="admin-modal-body"><form id="dbImportForm" class="admin-form"><div class="admin-field"><label>目标表</label><select name="table" required>${renderDatabaseTableOptions(selected)}</select></div><div class="admin-field"><label>文件格式</label><select name="format">${DB_IMPORT_FORMATS.map((format) => `<option value="${format}" ${format === 'txt' ? 'selected' : ''}>${databaseFormatLabel(format)}${format === 'txt' ? '（TAB）' : ''}</option>`).join('')}</select></div><div class="admin-field"><label>导入模式</label><select name="mode"><option value="insert">插入</option><option value="upsert">按主键更新</option></select></div><div class="admin-field"><label>写入方式</label><label class="admin-check admin-check--field"><input name="dryRun" type="checkbox" checked />先预览</label></div><div class="admin-field admin-field--wide"><label>选择文件</label><input class="admin-file admin-file--wide" name="file" type="file" accept=".csv,.txt,.tsv,.sql,.xlsx,.db" required /></div><div class="admin-field admin-field--wide"><label>DB 源表名</label><input name="sourceTable" value="${html(selected || '')}" maxlength="64" /></div><div class="admin-modal-footer admin-field--wide"><button type="button" class="admin-button admin-button--ghost" data-action="close-modal">取消</button><button type="submit" class="admin-button admin-button--lime">开始导入</button></div></form></div></section></div>`;
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
    const [auditResult, issuesResult] = await Promise.allSettled([
      adminRequest('/api/admin/audit?page=1&pageSize=6'),
      adminRequest('/api/admin/catalog/issues?page=1&pageSize=4&status=open'),
    ]);
    state.dashboard = {
      ...dashboard,
      recentAudit: auditResult.status === 'fulfilled' ? unwrapList(auditResult.value) : [],
      catalogIssues: issuesResult.status === 'fulfilled' ? unwrapList(issuesResult.value) : [],
    };
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
    const selectedTable = chooseDatabaseTable(status.tables || [], state.database.selectedTable);
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
  if (!table) return;
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
  state.agents.loading = true;
  render();
  try {
    const [configPayload, flagPayload] = await Promise.all([
      adminRequest('/api/admin/agent-configurations'),
      adminRequest('/api/admin/feature-flags'),
    ]);
    state.agents = { configurations: unwrapList(configPayload, ['configurations', 'data']), flags: unwrapList(flagPayload, ['flags', 'data']), loading: false };
  } catch (error) {
    state.agents.loading = false;
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

async function loadActiveSection() {
  if (state.accessDenied) return;
  switch (state.section) {
    case 'database': return loadDatabase();
    case 'schools': return loadSchools({ page: state.schools.page });
    case 'users': return loadUsers({ page: state.users.page });
    case 'agents': return loadAgents();
    case 'quality': return loadQuality({ page: state.quality.page });
    case 'audit': return loadAudit({ page: state.audit.page });
    default: return loadDashboard();
  }
}

function handleAdminError(error) {
  if (error instanceof ApiError && error.status === 401) {
    state.user = getAuthenticatedUser();
    state.accessDenied = false;
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
  const dryRun = fields ? fields.get('dryRun') === 'on' : true;
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
    showToast(dryRun ? '导入预览已生成' : '导入完成');
    if (!dryRun || table !== state.database.selectedTable) await loadDatabaseTable({ table, page: 1 });
    else render();
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
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
  try {
    await adminRequest(`/api/admin/agent-configurations/${encodeURIComponent(key)}`, { method: 'PATCH', body: { settings } });
    showToast('智能体配置已保存');
    await loadAgents();
  } catch (error) {
    showToast(requestErrorMessage(error), { error: true });
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
  state.section = next;
  state.menuOpen = false;
  render();
  void loadActiveSection();
}

function render() {
  if (!state.user) renderLogin();
  else renderShell();
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.id === 'adminLoginForm') { event.preventDefault(); void handleLogin(form); }
  if (form.id === 'schoolForm') { event.preventDefault(); void saveSchool(form); }
  if (form.id === 'dbRowForm') { event.preventDefault(); void saveDatabaseRow(form); }
  if (form.id === 'dbImportForm') { event.preventDefault(); void importDatabaseTable(form); }
  if (form.id === 'dbExportForm') { event.preventDefault(); void exportDatabaseTable(form); }
});

document.addEventListener('click', (event) => {
  const section = event.target.closest('[data-section]');
  if (section) { setSection(section.dataset.section); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.classList.contains('admin-modal-backdrop') && event.target !== button) return;
  const { action } = button.dataset;
  if (action === 'toggle-menu') { state.menuOpen = !state.menuOpen; render(); return; }
  if (action === 'logout') { void logout().finally(() => { state.user = null; state.accessDenied = false; render(); }); return; }
  if (action === 'refresh') { void loadActiveSection(); return; }
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
  if (action === 'refresh-quality') { void loadQuality({ page: state.quality.page }); return; }
  if (action === 'resolve-issue') { void resolveIssue(number(button.dataset.id)); return; }
  if (action === 'refresh-audit') { void loadAudit({ page: state.audit.page }); return; }
  if (action === 'page') {
    const page = number(button.dataset.page, 1);
    if (page < 1) return;
    if (button.dataset.kind === 'database') void loadDatabaseTable({ table: state.database.selectedTable, page });
    if (button.dataset.kind === 'schools') void loadSchools({ page });
    if (button.dataset.kind === 'users') void loadUsers({ page });
    if (button.dataset.kind === 'quality') void loadQuality({ page });
    if (button.dataset.kind === 'audit') void loadAudit({ page });
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
