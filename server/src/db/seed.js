// 数据迁移脚本：将 src/data/*.js 直接导入 SQLite
// 用法: node src/db/seed.js
// 依赖: better-sqlite3 (原生 SQLite，链式 API，一行导入)

import { migrate, save } from './index.js';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const load = p => import(pathToFileURL(p).href);

async function seed() {
    console.log('[Seed] 开始数据迁移...');
    const db = migrate();

    // 1. 院校 — 直接逐行 INSERT
    const { UNIVERSITIES } = await load(join(ROOT, 'src', 'data', 'universities.js'));
    const insUni = db.prepare('INSERT OR IGNORE INTO universities(name,province,city,zone,level,type) VALUES(?,?,?,?,?,?)');
    db.transaction(() => UNIVERSITIES.forEach(u => insUni.run(u.name, u.province, u.city || '', u.zone, u.level, u.type)))();
    console.log('  →', UNIVERSITIES.length, '所院校');

    // 2. 国家线
    const { NATIONAL_LINES } = await load(join(ROOT, 'src', 'data', 'national-lines.js'));
    const insNL = db.prepare('INSERT OR REPLACE INTO national_lines(year,degree,category,zone,score) VALUES(?,?,?,?,?)');
    db.transaction(() => {
        for (const [deg, cats] of Object.entries(NATIONAL_LINES))
            for (const [cat, zones] of Object.entries(cats))
                for (const [zone, years] of Object.entries(zones))
                    for (const [year, score] of Object.entries(years))
                        insNL.run(+year, deg === 'xueshuo' ? '学硕' : '专硕', cat, zone, score);
    })();
    console.log('  → 国家线已导入');

    // 3. 录取分数 — 解析 '工学-学硕' 复合 key
    const { ADMISSION_SCORES } = await load(join(ROOT, 'src', 'data', 'admission-scores.js'));
    const insAS = db.prepare('INSERT OR REPLACE INTO admission_scores(university_id,year,degree,category,score) VALUES(?,?,?,?,?)');
    let asCount = 0;
    db.transaction(() => {
        for (const [name, cats] of Object.entries(ADMISSION_SCORES)) {
            const uni = db.prepare('SELECT id FROM universities WHERE name=?').get(name);
            if (!uni) continue;
            for (const [key, years] of Object.entries(cats)) {
                const idx = key.lastIndexOf('-');
                const degree = key.slice(idx + 1), category = key.slice(0, idx);
                for (const [year, score] of Object.entries(years)) {
                    insAS.run(uni.id, +year, degree, category, score);
                    asCount++;
                }
            }
        }
    })();
    console.log('  →', asCount, '条录取分数');

    // 4. 院校详情
    const { UNI_DETAILS } = await load(join(ROOT, 'src', 'data', 'uni-details.js'));
    const insD = db.prepare('INSERT OR IGNORE INTO uni_details(university_id,english_name,description,address,website,phone,ranking,advantages,disadvantages) VALUES(?,?,?,?,?,?,?,?,?)');
    db.transaction(() => {
        for (const [name, d] of Object.entries(UNI_DETAILS)) {
            const uni = db.prepare('SELECT id FROM universities WHERE name=?').get(name);
            if (uni) insD.run(uni.id, d.englishName || '', d.description || '', d.address || '', d.website || '', d.phone || '', d.ranking || '', d.advantages || '', d.disadvantages || '');
        }
    })();
    console.log('  →', Object.keys(UNI_DETAILS).length, '所院校详情');

    // 5. 照片
    const { UNI_PHOTOS } = await load(join(ROOT, 'src', 'data', 'uni-photos.js'));
    const insP = db.prepare('INSERT INTO uni_photos(university_id,filename,label) VALUES(?,?,?)');
    db.transaction(() => {
        for (const [name, photos] of Object.entries(UNI_PHOTOS)) {
            const uni = db.prepare('SELECT id FROM universities WHERE name=?').get(name);
            if (uni) photos.forEach(p => insP.run(uni.id, p.filename || p, p.label || ''));
        }
    })();
    console.log('  → 照片已导入');

    // 6. 报考要求 — JSON blob
    const { UNI_REQUIREMENTS } = await load(join(ROOT, 'src', 'data', 'uni-requirements.js'));
    const insR = db.prepare('INSERT OR IGNORE INTO uni_requirements(university_id,requirement) VALUES(?,?)');
    let rCount = 0;
    db.transaction(() => {
        for (const [name, obj] of Object.entries(UNI_REQUIREMENTS)) {
            const uni = db.prepare('SELECT id FROM universities WHERE name=?').get(name);
            if (uni) { insR.run(uni.id, JSON.stringify(obj)); rCount++; }
        }
    })();
    console.log('  →', rCount, '所院校报考要求');

    // 统计
    save();
    const c = t => db.prepare('SELECT COUNT(*) AS c FROM ' + t).get().c;
    console.log('\n[Seed] ✅ 迁移完成！');
    console.table({
        universities: c('universities'), national_lines: c('national_lines'),
        admission_scores: c('admission_scores'), uni_details: c('uni_details'),
        uni_photos: c('uni_photos'), uni_requirements: c('uni_requirements'),
    });
}

seed().catch(e => { console.error('[Seed] 失败:', e); process.exit(1); });
