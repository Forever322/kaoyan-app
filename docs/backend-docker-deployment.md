# 后端 Docker 部署与 Agent 扩展

后端位于 `server/`，运行 Node.js、Express 和 `sql.js`。当前部署形态为一个 API 容器配一个持久化 Docker 卷，适合 MVP 单实例；Agent 模型通过服务器环境变量访问 OpenAI 兼容接口（默认 DeepSeek）。

## 1. 部署前提与限制

- Linux 服务器（建议 Ubuntu 22.04+）、Docker Engine 24+、Docker Compose v2。
- HTTPS 和域名由 Nginx 或现有网关提供。
- 仓库包含 `server/`、`src/data/`、`server/data/`、`docker-compose.backend.yml` 和 `server/Dockerfile`。

`sql.js` 会在进程内加载整库并在写入后导出文件。因此它不适合多个 API 副本同时写入：**当前只能运行一个 `api` 副本，不能直接水平扩容，也不应部署到没有持久磁盘的 Serverless 平台。**

## 2. 生产环境变量

在仓库根目录（与 `docker-compose.backend.yml` 同级）创建 `.env`。不要提交该文件，也不要复制开发机的真实密钥。

```env
NODE_ENV=production
PORT=3000

# 浏览器正式访问的来源；多个来源用英文逗号分隔
CORS_ORIGINS=https://app.example.com

# 生产环境必须关闭旧的 X-User-Id 开发兼容方式
ALLOW_DEV_HEADER_AUTH=false
AUTH_TOKEN_TTL_DAYS=90
AGENT_TIMEOUT_MS=30000
AGENT_MAX_TOKENS=1200
AGENT_CONTEXT_MAX_BYTES=24000
AGENT_REQUESTS_PER_MINUTE=8
AGENT_DAILY_REQUEST_LIMIT=30
AGENT_PROPOSAL_TTL_DAYS=7

LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=replace-with-a-server-side-secret
AGENT_MODEL=deepseek-chat
```

重点：

- `ALLOW_DEV_HEADER_AUTH=false` 是强制项。公网不能接受任意客户端传来的 `X-User-Id`。
- `CORS_ORIGINS` 必须仅包含受控前端域名，例如 `https://app.example.com,https://admin.example.com`；不要配置 `*`。
- `LLM_API_KEY` 仅通过部署环境传入容器。绝不能放到 `VITE_*`、前端源码、日志、截图、数据库或 Git。若密钥曾公开，先在供应商控制台吊销再部署。
- 使用同域 Nginx 代理时，前端仍应使用 `/api`；`CORS_ORIGINS` 保留为显式防线和未来独立前端域名兼容。

环境变量模板见 [`server/.env.example`](../server/.env.example)。

## 3. 首次部署

在仓库根目录执行：

```bash
docker compose -f docker-compose.backend.yml build api
docker compose -f docker-compose.backend.yml run --rm api-seed
docker compose -f docker-compose.backend.yml up -d api
curl http://127.0.0.1:3000/api/health
```

`api-seed` 会将 `src/data/` 中的院校、国家线、录取分数、详情、校园 CDN 图片和报考要求导入持久化卷。只在首次初始化或明确更新静态主数据时运行它；升级 API 镜像时无需重复 seed。

查看日志：

```bash
docker compose -f docker-compose.backend.yml logs -f api
```

更新版本：

```bash
git pull
docker compose -f docker-compose.backend.yml build api
docker compose -f docker-compose.backend.yml up -d api
docker compose -f docker-compose.backend.yml ps
```

启动时后端会执行当前数据库建表逻辑。上线前必须先做备份；未来切换为版本化迁移后，应将迁移作为发布流程的独立步骤并记录版本。

## 4. Nginx 反向代理

Compose 将 API 端口绑定在服务器回环地址，外网只通过 Nginx 暴露：

```nginx
server {
  listen 443 ssl http2;
  server_name app.example.com;

  # SSL 由 Certbot 或已有网关管理
  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }

  location / {
    root /var/www/kaoyan-app/dist;
    try_files $uri $uri/ /index.html;
  }
}
```

