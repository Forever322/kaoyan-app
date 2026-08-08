# 考研 Agent 开发与部署手册

本文档是后续部署、迭代 AI 考研顾问的唯一技术入口。当前实现采用 Node.js + Express + `sql.js`，模型通过 DeepSeek 的 OpenAI 兼容接口调用。

## 1. 当前能力与用户流程

前端流程：

```text
备考页 AI 学习顾问 → 学习计划提案 → 考研学习顾问对话 → 调整/重新生成 → 用户确认应用
```

关键原则：**模型只生成提案，只有用户点击“应用这份计划”后，后端才写入院校方案或学习计划。**

| 能力 | 前端位置 | 后端接口 | 是否直接写数据 |
| --- | --- | --- | --- |
| 学习计划建议 | `agentChatScreen` | `POST /api/agents/proposals`，`proposalType: study` | 否 |
| 报考方案建议 | 可在院校详情/我的页增加入口 | `POST /api/agents/proposals`，`proposalType: admission` | 否 |
| 应用提案 | `agentProposalScreen` | `POST /api/agents/proposals/:id/apply` | 是 |
| 拒绝提案 | 后续增加 | `POST /api/agents/proposals/:id/reject` | 否 |

涉及代码：

| 位置 | 责任 |
| --- | --- |
| `src/views/agent-view.js` | 对话页、提案确认页的页面结构 |
| `src/agent-api.js` | 前端 Agent HTTP 客户端 |
| `src/app.js` | 页面跳转、提案渲染、确认应用 |
| `server/src/routes/agents.js` | 提案 API、权限校验、确认写入 |
| `server/src/services/agent-service.js` | 模型调用、JSON 输出校验 |
| `server/src/db/schema.js` | Agent、计划、会话数据表 |

## 2. 部署配置

生产服务器的 Compose 同级目录创建 `.env`，绝不能提交到仓库：

```env
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=替换为生产密钥
AGENT_MODEL=deepseek-chat
```

启动后端：

```bash
docker compose -f docker-compose.backend.yml build api
docker compose -f docker-compose.backend.yml up -d api
docker compose -f docker-compose.backend.yml logs -f api
curl http://127.0.0.1:3000/api/health
```

完整 Docker、Nginx、备份说明见 [后端部署文档](backend-docker-deployment.md)。模型密钥只能存在于服务器环境变量或密钥管理服务；不得写入 Vite 环境变量、前端代码、设计稿、数据库记录或日志。

## 3. API 契约

### 创建提案

`POST /api/agents/proposals`

请求头（当前开发过渡方案）：

```http
X-User-Id: 1
Content-Type: application/json
```

请求体：

```json
{
  "proposalType": "study",
  "question": "我数学基础刚结束，下周怎样安排？",
  "context": {
    "weeklyStudyHours": 42,
    "completionRate": 0.76,
    "mathAccuracy": 0.62,
    "readingAccuracy": 0.60
  }
}
```

返回体中的 `proposal` 包含 `id`、`summary`、`rationale`、`changes` 和 `status`。`changes` 必须是可解释、可预览的操作列表，例如：

```json
{
  "summary": "下周优先补强极限与英语阅读。",
  "rationale": "数学正确率偏低，英语需要维持训练频率。",
  "changes": [{
    "operation": "replace_study_plan",
    "data": {
      "items": [{ "subject": "数学", "title": "极限专项", "hours": "16h", "note": "优先补弱" }]
    }
  }]
}
```

允许的操作：

| `proposalType` | 允许的 `operation` | 写入目标 |
| --- | --- | --- |
| `study` | `replace_study_plan` | `user_study_plans` |
| `admission` | `replace_admission_plan` | `user_admission_plans` |

不要让模型输出 SQL、任意 HTTP 请求、文件路径或未经校验的“执行指令”。后端必须将模型结果转换/校验为上述白名单结构。

## 4. 添加一个新 Agent 功能

以“错题分析”为例：

1. 在 `server/src/services/agent-service.js` 新建专用系统提示词，规定 JSON schema 与允许操作。
2. 在 `server/src/routes/agents.js` 增加路由，例如 `POST /api/agents/error-analysis`；先从数据库按 `user_id` 查询错题和学习记录，再构造最小必要上下文。
3. 新增数据库迁移（例如错题表、分析结果表），不要直接修改已上线表结构。
4. 在 `src/agent-api.js` 增加对应请求函数，在 `agent-view.js` 或题库页添加入口。
5. 对“会改变用户数据”的结果，仍然先返回 `pending` 提案，再由 `/apply` 接口执行。
6. 添加单元测试：用户隔离、非法 operation 拒绝、模型 JSON 异常、重复 apply、权限不足。

建议优先级：

1. 学习计划调整；
2. 错题归因与专项复习建议；
3. 报考方案提案；
4. 周/月复盘；
5. 作文、翻译批改；
6. 招生信息检索工具。

## 5. 工具调用与外部数据

未来接入院校招生数据、日历提醒、知识库检索时，工具必须由后端定义并执行。模型只选择工具与参数，服务端负责：

- 参数 schema 校验；
- 仅允许经过认证用户可访问的数据；
- 超时、重试和速率限制；
- 记录工具输入、结果摘要与耗时；
- 将外部来源、更新时间和不确定性返回给用户。

政策、招生人数、分数线等时效数据必须附来源与更新时间，不允许模型凭记忆编造。

## 6. 登录、安全与审计

当前 `X-User-Id` 仅适用于本地/受控开发。公网部署前必须完成：

1. 登录系统签发 JWT 或受控 session；
2. 后端鉴权中间件从令牌解析 `user_id`，删除客户端传入的 `X-User-Id` 信任逻辑；
3. 对 Agent 路由限流（建议按用户与 IP 双维度）；
4. 设置模型超时、单用户每日额度和请求体上限；
5. 对 `agent_proposals`、`agent_messages` 记录模型名、输入摘要、操作与确认时间；
6. 用户删除账号时一并清理其会话、记忆与提案；
7. 日志中掩码手机号、令牌、模型密钥和完整敏感学习内容。

## 7. 数据库演进与扩容

当前 SQLite/sql.js 适合 MVP 单实例。数据持续增长、需要并发会话/队列/向量检索时迁移：

```text
PostgreSQL（业务数据与审计）
Redis（限流、缓存、队列）
Worker（长任务、批量分析）
对象存储（图片与附件）
向量库或 PostgreSQL pgvector（资料检索，可选）
```

迁移前应先保留 API 契约和提案状态机不变，使前端无需因数据库替换而重写。

## 8. 发布检查清单

- [ ] `LLM_API_KEY` 已在服务器配置，未提交到 Git。
- [ ] `/api/health` 正常，数据卷可写且已备份。
- [ ] JWT 鉴权与限流已启用。
- [ ] 提案预览与“应用”是两个独立动作。
- [ ] 模型异常时前端可以重试，且不会自动写计划。
- [ ] 新数据源显示来源、更新时间。
- [ ] 已测试学习计划、报考计划、拒绝、重复确认与跨用户访问。
