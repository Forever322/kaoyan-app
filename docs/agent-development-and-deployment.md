# 考研 Agent 开发与部署手册

本文档说明当前 Agent 后端的边界、接口契约和后续扩展方式。后端位于 `server/`，使用 Node.js、Express、MySQL 8.4 与兼容 OpenAI Chat Completions 的模型服务（默认 DeepSeek）。旧 `sql.js` 文件仅用于一次性历史数据导入，不再作为运行数据库。

## 1. 当前闭环

```text
登录 → 记录学习数据 / 保存偏好 → 发起顾问对话或生成提案
     → 预览提案 → 用户确认应用 → 后端写入计划
```

模型不能直接修改任何用户数据。它只能返回经过后端校验的提案；只有用户调用 `POST /api/agents/proposals/:id/apply` 后，系统才会更新院校方案或学习计划。

当前已提供：

| 能力 | 接口组 | 说明 |
| --- | --- | --- |
| 账号与令牌 | `/api/auth` | 注册、登录、当前用户、退出登录；服务端保存 Bearer 令牌哈希 |
| 院校收藏 | `/api/favorites` | 当前账号的院校收藏，按 `(user_id, university_id)` 唯一且可跨设备同步 |
| 学习记录 | `/api/study` | 写入学习时段与按学科汇总，供统计和 Agent 使用 |
| Agent 上下文 | `/api/agents/context` | 当前计划、近 30 天学习统计和有效记忆 |
| 长期记忆 | `/api/agents/memories` | 偏好、目标、学习状态、反馈等可控保存 |
| 顾问对话 | `/api/agents/conversations` | 创建会话、读取消息、向模型发送消息并保存回复 |
| 计划提案 | `/api/agents/proposals` | 生成、查看、确认应用或拒绝；提案和实际写入分离 |

### 考研复习规划教练

`kaoyan-coach` 是当前正式接入的专用对话类型。它将已审核的 `kaoyan-coach-zh@1.0.0` 工作流固化在 [`server/src/services/kaoyan-coach-policy.js`](../server/src/services/kaoyan-coach-policy.js)：目标拆解、科目规划、周计划、错题复盘和冲刺策略。

- 部署的 API **不会**读取 Codex 本机技能目录，也不会在 Docker 中执行技能文件；策略是版本化源码，便于审计、回滚和测试。
- 服务端只为当前 Bearer 用户读取计划、近 30 天学习统计、已确认记忆和最多 12 所收藏院校摘要；模型没有 MySQL 凭据、SQL 工具或写库权限。
- 信息不足时，教练返回 3–6 个结构化追问；信息足够时才允许生成待确认的学习/报考提案。
- 该策略的来源与 MIT 许可见 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。它不是实时招生政策来源；涉及招生、分数线等信息仍需以院校官网和研招网为准。

## 2. 认证与安全边界

所有 `/api/auth` 之外的学习和 Agent 接口均要求：

```http
Authorization: Bearer <accessToken>
```

`POST /api/auth/register` 与 `/api/auth/login` 会返回随机访问令牌和过期时间。数据库仅保存令牌的 SHA-256 哈希；退出登录会撤销当前令牌。当前实现是可撤销的服务端 Bearer token，不是 JWT；未来可在不改变前端 `Authorization` 头的前提下替换为 JWT、OAuth 或手机验证码登录。

为了兼容旧前端，本地开发时可临时传入 `X-User-Id`。**生产环境必须设置 `ALLOW_DEV_HEADER_AUTH=false`**，此时没有有效 Bearer token 的请求会收到 `401`。不要信任浏览器传入的用户 ID。

模型密钥只能存在于服务端环境变量或密钥管理服务。不得写入 Vite 环境变量、前端包、设计稿、数据库字段、接口响应或日志；泄露过的密钥应立即在模型平台吊销并更换。

## 3. 环境变量

服务器部署时，在 Compose 同级的 `.env` 中配置（该文件不提交 Git）：

