/**
 * 批量爬取院校复试分数线 — 从 jixun.iqihang.com 提取全学科数据
 *
 * 用法:
 *   node scrape-disciplines.mjs                    # 爬取所有目标院校
 *   node scrape-disciplines.mjs --max 10           # 只爬前10所
 *   node scrape-disciplines.mjs --uni "北京大学"    # 只爬指定院校
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const OUTPUT = resolve(import.meta.dirname, 'scraped-disciplines.json');
const ADMISSION_FILE = resolve(import.meta.dirname, 'src/data/admission-scores.js');
const WAIT_BETWEEN = 2000;
const PAGE_TIMEOUT = 25000;

// 需要爬取的院校 — 有非CS学科数据的985/211
const TARGETS = [
  // 未完全验证非CS学科的985
  '武汉大学', '华中科技大学', '厦门大学', '山东大学', '天津大学',
  '电子科技大学', '重庆大学', '中南大学', '中国农业大学', '大连理工大学',
  '东北大学', '西安交通大学', '南开大学', '华南理工大学',
  // 待验证的211
  '上海财经大学', '中央财经大学', '对外经济贸易大学', '中南财经政法大学',
  '西南财经大学', '中国政法大学', '南京师范大学', '陕西师范大学',
  '东北师范大学', '华中师范大学', '西南大学', '西北大学',
  '北京林业大学', '南京农业大学', '华中农业大学',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scrapeUniversity(page, name) {
  // 直接访问 jixun.iqihang.com 的院校页面
  // URL模式: https://jixun.iqihang.com/zixun/changshi/{id}.html
  // 通过站内搜索找到页面
  const searchUrl = `https://www.baidu.com/s?wd=site%3Ajixun.iqihang.com+${encodeURIComponent(name)}+2025+%E5%A4%8D%E8%AF%95%E5%88%86%E6%95%B0%E7%BA%BF`;

  console.log(`\n[${name}] Searching via Baidu...`);

  let targetUrl = null;

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    await page.waitForTimeout(2000);

    // 从百度提取 jixun.iqihang.com 链接
    const results = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.href;
        const text = a.textContent.trim();
        if (href && href.includes('jixun.iqihang.com') && text.length > 5) {
          links.push({ title: text.substring(0, 80), url: href });
        }
      });
      return links.slice(0, 5);
    });

    if (results.length > 0) {
      targetUrl = results[0].url;
      console.log(`  → Found: ${results[0].title.substring(0, 60)}`);
    }
  } catch (e) {
    console.log(`  → Baidu search failed: ${e.message}`);
  }

  // 备选：直接用已知URL模式
  if (!targetUrl) {
    console.log(`  → Trying direct jixun search...`);
    targetUrl = `https://jixun.iqihang.com/index.php?m=content&c=index&a=show&catid=183&keyword=${encodeURIComponent(name)}`;
  }

  try {
    console.log(`  → Visiting: ${targetUrl.substring(0, 80)}...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    await page.waitForTimeout(2000);

    // 提取页面中的所有分数数据
    const scores = await page.evaluate(() => {
      const text = document.body.innerText;
      const result = {};

      // 匹配学科门类 + 总分模式
      // 如: "哲学[01] 350" "经济学 345" "法学 340"
      const disciplinePatterns = [
        /(哲学\S*)\D*(\d{3})\s*分?/g,
        /(经济学\S*)\D*(\d{3})\s*分?/g,
        /(法学\S*)\D*(\d{3})\s*分?/g,
        /(教育学\S*)\D*(\d{3})\s*分?/g,
        /(文学\S*)\D*(\d{3})\s*分?/g,
        /(历史学\S*)\D*(\d{3})\s*分?/g,
        /(理学\S*)\D*(\d{3})\s*分?/g,
        /(管理学\S*)\D*(\d{3})\s*分?/g,
        /(工学\S*)\D*(\d{3})\s*分?/g,
        /(医学\S*)\D*(\d{3})\s*分?/g,
        /(农学\S*)\D*(\d{3})\s*分?/g,
      ];

      // 尝试匹配复试基本线表格 — 学科 + 总分
      const tablePattern = /([一-龥]{2,4}(?:学|类))\s*[:：]?\s*(\d{3})\s*(?:分)?/g;
      let m;
      while ((m = tablePattern.exec(text)) !== null) {
        const discipline = m[1].replace(/[\[\]\d]/g, '').trim();
        const score = parseInt(m[2]);
        if (score >= 250 && score <= 500 && !result[discipline]) {
          result[discipline] = score;
        }
      }

      return result;
    });

    console.log(`  → Extracted: ${JSON.stringify(scores)}`);
    return { university: name, source: targetUrl, scores };

  } catch (err) {
    console.error(`  ✗ Error: ${err.message}`);
    return { university: name, source: 'search', scores: {}, error: err.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const maxIdx = args.indexOf('--max');
  const limit = maxIdx !== -1 ? parseInt(args[maxIdx + 1]) : Infinity;
  const uniIdx = args.indexOf('--uni');

  let targets = TARGETS;
  if (uniIdx !== -1) {
    targets = [args[uniIdx + 1]];
  } else if (limit) {
    targets = TARGETS.slice(0, limit);
  }

  console.log(`🎯 共 ${targets.length} 所院校\n`);

  // 恢复已有结果
  let allResults = [];
  if (existsSync(OUTPUT)) {
    allResults = JSON.parse(readFileSync(OUTPUT, 'utf8'));
    const done = new Set(allResults.map(r => r.university));
    targets = targets.filter(t => !done.has(t));
    console.log(`📂 已有 ${allResults.length} 条缓存，剩余 ${targets.length} 所需爬取\n`);
  }

  if (targets.length === 0) {
    console.log('✅ 全部完成');
    return;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
  });

  const page = await context.newPage();

  try {
    for (let i = 0; i < targets.length; i++) {
      console.log(`[${i+1}/${targets.length}] ${targets[i]}`);
      const result = await scrapeUniversity(page, targets[i]);
      allResults.push(result);

      if ((i + 1) % 3 === 0) {
        writeFileSync(OUTPUT, JSON.stringify(allResults, null, 2), 'utf8');
        console.log(`  💾 Saved at ${i+1}/${targets.length}`);
      }

      await sleep(WAIT_BETWEEN + Math.random() * 2000);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  writeFileSync(OUTPUT, JSON.stringify(allResults, null, 2), 'utf8');

  // 汇总
  console.log('\n=== 汇总 ===');
  for (const r of allResults) {
    const keys = Object.keys(r.scores);
    if (keys.length > 0) {
      console.log(`  ${r.university}: ${keys.map(k => `${k}=${r.scores[k]}`).join(', ')}`);
    } else {
      console.log(`  ${r.university}: (无数据)${r.error ? ' - ' + r.error : ''}`);
    }
  }

  console.log(`\n📁 结果: ${OUTPUT}`);
}

main().catch(err => {
  console.error('脚本失败:', err.message);
  process.exit(1);
});
