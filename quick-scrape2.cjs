const puppeteer = require('puppeteer');
const fs = require('fs');

const PROVS = [['21','辽宁']]; // 先测试辽宁

async function getAllSchools(page, ssdm) {
  const allSchools = new Set();
  let pageNo = 1;
  
  while (true) {
    const result = await page.evaluate(async (ssdm, pageNo) => {
      const app = document.querySelector('#app').__vue__;
      Object.assign(app.form, {
        ssdm, ssmc: '', mldm: '', mlmc: '', yjxkdm: '',
        xwlx: '', xwlxmc: '', dwmc: '', dwdm: '',
        xxfs: '', tydxs: '', jsggjh: '',
        start: (pageNo-1)*100, curPage: pageNo, pageSize: 100,
        totalPage: 0, totalCount: 0,
      });
      app.getData();
      await new Promise(r => setTimeout(r, 3000));
      return {
        schools: (app.list||[]).map(s => s.dwmc).filter(Boolean),
        total: app.total || 0,
        pageCount: Math.ceil((app.total||0)/100)
      };
    }, ssdm, pageNo);

    result.schools.forEach(s => allSchools.add(s));
    console.log(`  page ${pageNo}/${result.pageCount}: ${result.schools.length} schools (total: ${result.total})`);
    
    if (pageNo >= result.pageCount || result.schools.length === 0) break;
    pageNo++;
    await new Promise(r => setTimeout(r, 1000));
  }
  
  return [...allSchools];
}

async function main() {
  const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('https://yz.chsi.com.cn/zsml/dw.do', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  console.log('辽宁全量:');
  const schools = await getAllSchools(page, '21');
  console.log('\n辽宁共 ' + schools.length + ' 所有研招点的院校:');
  schools.forEach(s => console.log('  - ' + s));

  await browser.close();
}

main();
