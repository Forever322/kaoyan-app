# 后端 Docker + MySQL 部署手册

生产环境由 Nginx、API 与 MySQL 组成。API 通过 Docker 内部网络访问 MySQL；MySQL 的 `3306` **绝不映射到宿主机或公网**。

```text
浏览器 / App ─HTTPS→ Nginx ─→ 127.0.0.1:3000 (api) ─Docker network→ mysql:3306
```

原先的 `sql.js` 卷只作为一次性历史数据导入源保留。新运行数据、用户、登录令牌、学习记录、Agent 会话和计划均存入 MySQL。MySQL 解决了文件数据库的并发写入限制；但当前 Agent 限流仍为单进程内存实现，正式环境仍建议先运行一个 `api` 副本，待接入 Redis 后再横向扩容。

## 1. 目录与服务

部署目录需要包含：

```text
docker-compose.backend.yml
.env                         # 服务器私有配置，不提交 Git
server/Dockerfile
kaoyan-api:2026.08.09-mysql.1 # 已构建或离线导入的 API 发布镜像
```

Compose 服务说明：

| 服务 | 作用 | 常驻 |
| --- | --- | --- |
| `mysql` | MySQL 8.4 LTS，持久化正式数据 | 是 |
| `api` | Node/Express API，仅绑定 `127.0.0.1:3000` | 是 |
| `api-migrate` | 版本化 MySQL DDL 迁移，使用锁避免并发迁移 | 否，显式运行 |
| `api-seed` | 新库/受控更新时导入院校参考数据 | 否，显式运行 |
| `api-import-sqljs` | 从旧 `kaoyan-data` 卷导入历史数据；可覆盖命令做只读预览 | 否，一次性 |

`api` **不会自动执行迁移**。发布流程必须先运行 `api-migrate`，这样多副本或重启不会发生 DDL 竞态。`API_IMAGE` 使用明确的发布标签（例如 `kaoyan-api:2026.08.09-mysql.1`），不要依赖会被覆盖的 `latest`。

## 2. 生产环境变量

在仓库根目录复制模板：

```bash
cp .env.example .env
chmod 600 .env
```

Windows 命令提示符可使用：

```cmd
copy .env.example .env
```

编辑根目录 `.env`，至少修改以下值：

```env
CORS_ORIGINS=https://kaoyan.dfnbxjj688.xyz

MYSQL_IMAGE=mysql:8.4
API_IMAGE=kaoyan-api:2026.08.09-mysql.1
MYSQL_DATABASE=kaoyan
MYSQL_USER=kaoyan_app
MYSQL_PASSWORD=replace-with-a-unique-random-app-password
MYSQL_ROOT_PASSWORD=replace-with-a-different-random-root-password
MYSQL_CONNECTION_LIMIT=10
MYSQL_MIGRATION_LOCK_TIMEOUT_SECONDS=60

LLM_API_KEY=replace-with-your-server-side-key
```

在服务器上可用以下命令生成两个不同的密码，再手动粘贴到 `.env`：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

约束：

- `MYSQL_ROOT_PASSWORD` 只给 MySQL 初始化和运维备份/恢复使用；API 绝不接收它。
- `MYSQL_PASSWORD` 是 `kaoyan_app` 这个业务数据库用户的密码；不要使用 root 账号运行 API。
- `MYSQL_MIGRATION_LOCK_TIMEOUT_SECONDS` 是一次性迁移获取 MySQL schema 锁的最长等待时间；锁只是保护措施，发布流程仍应保证同一时刻只运行一个迁移任务。
- 密码建议使用十六进制随机值，避免在 Compose `.env` 中出现 `#`、换行或未转义的 `$`。
- `CORS_ORIGINS` 必须是精确的 HTTPS 来源，不能使用 `*`。
- `ALLOW_DEV_HEADER_AUTH=false` 是生产强制项。浏览器不能通过 `X-User-Id` 冒充用户。
- `LLM_API_KEY`、数据库密码、`DATA_ADMIN_TOKEN` 不得提交 Git、写入 `VITE_*`、前端包、截图或日志。已泄露的模型密钥应先在供应商控制台吊销。

根目录模板为 [`.env.example`](../.env.example)，本机直接运行后端时可参考 [`server/.env.example`](../server/.env.example)。

## 3. 无法访问 Docker Hub 时的离线镜像导入

服务器无法拉取 Docker Hub 时，不要在服务器运行 `docker compose build` 或 `docker pull`。在能访问 Docker Hub 的开发机先保存两份 Linux AMD64 镜像，再上传到服务器。镜像标签必须与 `.env` 中的 `MYSQL_IMAGE` 一致。

### 3.1 Windows 开发机（cmd）

```cmd
cd C:\Users\zqimi\OneDrive\Desktop\git\kaoyan-app

docker build --platform linux/amd64 -f server/Dockerfile -t kaoyan-api:2026.08.09-mysql.1 .
docker pull --platform linux/amd64 mysql:8.4

docker save -o kaoyan-api-2026.08.09-mysql.1-linux-amd64.tar kaoyan-api:2026.08.09-mysql.1
docker save -o mysql-8.4-linux-amd64.tar mysql:8.4

certutil -hashfile kaoyan-api-2026.08.09-mysql.1-linux-amd64.tar SHA256
certutil -hashfile mysql-8.4-linux-amd64.tar SHA256

scp kaoyan-api-2026.08.09-mysql.1-linux-amd64.tar mysql-8.4-linux-amd64.tar root@123.57.20.28:/opt/
```

