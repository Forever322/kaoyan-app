/**
 * 数据采集器 - 接受官网搜索的真实分数，存入 real-scores.json
 * 用法: node tools/data-maintenance/collect.cjs '{"学校名":{"门类":{"2025":分数,...}}}'
 * 每次WebSearch搜到真实数据后，追加到这个JSON文件
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'real-scores.json');

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {}; }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// 从命令行参数读取
const input = process.argv[2];
if (!input) {
  const existing = loadData();
  const schools = Object.keys(existing);
  let entries = 0;
  schools.forEach(s => { entries += Object.keys(existing[s]).length; });
  console.log(`real-scores.json: ${schools.length} 所学校, ${entries} 条记录`);
  if (schools.length > 0) {
    console.log('最近:', schools.slice(-5).join(', '));
  }
  process.exit(0);
}

try {
  const newData = JSON.parse(input);
  const existing = loadData();

  for (const [school, cats] of Object.entries(newData)) {
    if (!existing[school]) existing[school] = {};
    Object.assign(existing[school], cats);
  }

  saveData(existing);
  const schools = Object.keys(existing);
  let entries = 0;
  schools.forEach(s => { entries += Object.keys(existing[s]).length; });
  console.log(`✓ 已保存: ${schools.length} 所学校, ${entries} 条记录`);
} catch (e) {
  console.error('错误: 请输入有效JSON', e.message);
}
