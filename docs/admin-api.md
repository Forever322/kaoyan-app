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
| `GET /api/admin/database/tables/:table/rows?page=1&pageSize=50&keyword=&orderBy=&orderDir=` | 直接分页查看单表数据；敏感列会脱敏；仅 `super_admin`。 |
| `POST /api/admin/database/tables/:table/rows` | 插入一行 `{ "row": {...} }`；拒绝系统表、自动列和敏感列；仅 `super_admin`。 |
| `PATCH /api/admin/database/tables/:table/rows/:id` | 按单字段主键更新一行 `{ "row": {...} }`；仅 `super_admin`。 |
| `DELETE /api/admin/database/tables/:table/rows/:id` | 按单字段主键删除一行；系统表不可删；仅 `super_admin`。 |
| `GET /api/admin/database/tables/:table/export?format=csv\|txt\|sql\|xlsx&limit=5000` | 导出表数据，支持 CSV、TAB 分隔 TXT、INSERT SQL、XLSX；敏感列不导出；仅 `super_admin`。 |
| `POST /api/admin/database/tables/:table/import` | 导入 CSV、TAB 分隔 TXT、受限 INSERT SQL、XLSX、SQLite/sql.js DB 或 `rows` 数组；默认 `dryRun=true` 只解析预览；仅 `super_admin`。 |
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

直接数据库工作台用于受控运维和批量数据治理，不替代领域接口。`admin` 只能查看数据库状态，只有 `super_admin` 可以查看表数据、导入导出和增删改。`schema_migrations`、`admin_audit_logs`、`auth_tokens` 等系统表不允许通过网页写入；字段名包含 `password`、`token`、`secret`、`apiKey`、`credential` 等敏感含义时，查询和导出会脱敏，写入会被拒绝。

数据库工作台预留固定的 `database-manager` 后台 Agent。它用于导入预审、重复记录检测、字段异常识别、表间一致性核对和修复计划生成；默认配置为 `writeAccess=false`、`requiresHumanConfirmation=true`，模型不得直接写入生产数据库。上线小模型后，应让它复用 `dryRun` 导入结果或只读表摘要输出审核报告，再由超级管理员在后台确认落库。

导入请求示例：

```json
{
  "format": "csv",
  "dryRun": true,
  "mode": "insert",
  "content": "name,province,city,zone,level,type\n测试大学,北京,北京,A,双非,综合\n"
}
```

`dryRun` 默认是 `true`，只返回字段解析结果、前 10 行预览、行数和校验摘要；显式传 `false` 才会落库。`mode` 支持 `insert` 和 `upsert`。XLSX 与 DB 使用 `contentBase64` 承载文件内容；DB 默认读取同名源表，也可传 `sourceTable` 指定源表。也可以直接传结构化 `rows: [{...}]`。当前导入结果会返回 `review.modelReady=false` 的固定审核挂点；后续服务器小模型可以复用 dry-run 结果，对来源、重复记录、异常字段和疑似错误数据做二次审核后再允许落库。

## 智能体控制实际生效方式

- 停用某个 `agent_configurations` 记录后，该智能体的新建会话、继续对话和生成方案都会在调用模型前被服务器拒绝。
- `agent-kaoyan-coach` 控制考研学习顾问；`agent-proposals` 控制所有“待确认方案”生成。灰度比例按用户 ID 稳定分桶，不会在同一用户的每次访问间随机跳变。
- 模型名称、服务商地址、超时和 API Key 只由服务器 `.env` 管理，管理后台无读取或修改入口。
- `admin-console` 是服务器级紧急开关，不允许从网页关闭或恢复；若运维人员通过数据库暂停它，后台 API 会拒绝访问，必须在服务器完成受控恢复。

## 院校资料写入边界

院校、专业、招生计划和来源文件应使用官方招生简章、专业目录或校方公开页面作为依据。`verificationStatus` 只能表达核验状态，不能替代真实来源；任何不确定或过期数据都应保留为 `pending` / `needs_review`，并在数据治理队列中处理。后台会为新增、修改和归档写入 `catalog_change_log` 与 `admin_audit_logs`，不会在审计中保存密码、令牌或模型密钥。
