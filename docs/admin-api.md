# 管理后台 API 与初始化说明

管理站前端放在 `/admin/`，使用与 App 相同的账号体系。先调用 `POST /api/auth/login`，再把响应中的 `accessToken` 放入每一个后台请求：

```http
Authorization: Bearer <accessToken>
```

后台接口不会接受本地开发用的 `X-User-Id`，也不会返回密码哈希、登录令牌哈希、LLM API Key 或运行时服务商配置。

## 初始化第一个管理员

1. 先在 App 注册一个普通账号，例如 `admin_name`。
2. 在服务器 `/opt/kaoyan-app/.env` 临时追加一组高强度随机值：

```dotenv
ADMIN_BOOTSTRAP_USERNAME=admin_name
ADMIN_BOOTSTRAP_TOKEN=至少32位的随机字符串
```

3. 部署包含 migration `004-admin-rbac-and-agent-controls` 的镜像后执行：

```bash
cd /opt/kaoyan-app
docker compose -f docker-compose.backend.yml --profile tools run --rm \
  -e ADMIN_BOOTSTRAP_CONFIRM_TOKEN="$ADMIN_BOOTSTRAP_TOKEN" \
  api-admin-bootstrap
```

4. 命令成功后，该账号成为 `super_admin`，所有旧登录令牌被撤销；重新登录后才可进入 `/admin/`。
5. 从 `.env` 删除 `ADMIN_BOOTSTRAP_USERNAME` 和 `ADMIN_BOOTSTRAP_TOKEN`，再重启或重建 Compose 服务。该工具不会暴露 HTTP 初始化接口。

角色约束：

- `user`：普通 App 用户。
- `admin`：可以查看用户、数据库健康、审计和智能体设置，维护院校资料，并且只能调整普通用户的账号状态。
- `super_admin`：由受控 CLI 初始化；可以将普通用户提升为 `admin`，且是唯一能修改全局智能体配置和功能开关的角色。HTTP API 不能创建或修改 `super_admin`，避免后台账户被横向提权。

账号状态为 `suspended` 或 `disabled` 时，登录和受保护 API 会被拒绝；管理后台修改为非 `active` 后会撤销该用户现有令牌。

## 接口契约

所有以下接口都要求管理员 Bearer Token。

