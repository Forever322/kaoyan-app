import { Router } from 'express';
import { getDB } from '../db/index.js';
import { isSuperAdministrator, requireAdministrator } from '../middleware/admin-auth.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { requestAuditMetadata, writeAdminAudit } from '../services/admin-audit-service.js';
import {
  publicAgentModelSettings,
  resolveAgentModelConnectionTest,
  saveAgentModelProfile,
  testAgentModelConnection,
} from '../services/agent-model-settings-service.js';

const DEFAULT_PROFILE_KEY = 'default';
const TEST_REQUESTS_PER_MINUTE = Math.min(10, Math.max(1, Number(process.env.AGENT_MODEL_TEST_REQUESTS_PER_MINUTE || 3)));
const SAVE_REQUESTS_PER_MINUTE = Math.min(20, Math.max(1, Number(process.env.AGENT_MODEL_SAVE_REQUESTS_PER_MINUTE || 6)));
const defaultConnectionTestLimiter = createRateLimiter({ windowMs: 60_000, max: TEST_REQUESTS_PER_MINUTE });
const defaultSettingsMutationLimiter = createRateLimiter({ windowMs: 60_000, max: SAVE_REQUESTS_PER_MINUTE });

function requestError(message, status = 400, code = '') {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function saveBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw requestError('请求正文必须是对象');
  const profileKey = body.profileKey === undefined ? DEFAULT_PROFILE_KEY : String(body.profileKey || '').trim();
  if (profileKey !== DEFAULT_PROFILE_KEY) throw requestError('当前版本只允许修改默认模型配置');
  const patch = { ...body };
  delete patch.profileKey;
  return { profileKey, patch };
}

function testAuditMetadata(runtime, result = null) {
  return {
    profileKey: runtime.profileKey || DEFAULT_PROFILE_KEY,
    provider: runtime.provider,
    model: runtime.model,
    credentialSource: runtime.source,
    success: Boolean(result?.ok),
    ...(result ? { latencyMs: Number(result.latencyMs || 0) } : {}),
  };
}

export function createAdminAgentModelSettingsRouter({
  database = getDB,
  authenticate = requireAdministrator,
  audit = writeAdminAudit,
  listSettings = publicAgentModelSettings,
  saveProfile = saveAgentModelProfile,
  resolveTest = resolveAgentModelConnectionTest,
  testConnection = testAgentModelConnection,
  connectionTestLimiter = defaultConnectionTestLimiter,
  settingsMutationLimiter = defaultSettingsMutationLimiter,
} = {}) {
  const router = Router();

  router.use('/agent-model-settings', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    return next();
  });

  router.use('/agent-model-settings', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      if (!isSuperAdministrator(actor)) throw requestError('只有超级管理员可以管理模型配置', 403);
      req.agentModelSettingsContext = { db, actor };
      return next();
    } catch (error) { return next(error); }
  });

  router.get('/agent-model-settings', async (req, res, next) => {
    try {
      const { db } = req.agentModelSettingsContext;
      const result = await listSettings(db);
      const settings = result.data.find((profile) => profile.profileKey === DEFAULT_PROFILE_KEY) || null;
      return res.json({
        settings,
        defaultProfileKey: result.defaultProfileKey,
        credentialEncryptionConfigured: result.credentialEncryptionConfigured,
        environmentFallbackConfigured: result.environmentFallbackConfigured,
      });
    } catch (error) { return next(error); }
  });

  const updateSettings = async (req, res, next) => {
    try {
      const { db, actor } = req.agentModelSettingsContext;
      const { profileKey, patch } = saveBody(req.body);
      const profile = await saveProfile(db, {
        profileKey,
        body: patch,
        actorUserId: actor.id,
        onSaved: async (tx, { before, after, connectionValidated }) => audit(tx, {
          actorUserId: actor.id,
          action: 'agent_model_settings.update',
          resourceType: 'agent_model_profile',
          resourceId: profileKey,
          ...requestAuditMetadata(req),
          before,
          after,
          metadata: {
            credentialChanged: Object.hasOwn(patch, 'apiKey') || patch.clearApiKey === true
              || before?.credentialMode !== after?.credentialMode
              || before?.keyConfigured !== after?.keyConfigured
              || before?.keyLastFour !== after?.keyLastFour,
            credentialModeChanged: before?.credentialMode !== after?.credentialMode,
            connectionValidatedBeforeSave: connectionValidated,
          },
        }),
      });
      const result = await listSettings(db);
      const settings = result.data.find((item) => item.profileKey === profile.profileKey) || profile;
      return res.json({ settings, profile: settings });
    } catch (error) { return next(error); }
  };

  router.patch('/agent-model-settings', settingsMutationLimiter, updateSettings);
  router.put('/agent-model-settings', settingsMutationLimiter, updateSettings);

  router.post('/agent-model-settings/test', connectionTestLimiter, async (req, res, next) => {
    const { db, actor } = req.agentModelSettingsContext;
    let runtime = null;
    try {
      runtime = await resolveTest(db, req.body || {});
      const result = await testConnection(runtime);
      await audit(db, {
        actorUserId: actor.id,
        action: 'agent_model_settings.test_connection',
        resourceType: 'agent_model_profile',
        resourceId: runtime.profileKey || DEFAULT_PROFILE_KEY,
        ...requestAuditMetadata(req),
        metadata: testAuditMetadata(runtime, result),
      });
      return res.json(result);
    } catch (error) {
      if (runtime) {
        try {
          await audit(db, {
            actorUserId: actor.id,
            action: 'agent_model_settings.test_connection',
            resourceType: 'agent_model_profile',
            resourceId: runtime.profileKey || DEFAULT_PROFILE_KEY,
            ...requestAuditMetadata(req),
            metadata: {
              ...testAuditMetadata(runtime),
              errorCode: String(error?.code || 'model_connection_failed').slice(0, 80),
            },
          });
        } catch (auditError) { return next(auditError); }
      }
      return next(error);
    }
  });

  return router;
}

export default createAdminAgentModelSettingsRouter();
