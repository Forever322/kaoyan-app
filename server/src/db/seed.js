// 将 src/data/*.js 的参考数据导入 MySQL。
// 用法: node src/db/seed.js [--strict]
// --strict 会在发现源数据缺少院校主表关联时回滚，适合 CI/数据治理。

import { closeDB, migrate } from './index.js';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const load = (path) => import(pathToFileURL(path).href);
const strict = process.argv.includes('--strict');

function json(value) {
  return JSON.stringify(value ?? {});
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function describeMissing(kind, names) {
  if (!names.length) return;
  const preview = names.slice(0, 12).join('、');
  console.warn(`[Seed] ⚠ ${kind} 中有 ${names.length} 条记录找不到院校主表：${preview}${names.length > 12 ? '…' : ''}`);
}

async function seed() {
  console.log('[Seed] 开始导入 MySQL 参考数据...');
  const db = await migrate();
  const missing = { admissionScores: [], details: [], photos: [], requirements: [] };
  const counts = {};

  await db.transaction(async (tx) => {
    const { UNIVERSITIES } = await load(join(ROOT, 'src', 'data', 'universities.js'));
    for (const university of UNIVERSITIES) {
      await tx.execute(`INSERT INTO universities(name,province,city,zone,level,type)
        VALUES(?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE province=VALUES(province), city=VALUES(city), zone=VALUES(zone), level=VALUES(level), type=VALUES(type)`, [
        university.name,
        university.province,
        university.city || '',
        university.zone,
        university.level,
        university.type || '综合',
      ]);
    }
    counts.universities = UNIVERSITIES.length;
    const universityRows = await tx.all('SELECT id,name FROM universities');
    const universityIdByName = new Map(universityRows.map((row) => [row.name, Number(row.id)]));

    const { NATIONAL_LINES } = await load(join(ROOT, 'src', 'data', 'national-lines.js'));
    let nationalLineCount = 0;
    for (const [degreeKey, categories] of Object.entries(NATIONAL_LINES)) {
      for (const [category, zones] of Object.entries(categories)) {
        for (const [zone, years] of Object.entries(zones)) {
          for (const [year, score] of Object.entries(years)) {
            await tx.execute(`INSERT INTO national_lines(year,degree,category,zone,score) VALUES(?,?,?,?,?)
              ON DUPLICATE KEY UPDATE score=VALUES(score)`, [
              Number(year), degreeKey === 'xueshuo' ? '学硕' : '专硕', category, zone, Number(score),
            ]);
            nationalLineCount += 1;
          }
        }
      }
    }
    counts.nationalLines = nationalLineCount;

    const { ADMISSION_SCORES } = await load(join(ROOT, 'src', 'data', 'admission-scores.js'));
    let admissionScoreCount = 0;
    for (const [name, categories] of Object.entries(ADMISSION_SCORES)) {
      const universityId = universityIdByName.get(name);
      if (!universityId) {
        missing.admissionScores.push(name);
        continue;
      }
      for (const [key, years] of Object.entries(categories)) {
        const separator = key.lastIndexOf('-');
        const degree = key.slice(separator + 1);
        const category = key.slice(0, separator);
        for (const [year, score] of Object.entries(years)) {
          await tx.execute(`INSERT INTO admission_scores(university_id,year,degree,category,score) VALUES(?,?,?,?,?)
            ON DUPLICATE KEY UPDATE score=VALUES(score)`, [universityId, Number(year), degree, category, Number(score)]);
          admissionScoreCount += 1;
        }
      }
    }
    counts.admissionScores = admissionScoreCount;

    const { UNI_DETAILS } = await load(join(ROOT, 'src', 'data', 'uni-details.js'));
    let detailCount = 0;
    for (const [name, detail] of Object.entries(UNI_DETAILS)) {
      const universityId = universityIdByName.get(name);
      if (!universityId) {
        missing.details.push(name);
        continue;
      }
      const pros = list(detail.pros);
      const cons = list(detail.cons);
      await tx.execute(`INSERT INTO uni_details(
        university_id,english_name,description,address,website,phone,ranking,advantages,disadvantages,pros_json,cons_json,features
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        english_name=VALUES(english_name), description=VALUES(description), address=VALUES(address), website=VALUES(website),
        phone=VALUES(phone), ranking=VALUES(ranking), advantages=VALUES(advantages), disadvantages=VALUES(disadvantages),
        pros_json=VALUES(pros_json), cons_json=VALUES(cons_json), features=VALUES(features)`, [
        universityId,
        detail.englishName || '',
        detail.description || detail.features || '',
        detail.address || '',
        detail.website || '',
        detail.phone || '',
        detail.ranking || '',
        detail.advantages || pros.join('\n'),
        detail.disadvantages || cons.join('\n'),
        json(pros),
        json(cons),
        detail.features || '',
      ]);
      detailCount += 1;
    }
    counts.details = detailCount;

    const { UNI_PHOTOS } = await load(join(ROOT, 'src', 'data', 'uni-photos.js'));
    let photoCount = 0;
    for (const [name, photos] of Object.entries(UNI_PHOTOS)) {
      const universityId = universityIdByName.get(name);
      if (!universityId) {
        missing.photos.push(name);
        continue;
      }
      for (const photo of photos) {
        const filename = typeof photo === 'string' ? photo : photo?.filename;
        if (!filename) continue;
        const label = typeof photo === 'object' ? photo.label || '' : '';
        await tx.execute(`INSERT INTO uni_photos(university_id,filename,label) VALUES(?,?,?)
          ON DUPLICATE KEY UPDATE label=VALUES(label)`, [universityId, filename, label]);
        photoCount += 1;
      }
    }
    counts.photos = photoCount;

    const { UNI_REQUIREMENTS } = await load(join(ROOT, 'src', 'data', 'uni-requirements.js'));
    let requirementCount = 0;
    for (const [name, requirement] of Object.entries(UNI_REQUIREMENTS)) {
      const universityId = universityIdByName.get(name);
      if (!universityId) {
        missing.requirements.push(name);
        continue;
      }
      await tx.execute(`INSERT INTO uni_requirements(university_id,degree,category,requirement) VALUES(?,?,?,?)
        ON DUPLICATE KEY UPDATE requirement=VALUES(requirement)`, [universityId, '', '', json(requirement)]);
      requirementCount += 1;
    }
    counts.requirements = requirementCount;

    const missingTotal = Object.values(missing).reduce((total, names) => total + names.length, 0);
    if (strict && missingTotal) {
      throw new Error(`严格导入失败：${missingTotal} 条静态数据没有对应院校主表，请先治理数据后重试`);
    }
  });

  describeMissing('录取分数', missing.admissionScores);
  describeMissing('院校详情', missing.details);
  describeMissing('校园照片', missing.photos);
  describeMissing('报考要求', missing.requirements);

  const count = async (table) => Number((await db.one(`SELECT COUNT(*) AS count FROM \`${table}\``))?.count || 0);
  console.log('\n[Seed] ✅ MySQL 参考数据导入完成！');
  console.table({
    sourceUniversities: counts.universities,
    sourceNationalLines: counts.nationalLines,
    sourceAdmissionScores: counts.admissionScores,
    sourceDetails: counts.details,
    sourcePhotos: counts.photos,
    sourceRequirements: counts.requirements,
    universities: await count('universities'),
    nationalLines: await count('national_lines'),
    admissionScores: await count('admission_scores'),
    uniDetails: await count('uni_details'),
    uniPhotos: await count('uni_photos'),
    uniRequirements: await count('uni_requirements'),
  });
}

try {
  await seed();
} catch (error) {
  console.error('[Seed] 失败:', error?.message || error);
  process.exitCode = 1;
} finally {
  await closeDB();
}