| 接口 | 用途 |
| --- | --- |
| `GET /api/admin/dashboard` | 用户、院校库、智能体运行和开关的聚合指标。 |
| `GET /api/admin/database/status` | 只读数据库名称、MySQL 版本、迁移状态及各表容量估算。 |
| `GET /api/admin/database/tables/:table/schema` | 查看单表字段、主键、可写状态和敏感列标记；仅 `super_admin`。 |
| `GET /api/admin/database/tables/:table/rows?page=1&pageSize=50&keyword=&orderBy=&orderDir=` | 直接分页查看院校目录/治理只读白名单表；用户私密表与控制表拒绝通用浏览；仅 `super_admin`。 |
| `POST /api/admin/database/tables/:table/rows` | 插入一行 `{ "row": {...} }`；仅允许院校参考数据白名单，拒绝控制表、自动列和敏感列；仅 `super_admin`。 |
| `PATCH /api/admin/database/tables/:table/rows/:id` | 按单字段主键更新一行 `{ "row": {...} }`；仅 `super_admin`。 |
| `DELETE /api/admin/database/tables/:table/rows/:id` | 仅允许少量叶子参考表硬删除；院校等主实体必须走归档接口；仅 `super_admin`。 |
| `GET /api/admin/database/tables/:table/export?format=csv\|txt\|sql\|xlsx&limit=5000` | 导出表数据，支持 CSV、TAB 分隔 TXT、INSERT SQL、XLSX；敏感列不导出；仅 `super_admin`。 |
| `POST /api/admin/database/tables/:table/import` | 兼容导入预览，仅接受 `dryRun=true`；实际写入必须经过下面的 Agent 审核任务。 |
| `POST /api/admin/database-agent/reviews` | 将口述文本或 CSV/TXT/JSON/SQL/XLSX/DB 文件解析为持久化待审任务；`table` 可留空由 Agent 在可写白名单表内自动识别，随后执行规则、联网证据和模型内容审核；仅 `super_admin`。 |
| `GET /api/admin/database-agent/jobs?page=1&pageSize=20&status=` | 查询审核队列与前 20 行脱敏预览；仅 `super_admin`。 |
| `GET /api/admin/database-agent/jobs/:id` | 查询单个审核任务、风险项、checksum 和状态。 |
| `GET /api/admin/database-agent/jobs/:id/export` | 下载完整暂存 JSON，用于核对界面预览之外的全部行；仅 `super_admin`。 |
| `POST /api/admin/database-agent/jobs/:id/apply` | 提交 `{ "checksum": "...", "rowCount": 1 }`；再次校验规则、行数、策略版本和数据库快照后事务写库。 |
| `POST /api/admin/database-agent/jobs/:id/reject` | 驳回待确认或已阻断任务。 |
| `GET /api/admin/database-agent/runs` | 数据抽取与内容审核的模型运行日志；仅 `super_admin`。 |
| `GET /api/admin/access-logs` | 管理后台访问日志；不保存 query、正文或令牌，IP 会掩码/哈希；仅 `super_admin`。 |
| `GET /api/admin/alerts?status=open&severity=` | 站内自动告警列表；仅 `super_admin`。 |
| `PATCH /api/admin/alerts/:id` | 将告警设为 `open`、`acknowledged` 或 `resolved`；仅 `super_admin`。 |
| `GET /api/admin/universities?page=1&pageSize=20&keyword=&catalogStatus=` | 管理端院校分页列表；可包含已归档记录。 |
| `GET /api/admin/universities/:id` | 返回院校基础档案、详情和关联资料计数。 |
| `POST /api/admin/universities` | 创建院校及可选 `detail` 档案。 |
| `PATCH /api/admin/universities/:id` | 更新院校、核验状态、来源信息与详情档案。 |
| `DELETE /api/admin/universities/:id` | 归档院校；不会物理删除收藏、录取数据或审计历史。恢复时使用 `PATCH` 将 `catalogStatus` 设回 `active`。 |
| `GET /api/admin/users?page=1&pageSize=20&role=&status=&keyword=` | 用户分页列表；仅返回安全用户 DTO。 |
| `PATCH /api/admin/users/:id` | 更新 `{ "role": "user\|admin", "status": "active\|suspended\|disabled" }`。 |
| `GET /api/admin/agent-configurations` | 固定、审核过的智能体配置列表。 |
| `PATCH /api/admin/agent-configurations/:key` | 更新 `displayName`、`description`、`enabled`、`settings`。 |
| `GET /api/admin/feature-flags` | 固定功能开关列表。 |
| `PATCH /api/admin/feature-flags/:key` | 更新 `displayName`、`description`、`enabled`、`rolloutPercentage`、`audience`。 |
| `GET /api/admin/catalog/issues?page=1&pageSize=20&status=&severity=` | 院校数据治理问题队列。 |
| `PATCH /api/admin/catalog/issues/:id` | 将问题标记为 `open`、`resolved` 或 `ignored`。 |
| `GET /api/admin/audit?page=1&pageSize=20&actorUserId=&action=&resourceType=` | 管理操作审计日志。 |

