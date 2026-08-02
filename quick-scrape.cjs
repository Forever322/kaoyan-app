const puppeteer = require('puppeteer');
const fs = require('fs');

const PROVS = [['11','北京'],['12','天津'],['13','河北'],['14','山西'],['15','内蒙古'],['21','辽宁'],['22','吉林'],['23','黑龙江'],['31','上海'],['32','江苏'],['33','浙江'],['34','安徽'],['35','福建'],['36','江西'],['37','山东'],['41','河南'],['42','湖北'],['43','湖南'],['44','广东'],['45','广西'],['46','海南'],['50','重庆'],['51','四川'],['52','贵州'],['53','云南'],['54','西藏'],['61','陕西'],['62','甘肃'],['63','青海'],['64','宁夏'],['65','新疆']];

async function main() {
  const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('https://yz.chsi.com.cn/zsml/dw.do', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  const result = {};

  for (const [code, name] of PROVS) {
    process.stdout.write(name + '... ');
    const schools = await page.evaluate(async (ssdm) => {
      const app = document.querySelector('#app').__vue__;
      Object.assign(app.form, {
        ssdm, ssmc: null, mldm: '', mlmc: null, yjxkdm: '',
        xwlx: '', xwlxmc: null, dwmc: '', dwdm: '',
        xxfs: '', tydxs: '', jsggjh: '',
        start: 0, curPage: 1, pageSize: 200, totalPage: 0, totalCount: 0,
      });
      app.getData();
      await new Promise(r => setTimeout(r, 4000));
      return (app.list||[]).map(s => s.dwmc).filter(Boolean);
    }, code);
    
    result[name] = [...new Set(schools)];
    console.log(result[name].length + '所');
    await new Promise(r => setTimeout(r, 1000));
  }

  fs.writeFileSync('province-schools.json', JSON.stringify(result, null, 2));
  console.log('\nDone! ' + Object.values(result).reduce((s,a)=>s+a.length,0) + ' total entries');
  await browser.close();
}

main();
