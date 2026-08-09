import { save } from '../db/index.js';

const DAILY_LIMIT = Math.min(500, Math.max(1, Number(process.env.AGENT_DAILY_REQUEST_LIMIT || 30)));

function agentError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function inputLength(input) {
  try { return Math.min(500_000, Buffer.byteLength(JSON.stringify(input), 'utf8')); } catch { return 0; }
}

function writeRun(db, { userId, runType, status, inputChars, outputChars = 0, durationMs, errorCode = '' }) {
  db.prepare('INSERT INTO agent_runs(user_id,run_type,status,model,input_chars,output_chars,duration_ms,error_code) VALUES(?,?,?,?,?,?,?,?)')
    .run(
      userId,
      runType,
      status,
      String(process.env.AGENT_MODEL || 'deepseek-chat').slice(0, 80),
      inputChars,
      outputChars,
      Math.max(0, Math.round(durationMs)),
      String(errorCode || '').slice(0, 80),
    );
}

export function assertDailyAgentQuota(db, userId) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM agent_runs
    WHERE user_id=? AND datetime(created_at) >= datetime('now', 'start of day')`).get(userId);
  if (Number(row?.count || 0) >= DAILY_LIMIT) {
    throw agentError('今日 AI 顾问调用次数已达上限，请明天再试', 429, 'daily_agent_quota_exceeded');
  }
}

export async function runAuditedAgentCall(db, { userId, runType, input, run }) {
  assertDailyAgentQuota(db, userId);
  const startedAt = Date.now();
  const inputChars = inputLength(input);
  try {
    const result = await run();
    const outputChars = inputLength(result);
    writeRun(db, { userId, runType, status: 'success', inputChars, outputChars, durationMs: Date.now() - startedAt });
    save();
    return result;
  } catch (error) {
    writeRun(db, {
      userId,
      runType,
      status: 'failed',
      inputChars,
      durationMs: Date.now() - startedAt,
      errorCode: error?.code || error?.name || 'agent_error',
    });
    save();
    throw error;
  }
}

