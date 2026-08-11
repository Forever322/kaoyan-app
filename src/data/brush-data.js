/**
 * 考研全科刷题数据模块
 * 来源：@user_af163eaa/z-brush-kaoyan Skill 模板数据
 * 包含：章节地图、题型规范、质量标准、错题本结构
 */

/** 章节地图（P0=高频必考，P1=次重点） */
export const CHAPTER_MAP = [
  {
    id: 'politics',
    chapter: 1,
    name: '政治',
    icon: '📜',
    p0: ['马原', '毛中特'],
    p1: ['史纲', '思修', '时政'],
    subtopics: {
      马原: ['唯物论', '辩证法', '认识论', '唯物史观', '政治经济学'],
      毛中特: ['新民主主义', '社会主义改造', '改革开放', '新时代思想', '五位一体'],
      史纲: ['鸦片战争至五四运动', '新民主主义革命', '社会主义革命与建设', '改革开放新时期'],
      思修: ['人生观价值观', '理想信念', '中国精神', '核心价值观', '道德法律'],
      时政: ['国内重大会议', '国际关系', '经济政策', '科技成就', '党建'],
    },
  },
  {
    id: 'english',
    chapter: 2,
    name: '英语',
    icon: '📖',
    p0: ['阅读'],
    p1: ['写作', '翻译', '完形'],
    subtopics: {
      阅读: ['主旨大意', '事实细节', '推理判断', '词义猜测', '观点态度'],
      写作: ['图画作文', '图表作文', '书信', '通知告示'],
      翻译: ['英译汉长难句', '定语从句', '状语从句', '名词性从句'],
      完形: ['逻辑衔接', '词汇辨析', '固定搭配', '语法结构'],
    },
  },
  {
    id: 'math',
    chapter: 3,
    name: '数学',
    icon: '📐',
    p0: ['高数'],
    p1: ['线代', '概率'],
    subtopics: {
      高数: ['极限与连续', '导数与微分', '积分', '微分方程', '级数', '多元函数', '曲线曲面积分'],
      线代: ['行列式', '矩阵', '线性方程组', '特征值特征向量', '二次型'],
      概率: ['随机事件与概率', '随机变量', '数字特征', '大数定律', '数理统计'],
    },
  },
  {
    id: 'major',
    chapter: 4,
    name: '专业课',
    icon: '📚',
    p0: ['院校自命'],
    p1: ['重点', '真题'],
    subtopics: {
      院校自命: ['数据结构', '计算机组成', '操作系统', '计算机网络'], // 以 408 为例
      重点: ['核心算法', '体系结构', '进程管理', 'TCP/IP'],
      真题: ['近5年真题', '高频题型', '易错题型'],
    },
  },
  {
    id: 'realexam',
    chapter: 5,
    name: '真题',
    icon: '📝',
    p0: ['历年'],
    p1: ['模考', '错题'],
    subtopics: {
      历年: ['近10年真题', '按年份套卷', '按章节分类'],
      模考: ['全真模拟', '限时训练', '答题卡规范'],
      错题: ['错因归类', '知识点补漏', '同类题强化'],
    },
  },
  {
    id: 'interview',
    chapter: 6,
    name: '复试',
    icon: '🎤',
    p0: ['面试'],
    p1: ['调剂', '科研'],
    subtopics: {
      面试: ['英文自我介绍', '专业课提问', '科研经历', '综合素质'],
      调剂: ['信息搜集', '学校筛选', '材料准备', '复试准备'],
      科研: ['论文阅读', '研究方向', '导师选择', '学术规划'],
    },
  },
];

