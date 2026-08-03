/**
 * 数据库种子：将静态数据文件迁移到 IndexedDB
 * 首次运行或版本升级时自动执行
 */
import { openDB, getDBStats, bulkInsertUniversities, bulkInsertScores } from './db.js';
import { UNIVERSITIES } from './data/universities.js';
import { ADMISSION_SCORES } from './data/admission-scores.js';

const SEED_VERSION = 1;
const SEED_KEY = '_db_seed_version';

/** 检查是否需要种子 */
export async function checkAndSeed() {
  await openDB();

  // 检查是否已种子化
  const currentVersion = parseInt(sessionStorage.getItem(SEED_KEY) || '0', 10);

  if (currentVersion >= SEED_VERSION) {
    const stats = await getDBStats();
    // 如果数据库非空且版本匹配，跳过
    if (stats.universitiesWithScores > 0) return stats;
  }

  console.log('[DB] Seeding database...');

  // 1. 插入院校数据
  const uniRecords = UNIVERSITIES.map(u => ({
    name: u.name,
    province: u.province,
    city: u.city || u.province,
    zone: u.zone,
    level: u.level,
    type: u.type || '综合'
  }));
  await bulkInsertUniversities(uniRecords);
  console.log('[DB] Inserted ' + uniRecords.length + ' universities');

  // 2. 插入录取分数数据
  const scoreRecords = [];
  for (const [uniName, categories] of Object.entries(ADMISSION_SCORES)) {
    for (const [catKey, yearScores] of Object.entries(categories)) {
      // 解析门类key: "工学-学硕" → category=工学, degree=学硕
      // "工学-计算机科学与技术-学硕" → category=工学, major=计算机科学与技术, degree=学硕
      // "建筑/土木-专硕" → category=建筑/土木, degree=专硕
      let category, degree, major = '';

      if (catKey.endsWith('-学硕')) {
        degree = '学硕';
        const rest = catKey.slice(0, -3); // remove "-学硕"
        const dashIdx = rest.indexOf('-');
        if (dashIdx > 0) {
          category = rest.substring(0, dashIdx);
          major = rest.substring(dashIdx + 1);
        } else {
          category = rest;
        }
      } else if (catKey.endsWith('-专硕')) {
        degree = '专硕';
        category = catKey.slice(0, -3); // remove "-专硕"
      } else {
        continue; // skip unknown format
      }

      for (const [year, score] of Object.entries(yearScores)) {
        if (score && score > 0) {
          scoreRecords.push({
            universityName: uniName,
            category,
            degree,
            major: major || '',
            year: parseInt(year, 10),
            score,
            studyMode: '全日制'
          });
        }
      }
    }
  }
  await bulkInsertScores(scoreRecords);
  console.log('[DB] Inserted ' + scoreRecords.length + ' score records');

  sessionStorage.setItem(SEED_KEY, String(SEED_VERSION));

  return await getDBStats();
}
