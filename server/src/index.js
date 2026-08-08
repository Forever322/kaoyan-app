import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { migrate } from './db/index.js';
import universitiesRouter from './routes/universities.js';
import nationalLinesRouter from './routes/national-lines.js';
import matchRouter from './routes/match.js';
import agentsRouter from './routes/agents.js';

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 路由
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/universities', universitiesRouter);
app.use('/api/national-lines', nationalLinesRouter);
app.use('/api/match', matchRouter);
app.use('/api/agents', agentsRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: '接口不存在' }));

// 全局错误处理
app.use((err, _req, res, _next) => {
    console.error('[ERROR]', err);
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动：先迁移建表，再监听端口
migrate();
app.listen(PORT, () => {
    console.log(`[Server] 考研择校助手 API 已启动 → http://localhost:${PORT}`);
    console.log(`[Server] 健康检查 → http://localhost:${PORT}/api/health`);
});