/** 题型定义与输出格式 */
export const QUESTION_TYPES = {
  single: {
    name: '单选题',
    structure: '【题型】单选 【章节】第X章 【难度】P0\n题目：{stem}\nA. {optA} B. {optB} C. {optC} D. {optD}\n【答案】{answer}\n【解析】{explanation}（点明考点与易错点）',
    optionCount: 4,
    optionLabels: ['A', 'B', 'C', 'D'],
  },
  multiple: {
    name: '多选题',
    structure: '【题型】多选 【章节】第X章 【难度】P0\n题目：{stem}\nA-E 至少两个正确选项\n【答案】{answers}\n【解析】{explanation}（说明各选项对错依据）',
    optionCount: 5,
    optionLabels: ['A', 'B', 'C', 'D', 'E'],
  },
  calculation: {
    name: '计算题',
    structure: '【题型】计算 【章节】第X章 【难度】P0\n题目：{stem}\n【步骤】{steps}\n【答案】{answer}\n【解析】{explanation}',
  },
  shortAnswer: {
    name: '简答题',
    structure: '【题型】简答 【章节】第X章 【难度】P0\n题目：{stem}\n【要点】{keyPoints}\n【解析】{explanation}',
  },
};

/** 难度等级 */
export const DIFFICULTY_LEVELS = {
  P0: { label: 'P0 · 高频', desc: '高频考点，权重高、易出题，优先刷', color: 'var(--color-danger)' },
  P1: { label: 'P1 · 次重点', desc: '次重点考点，覆盖面广', color: 'var(--color-warning)' },
};

/** 题目生成质量标准 */
export const QUALITY_STANDARDS = [
  { rule: '题干无歧义', detail: '题目表述清晰，无二义性' },
  { rule: '选项互斥且唯一最优', detail: '单选选项互斥；多选注明原因' },
  { rule: '答案与解析一致', detail: '解析含考点出处与排除理由' },
  { rule: '不超纲', detail: '不超出通用考纲的冷僻内容' },
  { rule: '难度标注准确', detail: '标注与实际题目难度相符' },
  { rule: '时效性', detail: '数字/标准须标注来源年份或权威出处' },
];

/** 红蓝对抗自检 */
export const RED_BLUE_CHECK = {
  red: {
    name: '红军（覆盖检查）',
    tasks: ['覆盖章节地图全部 P0 考点', '题型分布合理', '难度梯度适当'],
  },
  blue: {
    name: '蓝军（挑刺检查）',
    tasks: [
      { check: '题干暗示', detail: '题干是否暗示答案' },
      { check: '漏正确项', detail: '多选是否漏掉正确选项' },
      { check: '标准过时', detail: '引用的标准/数据是否过时' },
      { check: '解析空泛', detail: '解析是否空泛无实质内容' },
    ],
  },
};

/** 错题本数据模型 */
export const MISTAKE_BOOK_SCHEMA = {
  storage: '本地 JSON（mistakes/mistakes.json），不上传',
  fields: [
    { field: 'chapter', type: 'string', desc: '章节（政治/英语/数学/专业课/真题/复试）' },
    { field: 'type', type: 'string', desc: '题型（单选/多选/计算/简答）' },
    { field: 'stem', type: 'string', desc: '题干' },
    { field: 'answer', type: 'string', desc: '正确答案' },
    { field: 'userAnswer', type: 'string', desc: '用户错选答案' },
    { field: 'date', type: 'string', desc: '日期（ISO 格式）' },
    { field: 'count', type: 'number', desc: '错误次数（累计）' },
  ],
};

/** 刷题工作流步骤 */
export const BRUSH_WORKFLOW = [
  { step: 1, name: '接收请求', action: '解析用户指定的章节、题型、数量、难度' },
  { step: 2, name: '定位章节', action: '匹配章节地图对应章，提取 P0/P1 考点' },
  { step: 3, name: '生成题目', action: '按题型规范生成 题干+选项+答案+解析（含考点出处）' },
  { step: 4, name: '质量自检', action: '套用质量标准 + 红蓝对抗自检逐题校验' },
  { step: 5, name: '格式化输出', action: '按输出格式规范格式化，附章节与难度标签' },
  { step: 6, name: '错题登记', action: '用户答错则提示可记入本地错题库' },
  { step: 7, name: '异常处理', action: '考点不明确→回退通用考纲；题干歧义→标注并建议重出' },
];

/** 刷题别名/触发词（供搜索与匹配用） */
export const BRUSH_ALIASES = [
  '考研', '研究生入学', '考研政治', '考研英语', '考研数学',
  '考研专业课', '统考', '考研刷题', '刷题', '真题', '模考',
];

/** 核心标签（考点域） */
export const CORE_TAGS = ['政治', '英语', '数学', '专业课', '真题', '复试'];
