# 前端 Agent 接口接入

前端只调用项目后端，不直接调用 DeepSeek/OpenAI 兼容接口，也不保存 `LLM_API_KEY`。所有 Agent 请求均应经由 `src/agent-api.js`，以便统一处理令牌、错误、重试和环境地址。

## 1. API 地址与登录态

开发环境根目录可创建 `.env.local`：

```env
VITE_API_BASE=http://localhost:3000
```

同域生产部署时，建议将 API 基址设为同源地址（例如空字符串或 `/api` 的统一封装），由 Nginx 代理 `/api/`。不要把生产包固定到 `localhost:3000`。

登录成功后，后端返回：

```json
{
  "user": { "id": 1, "username": "小研同学", "email": "", "avatarUrl": "" },
  "accessToken": "opaque-token",
  "expiresAt": "2026-11-07T00:00:00.000Z"
}
```

将 `accessToken` 交给统一请求层，并为每个受保护请求添加：

```http
Authorization: Bearer <accessToken>
```

建议的客户端接口形态：

```js
let accessToken = '';

export function setAccessToken(token) {
  accessToken = token || '';
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}
```

移动端优先使用系统安全存储保存令牌；Web 端按项目安全策略保存，至少不能把令牌放入 URL、页面文本、截图、埋点或控制台日志。应用启动时调用 `GET /api/auth/me` 恢复用户；得到 `401` 时清除本地登录态并回到登录页。

`X-User-Id` 仅保留给本地兼容调试，且只应在后端 `ALLOW_DEV_HEADER_AUTH=true` 时使用。生产端 `ALLOW_DEV_HEADER_AUTH=false` 后，前端必须完成 Bearer token 切换。

## 2. 登录接口

```js
export async function register({ username, password, email = '' }) {
  return apiRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, email }),
  });
}

export async function login({ username, password }) {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function logout() {
  await apiRequest('/api/auth/logout', { method: 'POST' });
  setAccessToken('');
}
```

- 注册：`POST /api/auth/register`，成功 `201`。
- 登录：`POST /api/auth/login`，成功 `200`。
- 当前用户：`GET /api/auth/me`，返回 `{ user }`。
- 退出：`POST /api/auth/logout`，成功 `204`。

后端限制用户名为 2–32 位中文、字母、数字、下划线或连字符，密码为 8–128 位。错误提示应使用后端的 `error` 字段，但不能展示密码或令牌。

## 3. 收藏院校同步

收藏属于当前账号，不能用浏览器本地数组覆盖云端列表。登录后读取并写入：

```js
const { favorites } = await apiRequest('/api/favorites').then(readJson);

await apiRequest('/api/favorites', {
  method: 'POST',
  body: JSON.stringify({ universityName: '北京邮电大学' }),
});

await apiRequest(`/api/favorites/${universityId}`, { method: 'DELETE' });
```

`POST` 可传 `universityName` 或 `universityId`；服务端会解析院校并以 `(user_id, university_id)` 唯一约束去重，因此重复点击是幂等的。`GET` 仅返回当前 Bearer 令牌所属用户的记录，`DELETE` 也始终附带用户条件。离线收藏可以作为未登录体验，但登录后应只展示云端列表，避免把一个设备上的旧收藏错误迁移给另一个账号。

## 4. 学习记录与仪表盘

计时器停止后写入一条学习时段：

```js
await apiRequest('/api/study/sessions', {
  method: 'POST',
  body: JSON.stringify({
    subject: '数学',
    content: '高数强化第六章',
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    durationS: Math.floor((endMs - startMs) / 1000),
  }),
});

const summary = await apiRequest('/api/study/summary?days=7').then(readJson);
```

`summary` 包含 `durationS`、`sessionCount` 和按学科拆分的 `bySubject`，可直接用于备考主页与 Agent 上下文展示。不要在前端凭累计值推算真实统计，网络恢复后应重新从服务端读取。

### 手动保存计划与版本号

```js
const { plans } = await apiRequest('/api/plans').then(readJson);

await apiRequest('/api/plans/study', {
  method: 'PUT',
  body: JSON.stringify({
    plan: nextStudyPlan,
    expectedRevision: plans.study.revision,
  }),
}).then(readJson);
```

`GET /api/plans` 会为学习和报考计划分别返回 `plan`、`revision`、`updatedAt`。手动更新或应用 Agent 提案后 revision 都会递增；遇到 `409` 时重新拉取最新计划并提示用户合并，不能用旧页面数据强行覆盖。

## 5. Agent 对话与记忆

### 获取上下文

```js
const { context } = await apiRequest('/api/agents/context').then(readJson);
```

`context` 已含当前计划、近 30 天学习统计、有效记忆和当前账号的收藏院校摘要。除界面展示外，通常不需要将这份完整数据再随请求发送；后端会重新从当前用户数据构建可信上下文。

### 创建与续接会话

```js
const { conversation } = await apiRequest('/api/agents/conversations', {
  method: 'POST',
  body: JSON.stringify({
    agentType: 'kaoyan-coach',
    title: '八月学习安排',
    context: { entry: 'prep-home' },
  }),
}).then(readJson);

const { message } = await apiRequest(
  `/api/agents/conversations/${conversation.id}/messages`,
  { method: 'POST', body: JSON.stringify({ message: '我下周怎样复习？' }) },
).then(readJson);
```

会话相关接口：