若通过域名 SSH，请先确认该域名解析到目标服务器且 SSH 主机指纹正确，再将最后一行中的 IP 换为域名。不要为了上传镜像关闭 SSH 主机指纹校验。

### 3.2 Ubuntu 服务器

```bash
cd /opt
sha256sum kaoyan-api-2026.08.09-mysql.1-linux-amd64.tar mysql-8.4-linux-amd64.tar

docker load -i kaoyan-api-2026.08.09-mysql.1-linux-amd64.tar
docker load -i mysql-8.4-linux-amd64.tar

docker image inspect kaoyan-api:2026.08.09-mysql.1 --format '{{.Os}}/{{.Architecture}}'
docker image inspect mysql:8.4 --format '{{.Os}}/{{.Architecture}}'
```

两个校验和必须与开发机输出一致，架构应为 `linux/amd64`。镜像更新时重复“开发机保存 → 上传 → 校验 → `docker load`”流程；不需要也不应在服务器上重新构建 API。

## 4. 全新 MySQL 部署

以下命令在服务器项目目录运行：

```bash
cd /opt/kaoyan-app
chmod 600 .env
docker compose -f docker-compose.backend.yml config --quiet

# 先启动并等待数据库健康
docker compose -f docker-compose.backend.yml up -d mysql
docker compose -f docker-compose.backend.yml ps

# 迁移是幂等的一次性任务；每次发布新版本时先执行它。
docker compose -f docker-compose.backend.yml --profile tools run --rm api-migrate

# 只给空库或明确的数据更新运行；不要把它放进每次启动脚本。
docker compose -f docker-compose.backend.yml --profile tools run --rm api-seed

# 最后启动 API
docker compose -f docker-compose.backend.yml up -d api
docker compose -f docker-compose.backend.yml ps
curl -i http://127.0.0.1:3000/api/health
```

`mysql` 的健康检查通过后，`api` 才会启动。API 镜像自身也会探测 `/api/health`；首次启动后等待约 20 秒，再使用 `docker compose ... ps` 查看健康状态。

新库首次部署只运行一次 `api-seed`。以后仅在明确更新静态院校/分数线数据且确认脚本幂等时再运行它，绝不在容器启动命令中自动 seed。

## 5. 从现有 sql.js 升级到 MySQL

升级不会删除旧 `kaoyan-data` 卷。导入器会保留用户、认证令牌哈希、学习记录、计划、Agent 会话/消息/提案及参考数据的 ID；导入前必须先完成 MySQL schema migration。

1. 先按第 3 节加载包含 MySQL 支持的新 API 镜像和 `mysql:8.4` 镜像，并更新项目里的 Compose 文件和 `.env`。
2. 停止旧 API，使用已加载的 API 镜像备份旧数据库文件（不依赖服务器拉取 `alpine`）：

```bash
cd /opt/kaoyan-app
docker compose -f docker-compose.backend.yml stop api
mkdir -p backups
chmod 700 backups

docker compose -f docker-compose.backend.yml --profile tools run --rm --no-deps \
  -v "$PWD/backups":/backup \
  api-import-sqljs \
  sh -ec 'test -s /legacy/kaoyan.db && cp /legacy/kaoyan.db /backup/kaoyan-legacy-$(date +%F-%H%M%S).db'
```

3. 启动新数据库、执行迁移，再先进行只读预览（此命令覆盖服务默认的 `--apply`）：

```bash
docker compose -f docker-compose.backend.yml up -d mysql
docker compose -f docker-compose.backend.yml --profile tools run --rm api-migrate
docker compose -f docker-compose.backend.yml --profile tools run --rm \
  api-import-sqljs node scripts/import-sqljs-to-mysql.js --source /legacy/kaoyan.db
```

4. 核对预览中的表计数、源文件路径和目标库后，运行预设了 `--apply` 的一次性导入服务：

```bash
docker compose -f docker-compose.backend.yml --profile tools run --rm api-import-sqljs
```

5. 导入器会保留业务数据；旧 sql.js 中缺少的新参考字段由幂等 seed 补齐。导入成功后运行一次：

```bash
docker compose -f docker-compose.backend.yml --profile tools run --rm api-seed
```

6. 启动 API 并验收：

```bash
docker compose -f docker-compose.backend.yml up -d api
curl -i http://127.0.0.1:3000/api/health
```

历史导入完成后应运行一次 `api-seed`：它以 `src/data/` 为准幂等更新参考院校数据，补齐旧库没有的字段，不会覆盖用户、计划、学习记录或 Agent 数据。之后除非明确更新静态参考数据，否则不要在每次 API 启动时运行 seed。