```env
NODE_ENV=production
PORT=3000
CORS_ORIGINS=https://app.example.com
ALLOW_DEV_HEADER_AUTH=false
AUTH_TOKEN_TTL_DAYS=90
DB_DRIVER=mysql
RUN_MIGRATIONS_ON_START=false
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_DATABASE=kaoyan
MYSQL_USER=kaoyan_app
MYSQL_PASSWORD=replace-with-a-random-app-password
MYSQL_CONNECTION_LIMIT=10
MYSQL_MIGRATION_LOCK_TIMEOUT_SECONDS=60
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

- `CORS_ORIGINS`：用英文逗号分隔的允许来源，例如 `https://app.example.com,https://admin.example.com`。同域部署也建议显式填写正式域名。
- `ALLOW_DEV_HEADER_AUTH`：仅本机联调可为 `true`；服务器固定为 `false`。
- `AUTH_TOKEN_TTL_DAYS`：访问令牌有效天数；缩短它可降低设备遗失时的风险。
- `DB_DRIVER`：生产环境固定为 `mysql`。`RUN_MIGRATIONS_ON_START=false` 让 API 只做连接校验；发布时显式运行一次 `api-migrate`，避免多副本 DDL 竞态。
- `MYSQL_*`：API 只使用普通业务账号和连接池配置；Docker Compose 内的 `MYSQL_ROOT_PASSWORD` 只用于 MySQL 初始化、备份和恢复，不能传入 API 或前端。
- `AGENT_TIMEOUT_MS`：单次模型调用上限。超时或上游异常会返回 `502`，不会自动应用提案。
- `AGENT_MAX_TOKENS`、`AGENT_CONTEXT_MAX_BYTES`：限制单次输出与送入模型的上下文，避免异常长计划或记忆推高成本。
- `AGENT_REQUESTS_PER_MINUTE`、`AGENT_DAILY_REQUEST_LIMIT`：单实例 MVP 的请求保护与每日额度；多实例时必须迁移到 Redis 统一计数。
- `AGENT_PROPOSAL_TTL_DAYS`：待确认提案的有效期。计划在提案生成后被手动更新时，应用接口会因版本冲突返回 `409`，不会覆盖新计划。
- `LLM_BASE_URL`、`LLM_API_KEY`、`AGENT_MODEL`：支持 DeepSeek 或其他 OpenAI 兼容服务。更换供应商时先在隔离环境验证 JSON 输出与超时行为。

## 4. API 契约

除注册、登录和健康检查外，以下示例都省略了相同的 `Authorization` 请求头。

### 4.1 认证

`POST /api/auth/register`

```json
{ "username": "小研同学", "password": "at-least-8-characters", "email": "optional@example.com" }
```

成功（`201`）：

```json
{
  "user": { "id": 1, "username": "小研同学", "email": "optional@example.com", "avatarUrl": "" },
  "accessToken": "opaque-token",
  "expiresAt": "2026-11-07T00:00:00.000Z"
}
```

`POST /api/auth/login` 请求 `{ "username": "小研同学", "password": "..." }`，返回结构相同。`GET /api/auth/me` 返回 `{ "user": { ... } }`；`POST /api/auth/logout` 撤销当前 Bearer token 并返回 `204`。

用户名限 2–32 位中文、字母、数字、`_` 或 `-`；密码限 8–128 位。前端不应自行判断登录有效性，应在启动时调用 `/api/auth/me`。

### 4.2 学习时段与统计

`POST /api/study/sessions`

```json
{
  "subject": "数学",
  "content": "高数强化第六章",
  "startedAt": "2026-08-09T08:30:00.000Z",
  "endedAt": "2026-08-09T10:45:00.000Z",
  "durationS": 8100
}
```

`durationS` 必须为 0–86400 的整数。成功返回 `201` 和新建的 `session`。计时器停止时再提交一次即可，前端无需让模型参与计时。

`GET /api/study/summary?days=7` 返回：

```json
{
  "days": 7,
  "durationS": 30060,
  "sessionCount": 5,
  "bySubject": [
    { "subject": "数学", "durationS": 14400, "sessionCount": 2 }
  ]
}
```

`days` 范围为 1–90。服务端只汇总当前登录用户的记录。

### 4.3 当前计划与版本冲突

`GET /api/plans` 返回当前用户的报考与学习计划，以及每份计划的 `revision`：

```json
{
  "plans": {
    "admission": { "plan": {}, "revision": 0, "updatedAt": null },
    "study": { "plan": { "items": [] }, "revision": 3, "updatedAt": "2026-08-09 10:00:00" }
  }
}
```

手动保存使用 `PUT /api/plans/study` 或 `PUT /api/plans/admission`：

```json
{
  "plan": { "items": [{ "subject": "数学", "title": "极限专项", "hours": 8 }] },
  "expectedRevision": 3
}
```

成功后服务端递增 `revision`。如果 `expectedRevision` 已过期，返回 `409` 和 `currentRevision`；前端应重新拉取、提示用户合并，而不是覆盖更新。这一机制也保护 Agent 提案：提案生成后计划被手动改动时，旧提案无法再应用。

### 4.4 Agent 上下文与记忆

