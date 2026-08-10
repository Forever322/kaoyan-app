/**
 * 小红书批量搜索脚本 — 查找2025考研复试分数线
 * 使用 Playwright Stealth 对抗反爬，提取搜索结果中的分数数据
 *
 * 用法:
 *   node batch-xhs-scraper.mjs                    # 搜索全部目标院校
 *   node batch-xhs-scraper.mjs --dry-run          # 只打印要搜索的查询
 *   node batch-xhs-scraper.mjs --max 10           # 只搜索前10所
 *   node batch-xhs-scraper.mjs --output scores.json
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ===================== 配置 =====================
const XHS_SEARCH = 'https://www.xiaohongshu.com/search_result?keyword=';
const WAIT_BETWEEN = 5000;  // 每次搜索间隔ms
const PAGE_TIMEOUT = 30000;
const OUTPUT = resolve(__dirname, 'xhs-scores.json');

// 目标院校（需要补充数据的211和双非强校）
const TARGETS = [
  // 211 院校
  '北京邮电大学',
  '西安电子科技大学',
  '南京理工大学',
  '武汉理工大学',
  '西南交通大学',
  '合肥工业大学',
  '河海大学',
  '北京交通大学',
  '华北电力大学',
  '暨南大学',
  '华南师范大学',
  '郑州大学',
  '南昌大学',
  '福州大学',
  '安徽大学',
  '上海大学',
  '苏州大学',
  '西南大学',
  '西北大学',
  '南京航空航天大学',
  // 双非强校
  '杭州电子科技大学',
  '重庆邮电大学',
  '深圳大学',
  '南京邮电大学',
  '浙江工业大学',
  '广东工业大学',
  '上海理工大学',
  '西安理工大学',
  '昆明理工大学',
  '燕山大学',
  '湘潭大学',
  '河南大学',
  '宁波大学',
  '青岛大学',
  '湖北大学',
];

// 搜索关键词模板
const QUERIES = [
  '{name} 2025考研 复试分数线',
  '{name} 2025 计算机 复试线',
  '{name} 2025 复试基本线',
];

// ===================== 工具函数 =====================
function sleep(ms) { return new Promise(r => setTimeout(r, ms + Math.random() * 2000)); }

function extractScores(text) {
  // 从文本中提取 学科+分数 的模式
  const patterns = [
    // "计算机科学与技术 320" 或 "计算机 320分"
    /(计算机\S*|软件工程|网络\S*安全|电子信息|通信\S*|电子科学\S*)\D{0,4}(\d{3})\s*分?/g,
    // "工学: 310" "经济学 345"
    /(哲学|经济学|法学|教育学|文学|历史学|理学|工学|农学|医学|管理学|艺术学|交叉学科)[：:\s]*(\d{3})/g,
    // "复试线 320" "分数线 310"
    /(复试[线分数]|分数线)[^\d]*(\d{3})/g,
    // 总分XXX 模式
    /总分[：:\s]*(\d{3})/g,
  ];

  const results = [];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const score = parseInt(m[2] || m[1]);
      if (score >= 200 && score <= 500) {
        results.push({ keyword: (m[1] || m[2] || '').trim(), score });
      }
    }
  }
  return results;
}

// ===================== 主流程 =====================
async function searchXHS(browser, query) {
  const url = XHS_SEARCH + encodeURIComponent(query);
  console.log(`  [搜索] ${query}`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    locale: 'zh-CN',
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    await page.waitForTimeout(3000); // 等动态内容加载

    // 尝试获取搜索结果
    const text = await page.evaluate(() => {
      // 小红书搜索结果在 .feeds-container 或 .search-result 区域
      const container = document.querySelector('.feeds-container, .search-result, main');
      if (!container) return document.body.innerText.slice(0, 5000);
      return container.innerText.slice(0, 5000);
    });

    const scores = extractScores(text);
    if (scores.length > 0) {
      console.log(`    → 找到 ${scores.length} 个分数:`, scores.slice(0, 5).map(s => `${s.keyword}=${s.score}`).join(', '));
    } else {
      console.log('    → 未提取到分数');
    }

    return { query, url, text: text.slice(0, 500), scores };
  } catch (err) {
    console.error(`    ✗ 搜索失败: ${err.message}`);
    return { query, url, error: err.message, scores: [] };
  } finally {
    await context.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const maxIdx = args.indexOf('--max');
  const limit = maxIdx !== -1 ? parseInt(args[maxIdx + 1]) : Infinity;
  const outputArg = args.indexOf('--output');
  const outputFile = outputArg !== -1 ? args[outputArg + 1] : OUTPUT;

  // 生成搜索查询
  const allQueries = [];
  for (const name of TARGETS.slice(0, limit)) {
    for (const tpl of QUERIES) {
      allQueries.push({ name, query: tpl.replace('{name}', name) });
    }
  }

  console.log(`\n📋 共 ${TARGETS.slice(0,limit).length} 所院校 × ${QUERIES.length} 查询模板 = ${allQueries.length} 次搜索\n`);

  if (dryRun) {
    for (const q of allQueries) console.log(`  - ${q.query}`);
    return;
  }

  // 读取已有结果（断点续搜）
  let existing = new Map();
  if (existsSync(outputFile)) {
    const old = JSON.parse(readFileSync(outputFile, 'utf8'));
    for (const r of old) existing.set(r.query, r);
    console.log(`📂 已有 ${existing.size} 条缓存结果\n`);
  }

  // 启动浏览器
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const allResults = [];
  try {
    for (let i = 0; i < allQueries.length; i++) {
      const { name, query } = allQueries[i];
      console.log(`[${i+1}/${allQueries.length}] ${name}`);

      if (existing.has(query)) {
        console.log('  → 已有缓存，跳过');
        allResults.push(existing.get(query));
        continue;
      }

      const result = await searchXHS(browser, query);
      result.university = name;
      allResults.push(result);

      // 每5次保存一次
      if ((i + 1) % 5 === 0) {
        writeFileSync(outputFile, JSON.stringify(allResults, null, 2), 'utf8');
        console.log(`  💾 已保存 ${i+1} 条结果到 ${outputFile}`);
      }

      await sleep(WAIT_BETWEEN);
    }
  } finally {
    await browser.close();
  }

  // 最终保存
  writeFileSync(outputFile, JSON.stringify(allResults, null, 2), 'utf8');

  // 汇总
  const withScores = allResults.filter(r => r.scores && r.scores.length > 0);
  console.log(`\n✅ 完成！${allResults.length} 次搜索，${withScores.length} 次找到分数`);
  console.log(`📁 结果: ${outputFile}`);

  // 打印找到的分数汇总
  if (withScores.length > 0) {
    console.log('\n📊 提取到的分数线:');
    for (const r of withScores) {
      console.log(`  ${r.university}: ${r.scores.map(s => `${s.keyword}=${s.score}`).join(', ')}`);
    }
  }
}

main().catch(err => {
  console.error('脚本失败:', err.message);
  process.exit(1);
});