保留旧卷和第 2 步生成的 `.db` 备份，至少等登录、学习统计、Agent 对话和院校详情都完成验收后再决定归档期限。不要使用 `docker compose down -v`。

## 6. 日常发布与数据库迁移

每个 API 版本发布建议遵循：

```bash
cd /opt/kaoyan-app

# 先完成第 7 节备份，再加载 .env 中 API_IMAGE 指定的新发布镜像。
docker compose -f docker-compose.backend.yml --profile tools run --rm api-migrate
docker compose -f docker-compose.backend.yml up -d --no-deps --force-recreate api
docker compose -f docker-compose.backend.yml ps
curl -fsS http://127.0.0.1:3000/api/health
```

迁移工具应只追加新的版本化迁移，记录在 `schema_migrations` 中。禁止在自动迁移里执行未备份的删表/删列；需要数据回填、长耗时索引或大版本改造时，应提供独立、可恢复、可观测的运维任务。

## 7. MySQL 备份与恢复

数据库中包含用户数据和令牌哈希，备份文件按敏感数据处理：目录权限至少 `700`，文件权限至少 `600`，并复制到服务器外的加密存储。

### 7.1 创建逻辑备份

```bash
cd /opt/kaoyan-app
mkdir -p backups
chmod 700 backups

backup_file="backups/mysql-$(date +%F-%H%M%S).sql.gz"
docker compose -f docker-compose.backend.yml exec -T mysql \
  sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --events --triggers --default-character-set=utf8mb4 --databases "$MYSQL_DATABASE"' \
  | gzip -9 > "$backup_file"
chmod 600 "$backup_file"
gzip -t "$backup_file"
sha256sum "$backup_file"
```

`--single-transaction` 适用于当前 InnoDB 表，可在 API 继续提供读写时得到一致性快照。大数据量或文件附件上线后，应增加定时任务、异地保留策略和恢复演练，不要只依赖单个服务器磁盘。

### 7.2 覆盖恢复

恢复会替换当前数据库内容。先在测试环境验证备份可用，确认文件名无误后再操作：

```bash
cd /opt/kaoyan-app
restore_file="backups/mysql-YYYY-MM-DD-HHMMSS.sql.gz"
test -r "$restore_file"
gzip -t "$restore_file"

docker compose -f docker-compose.backend.yml stop api

# 清空并重建业务库；不会删除 MySQL 用户、镜像或 Docker 卷。
docker compose -f docker-compose.backend.yml exec -T mysql \
  sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "DROP DATABASE IF EXISTS \`$MYSQL_DATABASE\`; CREATE DATABASE \`$MYSQL_DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"'

gzip -dc "$restore_file" | docker compose -f docker-compose.backend.yml exec -T mysql \
  sh -ec 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot'

# 若 API 已升级到更新版本，恢复后补跑向前兼容迁移。
docker compose -f docker-compose.backend.yml --profile tools run --rm api-migrate
docker compose -f docker-compose.backend.yml up -d api
curl -fsS http://127.0.0.1:3000/api/health
```

不要通过复制 `/var/lib/mysql` 中的单个文件恢复，也不要在 MySQL 正在运行时覆盖卷内容。`docker compose down` 不会删卷；`docker compose down -v` 会删除 `mysql-data`，生产环境禁止使用。

## 8. Nginx 反向代理与公网验收

Nginx 只代理 API，MySQL 不添加 Nginx location：

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 60s;
}
```

检查：

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -i https://kaoyan.dfnbxjj688.xyz/api/health
docker compose -f docker-compose.backend.yml ps
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

最后一条中只能看到 API 的 `127.0.0.1:3000->3000/tcp`，不应出现 MySQL 的 `0.0.0.0:3306` 或 `[::]:3306`。防火墙只需允许 SSH、HTTP 和 HTTPS。

## 9. 生产与后续扩展清单

- [ ] 根目录 `.env` 不在 Git，且文件权限为 `600`。
- [ ] `MYSQL_ROOT_PASSWORD` 与 `MYSQL_PASSWORD` 不同，MySQL `3306` 未公开。
- [ ] 已验证 `mysql` 与 API 的健康检查，公网 `https://…/api/health` 返回 `200`。
- [ ] 每次发布前有 MySQL 逻辑备份，并定期做恢复演练。
- [ ] 已完成迁移/导入后验收注册、登录、`GET /api/auth/me`、学习记录、计划版本冲突和 Agent 提案确认。
- [ ] 参考数据写接口保持关闭，除非受控运维任务携带 `X-Data-Admin-Token`。
- [ ] 新增业务功能时通过新 migration 增表/增索引；不直接手改生产表。

建议的下一阶段：将 Agent 限流、队列和缓存转到 Redis；把 OCR、资料抓取、批量分析和通知放到 Worker；图片/附件移入对象存储；需要检索资料时可在 MySQL 旁增加专用向量检索服务。保持 API 契约和“提案 → 用户确认 → 应用”的状态机不变，即可在不影响前端的前提下逐步演进。

Agent 的接口安全约束与前端接入细节见 [Agent 开发与部署手册](agent-development-and-deployment.md) 和 [前端 Agent 接口接入](agent-frontend-integration.md)。
