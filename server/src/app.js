import express from 'express';
import cors from 'cors';
import universitiesRouter from './routes/universities.js';
import programsRouter from './routes/programs.js';
import nationalLinesRouter from './routes/national-lines.js';
import matchRouter from './routes/match.js';
import agentsRouter from './routes/agents.js';
import authRouter from './routes/auth.js';
import studyRouter from './routes/study.js';
import plansRouter from './routes/plans.js';
import favoritesRouter from './routes/favorites.js';
import adminRouter from './routes/admin.js';
import adminCatalogRouter from './routes/admin-catalog.js';
import adminDatabaseRouter from './routes/admin-database.js';
import adminAgentRouter from './routes/admin-agent.js';
import { AgentServiceError } from './services/agent-service.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { createAdminAccessLogger } from './middleware/admin-access-log.js';
import { requireAdministrator } from './middleware/admin-auth.js';
import { getDB } from './db/index.js';

function allowedOrigins() {
  return String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsOptions() {
  const origins = allowedOrigins();
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    origin(origin, callback) {
      // 原生 App、curl 和同源反代请求通常没有 Origin；浏览器跨域请求必须明确白名单。
      if (!origin || origins.includes(origin) || (!isProduction && origins.length === 0)) return callback(null, true);
      const error = new Error('不允许的跨域来源');
      error.status = 403;
      return callback(error);
    },
  };
}

export function createApp() {
  const app = express();
  const authRequestsPer15Min = Math.min(100, Math.max(5, Number(process.env.AUTH_REQUESTS_PER_15_MIN || 30)));
  const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '1mb';
  const importBodyLimit = process.env.ADMIN_DATABASE_IMPORT_BODY_LIMIT || '12mb';
  const importBodyBytes = Math.min(32 * 1024 * 1024, Math.max(1024, Number(process.env.ADMIN_DATABASE_IMPORT_BODY_BYTES || 12 * 1024 * 1024)));
  const importRequestsPerMinute = Math.min(60, Math.max(1, Number(process.env.ADMIN_IMPORT_REQUESTS_PER_MINUTE || 12)));
  const importIpLimiter = createRateLimiter({
    windowMs: 60_000,
    max: importRequestsPerMinute,
    key: (req) => `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`,
  });
  const rejectOversizedImport = (req, res, next) => {
    const contentLength = Number(req.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > importBodyBytes) {
      return res.status(413).json({ error: '导入请求体过大' });
    }
    return next();
  };
  const authenticateImportBeforeParsing = async (req, res, next) => {
    try {
      const actor = await requireAdministrator(req, res, await getDB());
      if (actor) return next();
      return undefined;
    } catch (error) { return next(error); }
  };

  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use(cors(corsOptions()));
  app.use('/api/admin', createAdminAccessLogger());
  // Large JSON/base64 payloads are accepted only on reviewed import routes;
  // ordinary APIs retain a much smaller request-body ceiling.
  app.post('/api/admin/database/tables/:table/import', importIpLimiter, rejectOversizedImport, authenticateImportBeforeParsing, express.json({ limit: importBodyLimit }));
  app.post('/api/admin/database-agent/reviews', importIpLimiter, rejectOversizedImport, authenticateImportBeforeParsing, express.json({ limit: importBodyLimit }));
  app.use(express.json({ limit: jsonBodyLimit }));

  app.get('/api/health', async (_req, res) => {
    try {
      const db = await getDB();
      await db.one('SELECT 1 AS connected');
      return res.json({ status: 'ok', database: 'mysql', time: new Date().toISOString() });
    } catch (error) {
      console.error('[Health] MySQL unavailable:', error?.code || error?.message || error);
      return res.status(503).json({ status: 'unavailable', database: 'mysql' });
    }
  });
  app.use('/api/universities', universitiesRouter);
  app.use('/api/programs', programsRouter);
  app.use('/api/national-lines', nationalLinesRouter);
  app.use('/api/match', matchRouter);
  app.use('/api/auth', createRateLimiter({ windowMs: 15 * 60_000, max: authRequestsPer15Min }), authRouter);
  app.use('/api/study', studyRouter);
  app.use('/api/plans', plansRouter);
  app.use('/api/favorites', favoritesRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/admin', adminCatalogRouter);
  app.use('/api/admin', adminDatabaseRouter);
  app.use('/api/admin', adminAgentRouter);

  app.use((_req, res) => res.status(404).json({ error: '接口不存在' }));

  app.use((err, _req, res, _next) => {
    if (err instanceof AgentServiceError) {
      const invalidOutput = ['invalid_model_response', 'invalid_model_operation'].includes(err.code);
      return res.status(invalidOutput ? 422 : 502).json({ error: err.message, code: err.code });
    }
    const status = Number(err.status) || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error('[ERROR]', err);
    return res.status(status).json({
      error: status === 500 ? '服务器内部错误' : (err.message || '请求参数不合法'),
      ...(err.code ? { code: err.code } : {}),
    });
  });

  return app;
}

export default createApp;
