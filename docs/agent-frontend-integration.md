# 前端 Agent 接口接入

前端客户端位于 `src/agent-api.js`。它封装了 Agent 提案的生成、查询、确认应用与拒绝；前端不调用 DeepSeek，也不持有模型密钥。

## 环境变量

开发环境在根目录创建 `.env.local`：

```env
VITE_API_BASE=http://localhost:3000
```

同域部署且 Nginx 已将 `/api/` 转发给后端时，可以省略该变量。

## 开发期身份

当前后端尚未接入 JWT。客户端临时使用 `X-User-Id` 请求头，调用前需设置已经存在于后端 `users` 表中的用户 ID：

```js
import { setAgentUserId } from './agent-api.js';

setAgentUserId(1);
```

这是开发过渡方案。上线时应由登录接口签发 JWT，客户端将 `agentRequest` 的 `X-User-Id` 替换为 `Authorization: Bearer <token>`，后端从令牌解析用户身份。

## 提案交互

```js
import {
  createAgentProposal,
  listAgentProposals,
  applyAgentProposal,
  rejectAgentProposal,
  AgentApiError,
} from './agent-api.js';

try {
  const { proposal } = await createAgentProposal({
    proposalType: 'study',
    question: '依据我本周完成情况，重新安排下周计划。',
    context: {
      targetSchool: '清华大学',
      targetMajor: '计算机科学与技术',
      weeklyHours: 42,
      taskCompletionRate: 0.76,
      weakSubjects: ['高数极限', '英语阅读'],
    },
  });

  // 在 UI 中展示 proposal.summary、proposal.rationale、proposal.changes。
  // 不要在这里直接更新本地计划。
  await applyAgentProposal(proposal.id);
} catch (error) {
  if (error instanceof AgentApiError) console.error(error.status, error.message);
}
```

提案状态：

| 状态 | 含义 |
| --- | --- |
| `pending` | 等待用户确认，不修改业务数据 |
| `applied` | 用户已确认，后端已写入对应计划 |
| `rejected` | 用户拒绝，保留审计记录 |
| `expired` | 可在后端定时任务中设置过期 |

## UI 约束

1. 建议必须先在“变更预览”中展示，再提供“应用此方案”按钮。
2. 预览中展示 `summary`、`rationale` 与每项 `changes`。
3. `applyAgentProposal` 成功后重新拉取计划数据，不要假设模型输出已生效。
4. 出现 401 时跳转登录；出现 404 时提示提案已失效或用户不存在；出现 5xx 时保留草稿并允许重试。
5. 在正式 JWT 完成前，不应将该接口直接暴露给公网用户。
