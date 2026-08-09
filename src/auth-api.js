// 前端认证与受保护接口的统一入口。
// 生产环境默认同源（API_BASE 为空），由 Nginx 将 /api 代理到后端；本地联调可在 .env.local 中设置 VITE_API_BASE。
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

const AUTH_SESSION_KEY = 'kaoyan.auth.session.v1';
const LEGACY_AGENT_USER_ID_KEY = 'agent_user_id';

let memorySession = null;

export class ApiError extends Error {
  constructor(message, status = 0, payload = null, cause = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    this.code = payload?.code || null;
    if (cause) this.cause = cause;
  }
}

export class AuthApiError extends ApiError {
  constructor(message, status = 0, payload = null, cause = null) {
    super(message, status, payload, cause);
    this.name = 'AuthApiError';
  }
}

function getStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function normalizeUser(user) {
  if (!user || typeof user !== 'object' || !Number.isInteger(Number(user.id)) || Number(user.id) <= 0) return null;
  return {
    id: Number(user.id),
    username: String(user.username || ''),
    email: String(user.email || ''),
    avatarUrl: String(user.avatarUrl || ''),
  };
}

function normalizeExpiresAt(expiresAt) {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isExpired(session) {
  return Boolean(session?.expiresAt && new Date(session.expiresAt).getTime() <= Date.now());
}

function normalizeSession(value) {
  const accessToken = String(value?.accessToken || '').trim();
  if (!accessToken) return null;

  const expiresAt = normalizeExpiresAt(value.expiresAt);
  // 服务端当前一定返回 expiresAt。若本地数据被篡改，宁可要求重新登录也不继续携带未知有效期的令牌。
  if (!expiresAt) return null;

  const session = { accessToken, expiresAt, user: normalizeUser(value.user) };
  return isExpired(session) ? null : session;
}

function notifyAuthState(session) {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  // 事件中只暴露用户摘要，绝不能把 accessToken 放进 DOM 事件、日志或 URL。
  window.dispatchEvent(new CustomEvent('kaoyan-auth-change', {
    detail: { authenticated: Boolean(session), user: session?.user || null },
  }));
}

function writeSession(session) {
  memorySession = session;
  const storage = getStorage();
  if (!storage) return;
  try {
    if (session) storage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    else storage.removeItem(AUTH_SESSION_KEY);
    // 旧版 Agent 使用可伪造的 X-User-Id；新令牌登录后不再读取它。
    storage.removeItem(LEGACY_AGENT_USER_ID_KEY);
  } catch {
    // 隐私模式或存储配额不足时，当前页面仍可使用内存中的会话。
  }
}

function readStoredSession() {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(AUTH_SESSION_KEY);
    return raw ? normalizeSession(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function setSession(session) {
  writeSession(session);
  notifyAuthState(session);
  return session;
}

/** 返回已保存的会话摘要；过期或损坏的本地数据会被自动清除。 */
export function getAuthSession() {
  if (!memorySession) memorySession = readStoredSession();
  if (memorySession && !isExpired(memorySession)) return { ...memorySession, user: memorySession.user ? { ...memorySession.user } : null };
  if (memorySession || getStorage()?.getItem(AUTH_SESSION_KEY)) setSession(null);
  return null;
}

export function getAccessToken() {
  return getAuthSession()?.accessToken || '';
}

export function getAuthenticatedUser() {
  const user = getAuthSession()?.user;
  return user ? { ...user } : null;
}

export function isAuthenticated() {
  return Boolean(getAccessToken());
}

/**
 * 保存一个后端认证响应。仅保存 accessToken、到期时间和公开用户信息，绝不保存密码。
 * @param {{accessToken: string, expiresAt: string, user?: object}} response
 */
export function saveAuthSession(response) {
  const session = normalizeSession(response);
  if (!session) throw new AuthApiError('登录响应无效，请重新登录', 502, response || null);
  return setSession(session);
}

export function clearAuthSession() {
  setSession(null);
}

function requestUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new ApiError('接口路径必须以 / 开头');
  return `${API_BASE}${path}`;
}

function serializeBody(body, headers) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string' || body instanceof FormData || body instanceof URLSearchParams || body instanceof Blob) return body;
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return JSON.stringify(body);
}

async function readResponsePayload(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * 统一请求层。受保护接口设置 requiresAuth 后会自动添加 Bearer token；401 会清除本地登录态。
 */
export async function apiRequest(path, { method = 'GET', body, headers, requiresAuth = false, signal } = {}) {
  const requestHeaders = new Headers(headers || {});
  if (requiresAuth) {
    const token = getAccessToken();
    if (!token) throw new AuthApiError('请先登录后再使用该功能', 401);
    requestHeaders.set('Authorization', `Bearer ${token}`);
  }

  let response;
  try {
    response = await fetch(requestUrl(path), {
      method,
      headers: requestHeaders,
      body: serializeBody(body, requestHeaders),
      signal,
      // 登录态、学习汇总、计划与 Agent 结果都属于用户私有数据，不能复用浏览器 HTTP 缓存。
      cache: requiresAuth ? 'no-store' : 'default',
    });
  } catch (error) {
    const message = error?.name === 'AbortError' ? '请求已取消' : '网络连接失败，请检查网络后重试';
    throw new ApiError(message, 0, null, error);
  }

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    if (requiresAuth && response.status === 401) clearAuthSession();
    const message = (payload && typeof payload === 'object' && (payload.error || payload.message))
      || `请求失败（${response.status}）`;
    throw new ApiError(message, response.status, payload);
  }
  return payload;
}

function assertCredentials(input, { allowEmail = false } = {}) {
  const username = String(input?.username || '').trim();
  const password = String(input?.password || '');
  const email = String(input?.email || '').trim();
  if (!username) throw new AuthApiError('请输入昵称', 400);
  if (!password) throw new AuthApiError('请输入密码', 400);
  return allowEmail ? { username, password, email } : { username, password };
}

export async function register(credentials) {
  const body = assertCredentials(credentials, { allowEmail: true });
  const response = await apiRequest('/api/auth/register', { method: 'POST', body });
  saveAuthSession(response);
  return response;
}

export async function login(credentials) {
  const body = assertCredentials(credentials);
  const response = await apiRequest('/api/auth/login', { method: 'POST', body });
  saveAuthSession(response);
  return response;
}

/** 获取服务器确认过的当前用户，并同步更新本地用户摘要。 */
export async function getCurrentUser() {
  const response = await apiRequest('/api/auth/me', { requiresAuth: true });
  const user = normalizeUser(response?.user);
  if (!user) throw new AuthApiError('服务器返回的用户信息无效，请重新登录', 502, response || null);
  const session = getAuthSession();
  if (session) setSession({ ...session, user });
  return user;
}

/**
 * 应用启动时调用以恢复登录态。仅在服务端明确返回 401 时清除令牌；网络失败时保留会话供重试。
 */
export async function restoreAuthSession() {
  const session = getAuthSession();
  if (!session) return null;
  const user = await getCurrentUser();
  return { ...getAuthSession(), user };
}

/** 无论网络是否可用都清除本机令牌；服务端可达时同时撤销该令牌。 */
export async function logout() {
  const hasToken = Boolean(getAccessToken());
  if (!hasToken) {
    clearAuthSession();
    return null;
  }

  try {
    return await apiRequest('/api/auth/logout', { method: 'POST', requiresAuth: true });
  } catch (error) {
    // 令牌已经过期时，本地退出仍视为成功；其他错误交由 UI 告知用户。
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  } finally {
    clearAuthSession();
  }
}
