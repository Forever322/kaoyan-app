import { ApiError, apiRequest } from './auth-api.js';

/**
 * 收藏接口错误类型。
 *
 * 保留统一请求层的 status / payload / code，调用页面可以区分未登录、院校不存在、
 * 网络异常等情况，而不必解析服务端错误文案。
 */
export class FavoriteApiError extends ApiError {
  constructor(message, status = 0, payload = null, cause = null) {
    super(message, status, payload, cause);
    this.name = 'FavoriteApiError';
  }
}

const FAVORITES_PATH = '/api/favorites';

/**
 * 后端约定：
 * - GET    /api/favorites      -> { favorites: Favorite[] }
 * - POST   /api/favorites      <- { universityName }, -> { favorite: Favorite }
 * - DELETE /api/favorites/:id  -> 204 或 { deleted: true }
 *
 * Favorite 至少包含 universityId 和 universityName；该模块也兼容 snake_case 的
 * university_id / university_name，便于平滑接入已有 MySQL 字段命名。
 */

function parsePositiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new FavoriteApiError(`${label}必须是正整数`, 400);
  }
  return id;
}

function normalizeUniversityName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw new FavoriteApiError('院校名称不能为空', 400);
  return name;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeFavorite(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FavoriteApiError('服务器返回的收藏数据无效', 502, value || null);
  }

  const university = value.university && typeof value.university === 'object' ? value.university : {};
  const universityId = firstDefined(
    value.universityId,
    value.university_id,
    university.id,
  );
  const universityName = firstDefined(
    value.universityName,
    value.university_name,
    university.name,
  );

  let safeUniversityId;
  try {
    safeUniversityId = parsePositiveId(universityId, '院校 ID');
  } catch {
    throw new FavoriteApiError('服务器返回的收藏院校 ID 无效', 502, value);
  }

  const safeUniversityName = String(universityName ?? '').trim();
  if (!safeUniversityName) {
    throw new FavoriteApiError('服务器返回的收藏院校名称无效', 502, value);
  }

  const favoriteId = firstDefined(value.favoriteId, value.favorite_id, value.id);
  const createdAt = firstDefined(value.createdAt, value.created_at);
  const province = firstDefined(value.province, university.province);
  const city = firstDefined(value.city, university.city);
  const zone = firstDefined(value.zone, university.zone);
  const level = firstDefined(value.level, university.level);
  const type = firstDefined(value.type, university.type);

  return {
    ...(favoriteId === undefined ? {} : { id: Number.isSafeInteger(Number(favoriteId)) ? Number(favoriteId) : favoriteId }),
    universityId: safeUniversityId,
    universityName: safeUniversityName,
    ...(createdAt === undefined ? {} : { createdAt: String(createdAt) }),
    ...(province === undefined ? {} : { province: String(province) }),
    ...(city === undefined ? {} : { city: String(city) }),
    ...(zone === undefined ? {} : { zone: String(zone) }),
    ...(level === undefined ? {} : { level: String(level) }),
    ...(type === undefined ? {} : { type: String(type) }),
  };
}

function extractFavoriteList(payload) {
  const records = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.favorites) ? payload.favorites : payload?.data);
  if (!Array.isArray(records)) {
    throw new FavoriteApiError('服务器返回的收藏列表无效', 502, payload || null);
  }
  return records.map(normalizeFavorite);
}

function extractFavorite(payload) {
  const favorite = payload?.favorite || payload?.data || payload;
  return normalizeFavorite(favorite);
}

async function favoriteRequest(path, { method = 'GET', body, signal } = {}) {
  try {
    return await apiRequest(path, { method, body, requiresAuth: true, signal });
  } catch (error) {
    if (error instanceof FavoriteApiError) throw error;
    if (error instanceof ApiError) {
      throw new FavoriteApiError(error.message, error.status, error.payload, error.cause || error);
    }
    throw new FavoriteApiError('收藏数据请求失败，请稍后重试', 0, null, error);
  }
}

/** 获取当前登录用户已收藏的院校，按后端返回顺序排列。 */
export async function listFavoriteUniversities({ signal } = {}) {
  const payload = await favoriteRequest(FAVORITES_PATH, { signal });
  return extractFavoriteList(payload);
}

/** 通过院校名称创建收藏。后端负责名称匹配、去重与归属校验。 */
export async function addFavoriteByName(universityName, { signal } = {}) {
  const payload = await favoriteRequest(FAVORITES_PATH, {
    method: 'POST',
    body: { universityName: normalizeUniversityName(universityName) },
    signal,
  });
  return extractFavorite(payload);
}

/** 使用院校 ID 取消收藏；DELETE 成功时返回服务端响应（可能是 null）。 */
export function removeFavoriteById(universityId, { signal } = {}) {
  const id = parsePositiveId(universityId, '院校 ID');
  return favoriteRequest(`${FAVORITES_PATH}/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    signal,
  });
}

/**
 * 使用院校名称取消收藏。
 *
 * REST 删除端点以 universityId 为键，因此先读取当前用户列表再解析名称；若该院校
 * 未被收藏则返回 false，页面可将其视为幂等的“已取消”状态。
 */
export async function removeFavoriteByName(universityName, { signal } = {}) {
  const name = normalizeUniversityName(universityName);
  const favorites = await listFavoriteUniversities({ signal });
  const favorite = favorites.find((item) => item.universityName === name);
  if (!favorite) return false;
  await removeFavoriteById(favorite.universityId, { signal });
  return true;
}

/**
 * 按院校名称切换收藏状态。
 * @returns {Promise<{isFavorite: boolean, favorite: object|null}>}
 */
export async function toggleFavoriteByName(universityName, { signal } = {}) {
  const name = normalizeUniversityName(universityName);
  const favorites = await listFavoriteUniversities({ signal });
  const existing = favorites.find((item) => item.universityName === name);
  if (existing) {
    await removeFavoriteById(existing.universityId, { signal });
    return { isFavorite: false, favorite: null };
  }

  const favorite = await addFavoriteByName(name, { signal });
  return { isFavorite: true, favorite };
}

/** 判断当前用户是否已收藏某所院校。 */
export async function isFavoriteUniversity(universityName, { signal } = {}) {
  const name = normalizeUniversityName(universityName);
  const favorites = await listFavoriteUniversities({ signal });
  return favorites.some((item) => item.universityName === name);
}
