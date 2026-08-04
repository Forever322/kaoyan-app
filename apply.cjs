/**
 * 数据更新器 - 读取 real-scores.json，更新 admission-scores.js
 * 用法: node apply.cjs [--build]
 * --build: 同时执行 vite build + 同步到 TWA assets
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_FILE = path.join(__dirname, 'real-scores.json');
const TARGET_FILE = path.join(__dirname, 'src/data/admission-scores.js');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { console.error('real-scores.json 不存在或格式错误'); process.exit(1); }
}

function main() {
  const data = loadData();
  let content = fs.readFileSync(TARGET_FILE, 'utf8');
  let updated = 0;

  for (const [school, cats] of Object.entries(data)) {
    // 检查学校是否存在
    const uniRegex = new RegExp(`(  ${escapeRegex(school)}: \\{)([\\s\\S]*?)(\\n  \\},)`, 'm');
    const match = content.match(uniRegex);

    if (!match) {
      console.log(`  SKIP ${school}: 不在 admission-scores.js 中`);
      continue;
    }

    // 更新每个门类
    let block = match[0];
    for (const [cat, scores] of Object.entries(cats)) {
      const yearStr = Object.entries(scores)
        .sort(([a],[b]) => parseInt(b)-parseInt(a))
        .map(([y, s]) => `${y}: ${s}`)
        .join(', ');

      const catRegex = new RegExp(`('${escapeRegex(cat)}': \\{ )[^}]+( \\})`);
      if (block.match(catRegex)) {
        block = block.replace(catRegex, `$1${yearStr}$2`);
      } else {
        // 学校存在但该门类不存在，添加到末尾
        block = block.replace(/(\n  \},)/, `\n    '${cat}': { ${yearStr} },$1`);
      }
    }

    content = content.replace(uniRegex, block);
    updated++;
    console.log(`  ✓ ${school}: ${Object.keys(cats).length} 个门类`);
  }

  fs.writeFileSync(TARGET_FILE, content);
  console.log(`\n已更新 ${updated} 所学校`);

  // 可选构建
  if (process.argv.includes('--build')) {
    console.log('\n构建中...');
    execSync('npx vite build', { cwd: __dirname, stdio: 'inherit' });
    execSync('rm -rf android-twa/app/src/main/assets/*', { cwd: __dirname });
    execSync('cp -r dist/* android-twa/app/src/main/assets/', { cwd: __dirname });
    console.log('构建完成');
  }
}

main();
