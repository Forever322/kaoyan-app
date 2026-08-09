import 'dotenv/config';
import { migrate } from './db/index.js';
import { createApp } from './app.js';

const PORT = process.env.PORT || 3000;

// 启动：先迁移建表，再监听端口
migrate();
const app = createApp();
app.listen(PORT, () => {
    console.log(`[Server] 考研择校助手 API 已启动 → http://localhost:${PORT}`);
    console.log(`[Server] 健康检查 → http://localhost:${PORT}/api/health`);
});
