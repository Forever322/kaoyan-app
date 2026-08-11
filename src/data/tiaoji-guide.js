/**
 * 考研调剂指南数据模块
 * 来源：@user_d07d5231/kaoyan-tiaoji-skills Skill 模板数据
 * 包含：调剂搜索模式、字段定义、科目匹配标签、Markdown 输出模板
 */

/** 调剂检索搜索查询模式（替换占位符后用于搜索引擎/官网检索） */
export const SEARCH_PATTERNS = {
  placeholders: ['{year}', '{major_code}', '{major_name}', '{school}', '{province}', '{city}', '{subject}', '{year_minus_1}'],
  queries: [
    { pattern: 'site:edu.cn {year} 调剂 {major_code}', scenario: '按专业代码精确搜索' },
    { pattern: 'site:edu.cn {year} 调剂 {major_name}', scenario: '按专业名称搜索' },
    { pattern: 'site:edu.cn {year} {school} 调剂 公告', scenario: '搜索指定学校的调剂公告' },
    { pattern: 'site:edu.cn {year} {school} 研究生院 调剂', scenario: '搜索指定学校研究生院调剂页' },
    { pattern: 'site:edu.cn {year} {school} {major_code} 调剂', scenario: '指定学校+专业代码组合搜索' },
    { pattern: 'site:edu.cn {year} {major_name} 英语一 数学一 调剂', scenario: '按英一数一科目约束' },
    { pattern: 'site:edu.cn {year} {major_name} 英语二 数学二 调剂', scenario: '按英二数二科目约束' },
    { pattern: 'site:edu.cn {year} {major_name} 408 调剂', scenario: '按 408 统考科目约束' },
    { pattern: 'site:edu.cn {year} {major_name} 396 调剂', scenario: '按 396 经济类联考约束' },
    { pattern: 'site:edu.cn {year} {province} {major_name} 调剂', scenario: '按省份+专业搜索' },
    { pattern: 'site:yz.chsi.com.cn {year} 调剂 {major_name}', scenario: '研招网直接搜索' },
    { pattern: 'site:edu.cn {year_minus_1} {school} {major_name} 调剂', scenario: '搜索往年调剂公告' },
    { pattern: 'site:edu.cn {year_minus_1} {school} 复试名单 {major_name}', scenario: '搜索往年复试名单' },
    { pattern: 'site:edu.cn {year_minus_1} {school} 拟录取名单 {major_name}', scenario: '搜索往年拟录取名单' },
  ],
};

/** 官方页面类型（按优先级排列） */
export const PAGE_TYPES = {
  priority: [
    '学校研究生院官网 → 调剂公告 / 调剂通知 / 调剂工作办法',
    '学院/系官网 → 目标专业的调剂通知',
    '研招网（yz.chsi.com.cn）→ 调剂系统与官方公告',
    '省级教育考试院 → 调剂相关通知',
  ],
  highValue: [
    { type: '当前年份调剂公告', keywords: ['调剂公告', '调剂通知', '调剂工作办法', '接收调剂', '缺额', '余额'] },
    { type: '招生专业目录及初试科目', keywords: ['招生专业目录', '初试科目', '考试科目'] },
    { type: '复试/录取名单', keywords: ['复试名单', '复试成绩公示', '拟录取名单', '拟录取公示'] },
    { type: '往年调剂公告', keywords: ['缺额', '调剂名额', '接收调剂', '余额'] },
  ],
  constraintRules: [
    '原报考专业相同或相近',
    '初试科目相同或相近',
    '不接受跨门类调剂',
    '英语一可调英语二（通常单向）',
    '数学一可调数学二（通常单向）',
    '408 统考与自命题之间调剂需看学校具体要求',
  ],
};

/** 调剂数据字段定义 */
export const TIAOJI_FIELDS = [
  { field: 'school', label: '学校', notes: '大学全称' },
  { field: 'college', label: '学院', notes: '招生院系' },
  { field: 'region', label: '地区', notes: '省份或城市' },
  { field: 'major', label: '专业', notes: '专业代码+名称，或研究方向' },
  { field: 'subject_requirement', label: '科目要求', notes: '初试科目约束条件' },
  { field: 'subject_match', label: '科目匹配', notes: '明确匹配 | 间接匹配 | 明确不匹配 | 待确认' },
  { field: 'current_plan', label: '计划招生', notes: '当年计划招生人数' },
  { field: 'first_choice', label: '一志愿录取', notes: '当年一志愿已录取人数' },
  { field: 'vacancy', label: '调剂名额/缺口', notes: '计划招生 - 一志愿录取 = 缺口（仅两者均为官方数据时计算）' },
  { field: 'prev_min_score', label: '往年分数参考', notes: '标注来源类型：拟录取最低分 / 复试名单分数参考' },
  { field: 'status', label: '状态', notes: '当前可申报 | 重点关注' },
  { field: 'sources', label: '官方链接', notes: '直接链接到官方页面' },
];