生产构建不要把 `localhost:3000` 打进前端。使用同域 `/api` 或统一的 `VITE_API_BASE` 封装；Agent 的 Bearer token 只在 HTTPS 请求头中发送，不能出现在 URL。

## 5. 数据备份与恢复

SQLite 数据卷名为 `kaoyan-data`。每日备份示例：

```bash
mkdir -p backups
docker run --rm \
  -v kaoyan-data:/data:ro \
  -v "$PWD/backups":/backup \
  alpine sh -c 'cp /data/kaoyan.db /backup/kaoyan-$(date +%F).db'
```

恢复前先停止 API：

```bash
docker compose -f docker-compose.backend.yml stop api
docker run --rm \
  -v kaoyan-data:/data \
  -v "$PWD/backups":/backup:ro \
  alpine sh -c 'cp /backup/kaoyan-YYYY-MM-DD.db /data/kaoyan.db'
docker compose -f docker-compose.backend.yml start api
```

不要在 API 运行时覆盖数据库文件。每次升级、重新 seed 或修改表结构前都应备份，并定期实际执行恢复演练。

## 6. 上线验收清单

- [ ] `.env` 不在 Git 中，且 `LLM_API_KEY` 已通过密钥管理/服务器环境传入。
- [ ] `ALLOW_DEV_HEADER_AUTH=false`，`CORS_ORIGINS` 为精确域名白名单。
- [ ] `/api/health` 正常，数据卷可写且存在可恢复备份。
- [ ] 注册、登录、`GET /api/auth/me`、退出登录均通过 HTTPS 测试。
- [ ] 未登录调用 `/api/study/*`、`/api/agents/*` 返回 `401`。
- [ ] 提案的生成与应用是两个独立动作；模型失败或用户取消不会写计划。
- [ ] 跨用户读取会话、记忆、提案和学习统计均不可访问。
- [ ] 模型超时/上游错误返回可识别错误并且前端可重试。
- [ ] 访问日志不记录 `Authorization`、密码、模型密钥或完整私密上下文。

## 7. Agent 运维与扩展

当前 Agent 路由包括：

| 接口组 | 用途 |
| --- | --- |
| `/api/auth` | 注册、登录、获取当前用户、退出登录 |
| `/api/study` | 学习时段写入与按周期统计 |
| `/api/agents/context` | 当前计划、学习统计和有效记忆 |
| `/api/agents/memories` | 用户确认的长期偏好/状态 |
| `/api/agents/conversations` | 顾问会话与消息审计 |
| `/api/agents/proposals` | 生成、预览、确认或拒绝计划变更 |

模型只能提出提案；只有用户确认调用 `/apply` 后，后端才写入 `user_study_plans` 或 `user_admission_plans`。不允许模型生成 SQL、任意 URL 调用、文件操作或跨用户数据访问。

下一阶段建议：

1. 增加任务、单词、题目、错题、真题和复习规则等规范业务表，让 Agent 基于真实数据提供建议。
2. 院校和招生信息使用可追溯的真实数据源，保存来源 URL、抓取时间、版本和人工审核状态；结果页面展示更新时间。
3. 接入按用户/IP 的限流、每日模型配额、请求审计、指标与告警。当前单机内存限流不适合多实例。
4. 将数据库迁移到 PostgreSQL，使用 Redis 处理限流、缓存和队列；将 OCR、资料抓取、批量错题分析和通知转至 Worker。
5. 需要流式对话时使用 SSE/WebSocket；流结束后持久化完整消息，计划修改继续保持“提案 → 用户确认 → 应用”的状态机。

完整 API 契约与前端接入方式见 [Agent 开发与部署手册](agent-development-and-deployment.md) 和 [前端 Agent 接口接入](agent-frontend-integration.md)。

## 8. 常用命令

```bash
# 健康检查
curl https://app.example.com/api/health

# 查看容器状态与日志
docker compose -f docker-compose.backend.yml ps
docker compose -f docker-compose.backend.yml logs -f api

# 进入容器排查
docker compose -f docker-compose.backend.yml exec api sh

# 停止服务（不会删除数据库卷）
docker compose -f docker-compose.backend.yml down
```
