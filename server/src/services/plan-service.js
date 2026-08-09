const MAX_PLAN_BYTES = Math.min(120_000, Math.max(1_024, Number(process.env.MAX_PLAN_BYTES || 60_000)));
const MAX_AGENT_STUDY_ITEMS = 60;
const MAX_AGENT_PLAN_TEXT = 1_200;
const MAX_AGENT_ITEM_TEXT = 160;

const PLAN_CONFIG = {
  admission: { table: 'user_admission_plans', key: 'admissionPlan' },
  study: { table: 'user_study_plans', key: 'studyPlan' },
};

function jsonOr(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function clientError(message, status = 400, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function configFor(planType) {
  const config = PLAN_CONFIG[planType];
  if (!config) throw clientError('计划类型必须为 admission 或 study');
  return config;
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw clientError('plan 必须是对象');
  }
  let serialized;
  try { serialized = JSON.stringify(plan); } catch { throw clientError('plan 必须可以序列化为 JSON'); }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PLAN_BYTES) {
    throw clientError(`plan 不能超过 ${Math.floor(MAX_PLAN_BYTES / 1024)}KB`, 413);
  }
  return { plan, serialized };
}

function agentPlanError(message) {
  return clientError(message, 422);
}

function textField(value, label, { required = false, maxLength = MAX_AGENT_ITEM_TEXT } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw agentPlanError(`${label}不能为空`);
    return '';
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw agentPlanError(`${label}格式不正确`);
  }
  const text = String(value).trim();
  if ((required && !text) || text.length > maxLength) {
    throw agentPlanError(`${label}格式不正确`);
  }
  return text;
}

function parsePlannedHours(value) {
  const text = String(value || '').trim().toLowerCase();
  const plainHours = text.match(/^(\d+(?:\.\d+)?)\s*(?:h|小时|hour|hours)?$/u);
  if (plainHours) return Number(plainHours[1]);
  const hourPart = text.match(/(\d+(?:\.\d+)?)\s*(?:h|小时|hour|hours)/u);
  const minutePart = text.match(/(\d+(?:\.\d+)?)\s*(?:m|分|min|分钟|minutes?)/u);
  if (!hourPart && !minutePart) return Number.NaN;
  return Number(hourPart?.[1] || 0) + (Number(minutePart?.[1] || 0) / 60);
}

function validateAgentStudyItem(item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw agentPlanError(`第 ${index + 1} 项学习任务格式不正确`);
  }
  textField(item.subject, `第 ${index + 1} 项学习任务的科目`, { required: true, maxLength: 40 });
  textField(item.title ?? item.task ?? item.name, `第 ${index + 1} 项学习任务的标题`, { required: true, maxLength: 120 });
  const duration = item.hours ?? item.duration;
  const durationText = textField(duration, `第 ${index + 1} 项学习任务的时长`, { required: true, maxLength: 32 });
  const parsedHours = parsePlannedHours(durationText);
  if (!Number.isFinite(parsedHours) || parsedHours <= 0 || parsedHours > 24) {
    throw agentPlanError(`第 ${index + 1} 项学习任务的时长需在 0–24 小时之间`);
  }
  textField(item.note ?? item.description, `第 ${index + 1} 项学习任务的备注`, { maxLength: MAX_AGENT_PLAN_TEXT });
  if (item.completed !== undefined && typeof item.completed !== 'boolean') {
    throw agentPlanError(`第 ${index + 1} 项学习任务的完成状态格式不正确`);
  }
}

function validateAgentAdmissionPlan(plan) {
  const keys = Object.keys(plan);
  if (!keys.length || keys.length > 24) throw agentPlanError('报考方案字段数量不正确');
  const targetKeys = ['university', 'school', 'targetUniversity', 'targetSchool', 'universityName', '院校', '学校', '目标院校'];
  const hasTarget = targetKeys.some((key) => textField(plan[key], '报考院校', { maxLength: 160 }));
  const alternatives = plan.alternatives;
  if (!hasTarget && (!Array.isArray(alternatives) || alternatives.length === 0 || alternatives.length > 12)) {
    throw agentPlanError('报考方案至少需要包含目标院校或候选院校');
  }
  for (const [key, value] of Object.entries(plan)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      textField(value, `报考方案字段 ${key}`, { maxLength: MAX_AGENT_PLAN_TEXT });
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > 100_000) throw agentPlanError(`报考方案字段 ${key} 格式不正确`);
      continue;
    }
    if (typeof value === 'boolean') continue;
    if (!Array.isArray(value) || value.length > 12) throw agentPlanError(`报考方案字段 ${key} 格式不正确`);
    value.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length > 12) {
        throw agentPlanError(`候选院校第 ${index + 1} 项格式不正确`);
      }
      Object.entries(entry).forEach(([entryKey, entryValue]) => {
        if (!['string', 'number', 'boolean'].includes(typeof entryValue) || String(entryValue).length > MAX_AGENT_PLAN_TEXT) {
          throw agentPlanError(`候选院校字段 ${entryKey} 格式不正确`);
        }
      });
    });
  }
}

