# 后端 Docker 部署与 Agent 扩展

本项目后端是 Node.js 24、Express 5 和 `sql.js`（SQLite WASM）。生产环境采用单个 API 实例加持久化数据卷；SQLite 文件位于容器内的 `/app/server/data/kaoyan.db`。

## 1. 部署前提

- 一台 Linux 服务器，建议 Ubuntu 22.04+。
- Docker Engine 24+ 与 Docker Compose v2。
- 域名和 HTTPS 由 Nginx 或现有网关处理。
- 仓库必须包含 `server/`、`src/data/`、`server/data/` 与本目录新增的 Docker 文件。

`sql.js` 会将 SQLite 整库载入内存，写入时再导出文件。因此当前版本只支持一个 API 副本，**不能水平扩容，也不应部署到无持久磁盘的 Serverless 平台**。

## 2. 首次部署

在仓库根目录执行：

```bash
docker compose -f docker-compose.backend.yml build
docker compose -f docker-compose.backend.yml run --rm api-seed
docker compose -f docker-compose.backend.yml up -d api
curl http://127.0.0.1:3000/api/health
```

`api-seed` 会将 `src/data` 的院校、国家线、录取分数、详情、校园 CDN 图片和报考要求完整导入持久化卷。首次导入的预期数量：700 所院校、330 条国家线、1038 条录取分数。

查看日志：

```bash
docker compose -f docker-compose.backend.yml logs -f api
```

更新镜像后：

```bash
git pull
docker compose -f docker-compose.backend.yml build api
docker compose -f docker-compose.backend.yml up -d api
```

只有在确认静态源数据需要重新覆盖数据库时才运行 `api-seed`。它会通过幂等写入更新主数据，但照片表当前没有唯一约束；需要彻底重建时请先备份，再清空卷后导入。

## 3. 数据备份与恢复

SQLite 数据位于 Docker 卷 `kaoyan-data`。每日备份示例：

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

不要在 API 运行时直接覆盖 `.db` 文件。

## 4. Nginx 反向代理

Docker Compose 默认仅将 3000 绑定在服务器回环地址。Nginx 将站点的 `/api/` 转发到该端口：

```nginx
server {
  listen 443 ssl http2;
  server_name app.example.com;

  # SSL 配置由 Certbot 或现有网关管理
  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location / {
    root /var/www/kaoyan-app/dist;
    try_files $uri $uri/ /index.html;
  }
}
```

前端应使用同域 `/api`，避免浏览器跨域。上线前请将前端 API 地址改为构建时环境变量，例如 `VITE_API_BASE=/api` 或空字符串加统一的 `/api` 请求封装；不要把本地 `localhost:3000` 写入生产包。

## 5. 安全与运维清单

- POST `/api/universities` 与 `/api/national-lines` 必须在上线前加入管理员鉴权。
- CORS 必须改为允许的域名白名单，不使用全开放 `cors()`。
- 增加请求体上限、限流、访问日志和健康检查告警。
- 将 `server/`、Docker 文件与数据库迁移脚本纳入 Git；不要提交生产数据库备份或密钥。
- 数据库卷必须有定时备份；升级前先备份，再执行迁移。
- 生产环境使用 `restart: unless-stopped`，并通过 Nginx 提供 HTTPS。

### Agent 环境变量

在服务器的 Compose 同级 `.env` 中配置，不要提交到 Git：

```env
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=replace-with-deepseek-key
AGENT_MODEL=deepseek-chat
```

镜像不会复制 `server/.env`；生产密钥仅通过 Compose 环境变量传给 API 容器。

## 6. 未来 Agent 功能

数据库已预建以下表，当前没有公开 API，不影响择校功能：

| 表 | 用途 |
| --- | --- |
| `users` / `user_favorites` | 账号与院校收藏同步 |
| `study_sessions` | 计时器、学习统计、计划调整依据 |
| `agent_conversations` | Agent 会话及其上下文 |
| `agent_messages` | 用户、模型、工具消息审计 |
| `agent_memories` | 长期偏好、目标院校和复习状态 |

建议新增 Agent 时采用独立路由，例如 `/api/agents/study-plan`、`/api/agents/error-analysis`，并遵循：

1. 先校验登录用户，再读取其学习数据与记忆；不可把其他用户数据带入模型上下文。
2. 模型密钥只放在服务器环境变量，不进入前端和数据库。
3. 记录请求元数据、模型版本和工具调用结果；敏感内容加密或最小化保存。
4. 长任务使用队列或后台 Worker；不要让 Express 请求长期占用。
5. 需要并发扩容、向量检索或高频 Agent 写入时，再迁移到 PostgreSQL + Redis/队列；当前 SQLite 适合 MVP 单实例。

当前已提供的 MVP 提案接口：

| 接口 | 作用 |
| --- | --- |
| `POST /api/agents/proposals` | 调用模型生成院校或学习计划提案；不改业务数据 |
| `GET /api/agents/proposals` | 获取当前用户的提案历史 |
| `POST /api/agents/proposals/:id/apply` | 用户确认后应用提案 |
| `POST /api/agents/proposals/:id/reject` | 拒绝待确认提案 |

当前接口临时以 `X-User-Id` 定位用户，正式上线前必须替换为 JWT 鉴权中间件；未提供身份时接口会拒绝请求。

## 7. 常用命令

```bash
# 健康检查
curl https://app.example.com/api/health

# 查看 API 容器
docker compose -f docker-compose.backend.yml ps

# 进入容器排查
docker compose -f docker-compose.backend.yml exec api sh

# 停止服务（不会删除数据库卷）
docker compose -f docker-compose.backend.yml down
```