`GET /api/agents/context` 返回当前用户的计划、近 30 天学习汇总、有效记忆和最多 12 所收藏院校的摘要。前端可展示其中的统计，但无需把完整上下文再传回模型。收藏院校查询始终带当前 `user_id` 条件，模型只收到服务端整理后的名称、省市、A/B 区、层次与类型，不会获得数据库连接。

`GET /api/agents/memories` 返回 `{ "data": [...] }`。新增记忆：

```http
POST /api/agents/memories
Content-Type: application/json
```

```json
{
  "memoryType": "preference",
  "content": "数学更适合在上午安排",
  "metadata": { "source": "user-confirmed" },
  "expiresAt": null
}
```

允许的 `memoryType`：`preference`、`goal`、`study-state`、`admission-state`、`feedback`。删除使用 `DELETE /api/agents/memories/:id`；只能操作自己的记忆。

### 4.5 顾问对话

创建会话：

```http
POST /api/agents/conversations
```

```json
{
  "agentType": "kaoyan-coach",
  "title": "八月学习安排",
  "context": { "entry": "prep-home" }
}
```

新会话只允许 `study-assistant` 或 `kaoyan-coach`。后者可在信息不足时返回：

```json
{
  "message": {
    "role": "assistant",
    "content": "先补齐这些信息，我再给你排周计划。",
    "metadata": {
      "agentType": "kaoyan-coach",
      "canCreateProposal": false,
      "coach": {
        "profile": "kaoyan-coach-zh",
        "version": "2026.08.09.1",
        "needsIntake": true,
        "questions": ["目标院校和专业是什么？", "计划参加哪一年的考试？", "每天平均可学习多久？"]
      }
    }
  }
}
```

前端应将 `questions` 作为普通文本显示，按顺序让用户回复；不能把它们当作命令或自动写入画像。`needsIntake=true` 时服务端强制 `canCreateProposal=false`。

返回 `201`：

```json
{
  "conversation": {
    "id": 12,
    "agentType": "study-assistant",
    "title": "八月学习安排",
    "createdAt": "2026-08-09 10:00:00",
    "updatedAt": "2026-08-09 10:00:00"
  }
}
```

- `GET /api/agents/conversations`：返回 `{ "data": [...] }` 的会话列表。
- `GET /api/agents/conversations/:id`：返回会话和最多 200 条已保存消息。
- `POST /api/agents/conversations/:id/messages`：发送 `{ "message": "我下周怎样复习？" }`，服务端写入用户消息、调用模型、保存助手消息并返回 `{ "message": { ... } }`。
- `DELETE /api/agents/conversations/:id`：删除自己的会话及其消息，返回 `204`。

单条消息和提案问题上限均为 2000 字符；客户端 `context` 上限为 20KB。聊天回复只提供建议，不会更新计划。若需要改计划，必须另行创建提案。

### 4.6 计划提案与确认应用

创建提案：

```http
POST /api/agents/proposals
Content-Type: application/json
```

```json
{
  "proposalType": "study",
  "agentType": "kaoyan-coach",
  "question": "结合我最近学习时长，重新安排下周计划。",
  "context": { "weeklyHoursTarget": 42, "clientEntry": "agent-chat" }
}
```

返回 `201`：

```json
{
  "proposal": {
    "id": 31,
    "proposalType": "study",
    "status": "pending",
    "summary": "下周优先补强极限与英语阅读。",
    "rationale": "依据近 30 天学习统计与当前计划生成。",
    "changes": [
      {
        "operation": "replace_study_plan",
        "data": { "items": [{ "subject": "数学", "title": "极限专项", "hours": "16h" }] }
      }
    ],
    "baseRevision": 3,
    "expiresAt": "2026-08-16 10:00:00",
    "appliedAt": null,
    "createdAt": "2026-08-09 10:00:00",
    "updatedAt": "2026-08-09 10:00:00"
  }
}
```

可用操作是严格白名单：

| `proposalType` | 唯一允许的操作 | 写入位置 |
| --- | --- | --- |
| `study` | `replace_study_plan` | `user_study_plans` |
| `admission` | `replace_admission_plan` | `user_admission_plans` |

每个提案只能有一个白名单变更。模型输出 SQL、文件路径、HTTP 指令、多项操作或类型不匹配时，后端返回 `422`，并不会创建可应用的提案。教练提案还会在创建和应用两个阶段校验：学习计划必须含 1–60 个可渲染、带科目/标题/量化时长的任务；报考方案必须有目标院校或候选院校，且不允许异常嵌套/超长字段。

