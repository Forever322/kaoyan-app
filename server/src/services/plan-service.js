const MAX_PLAN_BYTES = Math.min(120_000, Math.max(1_024, Number(process.env.MAX_PLAN_BYTES || 60_000)));

const PLAN_CONFIG = {
  admission: { table: 'user_admission_plans', key: 'admissionPlan' },
  study: { table: 'user_study_plans', key: 'studyPlan' },
};

function jsonOr(value, fallback) {
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

export function getPlanState(db, userId, planType) {
  const { table } = configFor(planType);
  const row = db.prepare(`SELECT plan_json,revision,updated_at FROM ${table} WHERE user_id=?`).get(userId);
  return {
    plan: jsonOr(row?.plan_json, {}),
    revision: Number(row?.revision || 0),
    updatedAt: row?.updated_at || null,
  };
}

export function getPlansState(db, userId) {
  return {
    admission: getPlanState(db, userId, 'admission'),
    study: getPlanState(db, userId, 'study'),
  };
}

/**
 * 替换一个计划并单调递增 revision。调用方在需要时应包在数据库事务中。
 */
export function replacePlan(db, userId, planType, plan, expectedRevision = undefined) {
  const { table } = configFor(planType);
  const { serialized } = validatePlan(plan);
  const current = getPlanState(db, userId, planType);
  if (expectedRevision !== undefined && Number(expectedRevision) !== current.revision) {
    throw clientError('计划已在生成建议后发生变化，请重新生成或手动合并', 409, { currentRevision: current.revision });
  }
  const revision = current.revision + 1;
  db.prepare(`INSERT INTO ${table}(user_id,plan_json,revision,updated_at) VALUES(?,?,?,datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET plan_json=excluded.plan_json,revision=excluded.revision,updated_at=excluded.updated_at`)
    .run(userId, serialized, revision);
  return getPlanState(db, userId, planType);
}

export function getLegacyCurrentPlans(db, userId) {
  const states = getPlansState(db, userId);
  return {
    admissionPlan: states.admission.plan,
    studyPlan: states.study.plan,
  };
}

