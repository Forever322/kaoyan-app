import OpenAI from 'openai';

const ADMISSION_SYSTEM_PROMPT = `你是考研报考顾问。仅依据用户提供的数据提出建议，不编造院校招生、分数线或政策。输出严格 JSON：{"summary":"","rationale":"","changes":[{"operation":"replace_admission_plan","data":{}}]}. changes 只能包含一个 replace_admission_plan；它是待用户确认的提案，不是已经执行的操作。`;
const STUDY_SYSTEM_PROMPT = `你是考研学习规划顾问。仅依据用户提供的数据提出可执行建议，不承诺考试结果。输出严格 JSON：{"summary":"","rationale":"","changes":[{"operation":"replace_study_plan","data":{}}]}. changes 只能包含一个 replace_study_plan；它是待用户确认的提案，不是已经执行的操作。`;

function parseJson(content) {
  const clean = String(content || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(clean);
  if (!parsed || typeof parsed.summary !== 'string' || !Array.isArray(parsed.changes)) {
    throw new Error('模型返回格式不正确');
  }
  return { summary: parsed.summary, rationale: String(parsed.rationale || ''), changes: parsed.changes.slice(0, 1) };
}

export async function generateProposal({ proposalType, question, context }) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error('未配置 LLM_API_KEY');

  const client = new OpenAI({ apiKey, baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1' });
  const completion = await client.chat.completions.create({
    model: process.env.AGENT_MODEL || 'deepseek-chat',
    temperature: 0.35,
    messages: [
      { role: 'system', content: proposalType === 'admission' ? ADMISSION_SYSTEM_PROMPT : STUDY_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ question: String(question || ''), context }) },
    ],
  });

  return parseJson(completion.choices?.[0]?.message?.content);
}