- `GET /api/agents/proposals`：获取当前用户提案历史。
- `POST /api/agents/proposals/:id/apply`：仅 `pending` 状态可执行，成功返回 `{ "status": "applied", "currentState": { ... } }`。
- `POST /api/agents/proposals/:id/reject`：仅 `pending` 状态可拒绝，成功返回 `{ "status": "rejected" }`。

提案默认 7 天过期（由 `AGENT_PROPOSAL_TTL_DAYS` 配置）。重复应用、已拒绝、过期、计划版本冲突或跨用户访问都不会写入数据；状态/版本冲突返回 `409`，找不到自己的资源返回 `404`。

### 4.7 错误处理

| 状态码 | 处理方式 |
| --- | --- |
| `400` / `413` | 参数或请求体不符合约束，提示用户修改输入 |
| `401` | 清除本地登录态，回到登录页 |
| `404` | 资源已删除或不属于当前用户 |
| `409` | 提案已被处理，重新拉取状态 |
| `422` | 模型结果未通过安全校验，允许用户重试 |
| `502` | 模型供应商超时/异常，保留草稿后重试；不要自动应用 |

## 5. 前端接入原则

`src/agent-api.js` 是前端的唯一 HTTP 封装层。登录成功后保存 `accessToken`（移动端优先使用系统安全存储，Web 端按安全策略保存），每次 API 请求附加 `Authorization: Bearer <token>`。令牌不能出现在 URL、埋点、错误提示或日志中。

UI 必须遵守：

1. 先展示提案的 `summary`、`rationale` 和 `changes`，再展示“应用此方案”。
2. 只有用户明确点击确认才调用 `/apply`；取消或返回不改任何计划。
3. `/apply` 成功后从后端重新读取计划和统计，不能把模型原文当作已保存数据。
4. 对话和提案入口可以共用，但对话结果不等于计划变更。
5. Agent 回复中涉及分数线、招生人数等时效信息时，UI 应显示来源和更新时间；没有来源时标记为“建议核验”。

完整前端请求示例见 [前端 Agent 接口接入](agent-frontend-integration.md)。

## 6. 新功能的推荐实现方式

以“错题分析”为例：

1. 建立错题、知识点、错误原因、重做记录等业务表，并提供只读查询接口。
2. 后端只提取当前用户必要的错题统计，构造专用模型提示词与 JSON schema。
3. 将分析结果以会话消息或只读报告返回；若要修改复习计划，仍生成 `pending` 提案。
4. 用户确认后再写入任务/计划表，并记录提案 ID、操作者与时间。
5. 为跨用户隔离、非法操作、模型 JSON 异常、重复确认和模型超时添加自动化测试。

后续优先补齐的业务能力：

1. **任务模型**：年度/月/周/日任务、重复规则、延期与未完成顺延，替代当前整份计划 JSON 的 MVP 形态。
2. **用户画像与学习资产模型**：规范化保存考试年份、目标院校/专业、各科基础、每日可用时间、阶段、单词进度、题目、真题、错题原因、知识点、附件和拍照 OCR 结果。教练在这些字段未齐全时会主动追问，不能把聊天推测写入画像。
3. **真实院校数据**：招生简章、专业目录、分数线、推免和报录比需要可追溯数据源、抓取/审核流程、更新时间与引用链接；模型不能凭记忆生成事实。
4. **工具调用层**：模型只可选择预定义工具；服务端做参数校验、权限校验、超时、重试、审计与结果脱敏。
5. **流式体验**：对话可增加 SSE/WebSocket 流式输出；流结束后再持久化完整助手消息，提案仍保持确认式写入。

## 7. 生产演进

当前生产数据库为 MySQL 8.4：用户、计划、消息、审计和真实业务数据通过版本化迁移持久化。MySQL 支持并发读写和持久卷备份；但 Agent 限流/配额当前仍是单进程实现，多 API 副本前应先完成 Redis 统一计数和分布式任务协调。建议演进为：

```text
MySQL       —— 用户、计划、消息、审计和真实业务数据
Redis       —— 限流、缓存、会话与队列
Worker      —— 资料抓取、OCR、批量分析、通知
对象存储    —— 图片、附件、导出的学习报告
向量检索服务 —— 资料检索（可选，独立于业务库）
```

同时补齐：按用户/IP 的限流和配额、模型调用审计（只存输入摘要）、监控告警、删除账号的数据清理、备份恢复演练和模型输出评测集。新增业务表一律通过新的 MySQL migration 演进；数据库替换时保持本文件中的 API 契约和提案状态机稳定，前端即可平滑迁移。

部署命令、Nginx 与备份细节见 [后端 Docker 部署文档](backend-docker-deployment.md)。