/** 科目匹配标签 */
export const SUBJECT_MATCH_LABELS = {
  explicit: {
    key: '明确匹配',
    icon: '🟢',
    desc: '当前官方来源直接确认科目要求一致，或明确声明可接受的科目组合',
  },
  indirect: {
    key: '间接匹配',
    icon: '🟡',
    desc: '仅往年官方目录、间接官方证据或宽泛措辞支持匹配判断',
  },
  mismatch: {
    key: '明确不匹配',
    icon: '🔴',
    desc: '官方来源显示科目设置冲突或明确的调剂限制',
  },
  pending: {
    key: '待确认',
    icon: '⬜',
    desc: '学校接受调剂，但当前官方来源不足以判断科目兼容性',
  },
};

/** 常见科目约束检查项 */
export const SUBJECT_CHECKS = [
  { combo: '201 英语一 + 301 数学一', label: '英一数一', typical: '学硕主流组合' },
  { combo: '204 英语二 + 302 数学二', label: '英二数二', typical: '专硕主流组合' },
  { combo: '396 经济类联考', label: '396', typical: '部分经管专硕' },
  { combo: '408 计算机学科专业基础', label: '408 统考', typical: '计算机相关' },
  { combo: '自命题专业课代码一致性', label: '自命题', typical: '需对比专业课代码与大纲' },
  { combo: '原报考专业相同/相近', label: '专业对口', typical: '多数学校基本要求' },
];

/** 可执行优先级 */
export const PRIORITY_LEVELS = {
  actionable: { key: '当前可申报', className: 'tiaoji-actionable', desc: '有当年官方调剂公告或明确名额，且无已知科目冲突' },
  watch: { key: '重点关注', className: 'tiaoji-watch', desc: '符合用户地区和层次偏好，有往年调剂证据或当前强烈信号，但当年细节未公布' },
  // 执行优先级
  exec: {
    A: { label: 'A / 高优先', desc: '科目明确匹配 + 官方确认接收 + 名额明确 ≥3 人' },
    B: { label: 'B / 中优先', desc: '科目间接匹配 + 有往年调剂记录 + 学校层次匹配' },
    C: { label: 'C / 低优先', desc: '科目待确认 + 学校层次略低 + 仅有往年调剂记录' },
  },
};

/** 措辞规范 */
export const WORDING_RULES = [
  { term: '拟录取最低分', usage: '仅当官方页面为拟录取名单或最终录取公示时使用' },
  { term: '复试名单分数参考', usage: '当来源为复试名单或成绩通知时使用' },
  { term: '未说明', usage: '官方来源未披露该字段时使用' },
  { term: '间接匹配', usage: '当年官方来源无法直接确认科目兼容性时使用' },
  { term: '当前可申报', usage: '仅当学校有当年官方调剂公告或明确名额，且无已知科目冲突时使用' },
  { term: '缺口 = 计划 - 一志愿', usage: '仅当计划招生与一志愿录取均为官方公开数据且可比较时才计算' },
];

/** 调剂数据局限性标注 */
export const LIMITATIONS = [
  '图片格式（非文字）的官方页面标记为证据限制',
  'PDF 格式的页面若无法获取文本则标记',
  '当年专业目录中图片/PDF 形式的科目表需手动比对',
  '专业课为自命题时以学院复试细则中的说明为准',
  '搜集平台仅用于发现候选学校，最终数据以官方页面为准',
];

/** Markdown 输出骨架 */
export const OUTPUT_SKELETON = {
  meta: {
    titleTemplate: '{year} 年考研调剂检索：{major_code} {major_name} / {region}',
    sections: ['更新日期', '检索条件', '科目约束', '方法说明'],
  },
  /** 当前可申报表格列 */
  actionableColumns: [
    '学校', '学院', '专业/方向', '科目匹配', '{year} 计划招生',
    '{year} 一志愿录取', '{year} 调剂名额/缺口', '{prev_year} 分数参考', '状态',
  ],
  /** 重点关注表格列 */
  watchColumns: ['学校', '学院', '{prev_year} 调剂证据', '{prev_year} 分数参考', '当前判断', '备注'],
  /** 每所学校详情结构 */
  schoolDetail: [
    { field: '官方页面发布时间', required: true },
    { field: '调剂状态', required: true },
    { field: '科目判断', required: true },
    { field: '名额判断', required: false },
    { field: '分数参考', required: false },
    { field: '风险提示', required: false },
    { field: '来源链接', required: true },
  ],
};