`pageSize` 范围为 1–100。用户、审计接口均返回：

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 0,
  "totalPages": 0,
  "data": []
}
```

智能体配置和功能开关没有 `POST`/`DELETE` 接口：键由数据库迁移预置并经过代码审核，后台只能修改安全的元数据和启用状态。`settings`/`audience` 会拒绝 `token`、`secret`、`password`、`apiKey`、`provider`、`model`、`baseUrl` 等敏感或运行时连接字段。

每次用户权限、智能体配置、功能开关变更都会写入 `admin_audit_logs`，审计快照会再次脱敏后返回。

## 数据库工作台边界

直接数据库工作台用于受控运维和批量数据治理，不替代领域接口。`admin` 只能查看数据库状态；`super_admin` 也只能浏览院校目录与治理只读白名单，用户正文、令牌、Agent 配置、功能开关、审计、任务和告警必须走专用安全 DTO。通用写入另有更小的院校参考数据白名单，来源、核验、目录状态、自动列和控制字段均由服务端管理。所有直接目录变更同时写 `catalog_change_log` 与管理审计。

`database-manager` 后台 Agent 已接入自然语言抽取、文件解析、自动目标表识别、严格类型/枚举/范围检查、批内与库内重复检测、外键一致性检查、可选公网资料核验和模型语义审核。`writeAccess=false` 与 `requiresHumanConfirmation=true` 是服务端不可关闭的安全边界：模型只能产生结构化待审行，不能产生 SQL 或直接写库。服务端先以短事务建立来源/批次证据；超级管理员确认同一份 64 位 checksum 和行数后，apply 会锁定唯一键、复核数据库快照与当前策略，再以显式 INSERT/UPDATE 在单个事务中写入业务数据、完整 before/after 变更日志、批次状态和管理员审计。

口述审核请求示例：

```json
{
  "table": "",
  "sourceType": "voice",
  "mode": "insert",
  "instruction": "新增测试大学，位于北京，A区，双非，综合类。",
  "webSearch": true
}
```

`table` 留空时，服务端先使用字段覆盖率、唯一键、必填列和考研业务语义线索选择目标表；无法可靠判断时，再让模型只能在可写表白名单内选择，并把 `tableSelection` 写入审核 JSON。文件请求增加 `format`、`sourceName` 与 `content`/`contentBase64`；XLSX、DB 使用 Base64，DB 可用 `sourceTable` 指定源表。SQL/DB 文件若包含多个源表，仍需要人工指定源表或拆分文件，避免把跨表数据错误合并成一个任务。

`webSearch=true` 只是允许本次任务使用联网证据；实际出站能力必须由服务器环境开启：

```dotenv
ADMIN_AGENT_WEB_RESEARCH_ENABLED=true
ADMIN_AGENT_WEB_SEARCH_PROVIDER=generic # generic / bing / brave / serper
ADMIN_AGENT_WEB_SEARCH_ENDPOINT=https://search.example.com/api?q={query}
ADMIN_AGENT_WEB_SEARCH_API_KEY=server-side-secret
ADMIN_AGENT_WEB_FETCH_ALLOWED_HOSTS=yz.chsi.com.cn,edu.cn
```

`websearch` 只读取 JSON 搜索结果，`webfetch` 只抓取 HTTP(S) 公网页面摘要，并拒绝 localhost、内网/保留 IP、内部域名、超时、超大小和危险重定向。联网结果以 `review.webEvidence` 形式保存为审核参考；它不会把资料标记为 verified，也不会绕过人工确认。

`sourceType` 支持 `text`、`voice`（浏览器先转为可编辑文字）和 `file`。单任务默认最多 500 行；硬规则检查全部行，模型对大批次按首尾均匀抽取最多 50 行进行语义审核，界面会明确提示并提供完整 JSON 下载。只有 `status=awaiting_confirmation` 才可 apply；模型调用失败会阻断而不是降级放行。任务默认 24 小时过期，暂存原文/行会清除，关联批次与来源同步归档，但有界审核证据会保留。

管理访问日志由服务端生成 request ID，只记录操作者、方法、无查询字符串的路径、状态码、耗时、最小化 IP 和 User-Agent；不会记录 Authorization、请求正文、口述原文或导入文件，默认保留 90 天。告警目前为超级管理员站内队列，覆盖审核阻断、语义审核失败、Agent 落库失败和已认证管理接口的 5xx；启动与每小时对账会补建事务后意外漏写的任务告警。邮件/Webhook 投递可在后续通过 Outbox 扩展。

## 智能体控制实际生效方式

- 停用某个 `agent_configurations` 记录后，该智能体的新建会话、继续对话和生成方案都会在调用模型前被服务器拒绝。
- `agent-kaoyan-coach` 控制考研学习顾问；`agent-proposals` 控制所有“待确认方案”生成。灰度比例按用户 ID 稳定分桶，不会在同一用户的每次访问间随机跳变。
- `agent-database-manager` 控制后台数据审核与确认流程；关闭配置或开关后，会在模型调用和写库前由服务器拒绝。
- 模型名称、服务商地址、超时和 API Key 只由服务器 `.env` 管理，管理后台无读取或修改入口。
- `admin-console` 是服务器级紧急开关，不允许从网页关闭或恢复；若运维人员通过数据库暂停它，后台 API 会拒绝访问，必须在服务器完成受控恢复。

## 院校资料写入边界

院校、专业、招生计划和来源文件应使用官方招生简章、专业目录或校方公开页面作为依据。`verificationStatus` 只能表达核验状态，不能替代真实来源；任何不确定或过期数据都应保留为 `pending` / `needs_review`，并在数据治理队列中处理。后台会为新增、修改和归档写入 `catalog_change_log` 与 `admin_audit_logs`，不会在审计中保存密码、令牌或模型密钥。