| 接口 | 用途 |
| --- | --- |
| `POST /api/agents/conversations` | 创建会话，返回 `conversation` |
| `GET /api/agents/conversations` | 获取会话列表，返回 `data` |
| `GET /api/agents/conversations/:id` | 获取会话与已持久化消息 |
| `POST /api/agents/conversations/:id/messages` | 发送消息，返回最新助手 `message` |
| `DELETE /api/agents/conversations/:id` | 删除当前用户的会话及其消息 |

一次发送期间禁用重复提交按钮，显示“正在分析”。模型异常返回 `502` 时保留用户输入草稿，允许显式重试；不要伪造一条成功的助手消息。

### 考研复习规划教练的追问

`kaoyan-coach` 会先检查是否已有目标院校、考试年份、科目基础和可用时间。信息不足时，返回消息的 `metadata.coach`：

```js
const coach = message.metadata?.coach;
if (coach?.needsIntake) {
  // 仅以安全文本列表展示；不要自动保存、不要直接创建提案。
  renderQuestions(coach.questions); // 3–6 条
}
const canCreateProposal = message.metadata?.canCreateProposal === true;
```

只有 `canCreateProposal === true` 时显示“生成待确认计划”。教练对话和旧的 `study-assistant` 对话应按 `agentType` 分开续接，避免混用不同策略的历史消息。

### 长期记忆

```js
await apiRequest('/api/agents/memories', {
  method: 'POST',
  body: JSON.stringify({
    memoryType: 'preference',
    content: '英语阅读安排在晚间更容易坚持',
    metadata: { source: 'user-confirmed' },
  }),
});
```

记忆应可见、可编辑、可删除。只有用户明确确认的信息才建议写入；不要把每句对话、敏感个人信息或未经确认的模型猜测自动保存为长期记忆。

## 6. 提案交互：预览后再写入

创建学习计划提案：

```js
const { proposal } = await apiRequest('/api/agents/proposals', {
  method: 'POST',
  body: JSON.stringify({
    proposalType: 'study',
    agentType: 'kaoyan-coach',
    question: '依据我本周完成情况，重新安排下周计划。',
    context: {
      weeklyHoursTarget: 42,
      clientEntry: 'agent-chat',
    },
  }),
}).then(readJson);

// 跳转到方案确认页，仅渲染 proposal.summary / rationale / changes。
```

确认页中必须将下列操作分开：

```js
await apiRequest(`/api/agents/proposals/${proposal.id}/apply`, { method: 'POST' });
// 成功后重新拉取服务端计划和学习统计。

await apiRequest(`/api/agents/proposals/${proposal.id}/reject`, { method: 'POST' });
```

提案状态：

| 状态 | UI 含义 | 可执行操作 |
| --- | --- | --- |
| `pending` | 等待本人确认，尚未改数据 | 应用、拒绝 |
| `applied` | 已写入后端当前计划 | 查看、刷新当前计划 |
| `rejected` | 用户拒绝，保留审计记录 | 查看 |
| `expired` | 已超过提案有效期 | 查看或重新生成 |

后端严格限制每份提案只包含一个操作：学习建议只能是 `replace_study_plan`，报考建议只能是 `replace_admission_plan`。不要在客户端直接执行 `changes`，也不要把模型返回文本直接写到本地业务状态。

## 7. 通用错误处理

```js
export class AgentApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(response) {
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new AgentApiError(response.status, data?.error || '请求失败');
  return data;
}
```

| HTTP 状态 | 前端行为 |
| --- | --- |
| `400` / `413` | 高亮表单或消息长度问题 |
| `401` | 清空本地令牌并进入登录页 |
| `404` | 提示资源不存在或已被删除，并返回列表 |
| `409` | 提案可能已确认/拒绝，刷新最新状态 |
| `422` | 模型结果未通过安全校验，可提示“请重新生成” |
| `502` | 模型服务暂不可用，保留草稿后重试 |

## 8. 即将扩展的前端数据模型

当前计划是 MVP 的整份 JSON 提案。后续接入任务、单词、真题、错题和院校实时数据时，应优先使用后端的规范资源接口（任务 ID、更新时间、来源和版本），不要让 Agent 文本成为唯一数据来源。

涉及招生人数、分数线、专业目录等事实信息时，在界面显示来源链接与更新时间；缺少来源时，应标识为 AI 建议并提示用户核验。完整后端契约与扩展建议见 [Agent 开发与部署手册](agent-development-and-deployment.md)。

## 9. 当前 Web 前端接入状态

当前项目已通过以下模块接入真实后端：

- `src/auth-api.js`：注册、登录、恢复会话、退出登录和统一 Bearer 请求；生产同源时 API 基址为空字符串，由 Nginx 代理 `/api/`。
- `src/study-api.js`：学习计时写入、日/周统计、带 revision 的学习计划读取与更新。
- `src/agent-api.js`：持久化对话、顾问消息、记忆和待确认提案。聊天不会直接改计划，只有确认提案后才写入。

本地联调直接运行前端和后端即可：Vite 已将 `/api` 代理到 `http://127.0.0.1:3000`。如需改目标，设置 `VITE_BACKEND_PROXY`。生产 Web 包不要设置 `VITE_API_BASE`，保持同源；Android `file://` / WebView 包应在构建时设置：

```env
VITE_API_BASE=https://kaoyan.dfnbxjj688.xyz
```

令牌永远不放入 URL、截图、日志或模型提示。Android WebView 若携带非空 Origin，需把该 Origin 精确加入服务器 `CORS_ORIGINS` 后再发布。
