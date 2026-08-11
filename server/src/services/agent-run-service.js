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

async function writeRun(db, {
  userId,
  adminAgentJobId = null,
  runType,
  status,
  model = process.env.AGENT_MODEL || 'deepseek-chat',
  inputChars,
  outputChars = 0,
  durationMs,
  errorCode = '',
}) {
  await db.execute(`INSERT INTO agent_runs(user_id,admin_agent_job_id,run_type,status,model,input_chars,output_chars,duration_ms,error_code)
    VALUES(?,?,?,?,?,?,?,?,?)`, [
    userId,
    adminAgentJobId,
    runType,
    status,
    String(model || 'unconfigured').slice(0, 80),
    inputChars,
    outputChars,
    Math.max(0, Math.round(durationMs)),
    String(errorCode || '').slice(0, 80),
  ]);
}

export async function assertDailyAgentQuota(db, userId) {
  const row = await db.one(`SELECT COUNT(*) AS count FROM agent_runs
    WHERE user_id=? AND created_at >= DATE(UTC_TIMESTAMP())`, [userId]);
  if (Number(row?.count || 0) >= DAILY_LIMIT) {
    throw agentError('今日 AI 顾问调用次数已达上限，请明天再试', 429, 'daily_agent_quota_exceeded');
  }
}

export async function runAuditedAgentCall(db, {
  userId,
  adminAgentJobId = null,
  runType,
  model = process.env.AGENT_MODEL || 'deepseek-chat',
  input,
  run,
}) {
  await assertDailyAgentQuota(db, userId);
  const startedAt = Date.now();
  const inputChars = inputLength(input);
  try {
    const result = await run();
    const outputChars = inputLength(result);
    await writeRun(db, {
      userId, adminAgentJobId, runType, status: 'success', model, inputChars, outputChars, durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    await writeRun(db, {
      userId,
      adminAgentJobId,
      runType,
      status: 'failed',
      model,
      inputChars,
      durationMs: Date.now() - startedAt,
      errorCode: error?.code || error?.name || 'agent_error',
    });
    throw error;
  }
}
