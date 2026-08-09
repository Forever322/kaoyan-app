import { ApiError, apiRequest } from './auth-api.js';

/**
 * 学习数据接口的错误类型。
 *
 * 保留认证请求层的 status / payload / code，页面可以据此分别处理登录失效、
 * 乐观锁冲突（409）和网络异常，而不用解析错误文案。
 */
export class StudyApiError extends ApiError {
  constructor(message, status = 0, payload = null, cause = null) {
    super(message, status, payload, cause);
    this.name = 'StudyApiError';
    this.currentRevision = Number.isInteger(Number(payload?.currentRevision))
      ? Number(payload.currentRevision)
      : null;
  }
}

function toPlanType(planType) {
  if (!['study', 'admission'].includes(planType)) {
    throw new StudyApiError('计划类型必须为 study 或 admission', 400);
  }
  return planType;
}

function toSummaryDays(days) {
  const parsed = Number(days);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(1, Math.min(90, Math.trunc(parsed)));
}

function toExpectedRevision(expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null) return undefined;
  const parsed = Number(expectedRevision);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new StudyApiError('计划版本号必须是非负整数', 400);
  }
  return parsed;
}

function toStudySessionBody(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new StudyApiError('学习记录必须是对象', 400);
  }
  return {
    subject: String(input.subject || '').trim(),
    content: String(input.content || ''),
    startedAt: input.startedAt,
    ...(input.endedAt ? { endedAt: input.endedAt } : {}),
    durationS: input.durationS,
  };
}

async function studyRequest(path, { method = 'GET', body, signal } = {}) {
  try {
    return await apiRequest(path, { method, body, requiresAuth: true, signal });
  } catch (error) {
    if (error instanceof StudyApiError) throw error;
    if (error instanceof ApiError) {
      throw new StudyApiError(error.message, error.status, error.payload, error.cause || error);
    }
    throw new StudyApiError('学习数据请求失败，请稍后重试', 0, null, error);
  }
}

/** 写入一段已结束的学习记录。 */
export function createStudySession(session, { signal } = {}) {
  return studyRequest('/api/study/sessions', {
    method: 'POST',
    body: toStudySessionBody(session),
    signal,
  });
}

/** 获取当前登录用户的学习汇总，days 为 1–90。 */
export function getStudySummary(days = 7, { signal } = {}) {
  const safeDays = toSummaryDays(days);
  return studyRequest(`/api/study/summary?${new URLSearchParams({ days: String(safeDays) })}`, { signal });
}

/** 获取有版本号保护的报考/学习计划。 */
export function getUserPlans({ signal } = {}) {
  return studyRequest('/api/plans', { signal });
}

/**
 * 获取单个计划状态。后端将两个计划一起返回；此函数只负责提取所需项。
 * @returns {Promise<{plan: object, revision: number, updatedAt: string|null}>}
 */
export async function getUserPlan(planType, { signal } = {}) {
  const type = toPlanType(planType);
  const response = await getUserPlans({ signal });
  const state = response?.plans?.[type];
  if (!state || typeof state !== 'object') {
    throw new StudyApiError('服务器返回的计划数据无效', 502, response || null);
  }
  return state;
}

/**
 * 整体更新一个计划。调用方应传入刚读取到的 revision，避免覆盖其他设备的新修改。
 */
export function updateUserPlan(planType, plan, expectedRevision, { signal } = {}) {
  const type = toPlanType(planType);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new StudyApiError('计划内容必须是对象', 400);
  }
  const revision = toExpectedRevision(expectedRevision);
  return studyRequest(`/api/plans/${type}`, {
    method: 'PUT',
    body: {
      plan,
      ...(revision === undefined ? {} : { expectedRevision: revision }),
    },
    signal,
  });
}

/** 语义化别名，便于后续拆分“备考”和“报考”页面时直接调用。 */
export function getStudyPlan(options) {
  return getUserPlan('study', options);
}

export function getAdmissionPlan(options) {
  return getUserPlan('admission', options);
}

export function updateStudyPlan(plan, expectedRevision, options) {
  return updateUserPlan('study', plan, expectedRevision, options);
}

export function updateAdmissionPlan(plan, expectedRevision, options) {
  return updateUserPlan('admission', plan, expectedRevision, options);
}