/**
 * Models may only create a very small, renderable plan shape. Manual API
 * updates retain the more flexible validatePlan() contract for compatibility;
 * agent proposals call this stricter check both before storing and applying.
 */
export function validateAgentPlan(planType, plan) {
  const result = validatePlan(plan);
  if (planType === 'study') {
    if (!Array.isArray(plan.items) || plan.items.length < 1 || plan.items.length > MAX_AGENT_STUDY_ITEMS) {
      throw agentPlanError(`学习计划需要包含 1–${MAX_AGENT_STUDY_ITEMS} 项任务`);
    }
    plan.items.forEach(validateAgentStudyItem);
    return result;
  }
  if (planType === 'admission') {
    validateAgentAdmissionPlan(plan);
    return result;
  }
  throw agentPlanError('不支持的计划类型');
}

export async function getPlanState(db, userId, planType) {
  const { table } = configFor(planType);
  const row = await db.one(`SELECT plan_json,revision,updated_at FROM ${table} WHERE user_id=?`, [userId]);
  return {
    plan: jsonOr(row?.plan_json, {}),
    revision: Number(row?.revision || 0),
    updatedAt: row?.updated_at || null,
  };
}

export async function getPlansState(db, userId) {
  const [admission, study] = await Promise.all([
    getPlanState(db, userId, 'admission'),
    getPlanState(db, userId, 'study'),
  ]);
  return { admission, study };
}

/**
 * Replaces one plan and monotonically increments its revision. The conditional
 * update provides optimistic concurrency both inside and outside a transaction.
 */
export async function replacePlan(db, userId, planType, plan, expectedRevision = undefined) {
  const { table } = configFor(planType);
  const { serialized } = validatePlan(plan);
  const normalizedExpected = expectedRevision === undefined ? undefined : Number(expectedRevision);

  // Existing plans use a conditional UPDATE so a concurrent request cannot
  // silently overwrite the same revision. A missing row is handled separately
  // because every new plan starts at revision 1.
  const updateSql = normalizedExpected === undefined
    ? `UPDATE ${table} SET plan_json=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE user_id=?`
    : `UPDATE ${table} SET plan_json=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE user_id=? AND revision=?`;
  const updateParams = normalizedExpected === undefined
    ? [serialized, userId]
    : [serialized, userId, normalizedExpected];
  const updated = await db.execute(updateSql, updateParams);
  if (Number(updated.affectedRows || 0) === 1) return getPlanState(db, userId, planType);

  const existing = await db.one(`SELECT revision FROM ${table} WHERE user_id=?`, [userId]);
  if (existing) {
    throw clientError('计划已在生成建议后发生变化，请重新生成或手动合并', 409, { currentRevision: Number(existing.revision || 0) });
  }
  if (normalizedExpected !== undefined && normalizedExpected !== 0) {
    throw clientError('计划已在生成建议后发生变化，请重新生成或手动合并', 409, { currentRevision: 0 });
  }

  try {
    await db.execute(`INSERT INTO ${table}(user_id,plan_json,revision,updated_at) VALUES(?,?,1,UTC_TIMESTAMP(3))`, [userId, serialized]);
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
    const current = await getPlanState(db, userId, planType);
    throw clientError('计划已在生成建议后发生变化，请重新生成或手动合并', 409, { currentRevision: current.revision });
  }
  return getPlanState(db, userId, planType);
}

export async function getLegacyCurrentPlans(db, userId) {
  const states = await getPlansState(db, userId);
  return {
    admissionPlan: states.admission.plan,
    studyPlan: states.study.plan,
  };
}
