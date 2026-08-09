// Static catalog quality report.
//
// This tool deliberately reads the versioned source data rather than a live
// database so a release can detect broken references before `db:seed` runs.
// Usage:
//   pnpm --dir server db:audit:catalog
//   pnpm --dir server db:audit:catalog -- --json
//   pnpm --dir server db:audit:catalog -- --strict

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const jsonOutput = process.argv.includes('--json');
const strict = process.argv.includes('--strict');

async function load(relativePath) {
  return import(pathToFileURL(join(ROOT, relativePath)).href);
}

function percentage(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

function namesMissingFromMaster(recordByName, masterNames, { allow = [] } = {}) {
  const allowed = new Set(allow);
  return Object.keys(recordByName)
    .filter((name) => !masterNames.has(name) && !allowed.has(name))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function countNonEmpty(records, property) {
  return Object.values(records).filter((record) => {
    const value = record?.[property];
    return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
  }).length;
}

function scoreSchools(scores) {
  return new Set(Object.keys(scores));
}

function reportLine(label, value) {
  return `${label}: ${value}`;
}

async function run() {
  const [universityModule, scoreModule, detailModule, photoModule, requirementModule, nationalLineModule] = await Promise.all([
    load('src/data/universities.js'),
    load('src/data/admission-scores.js'),
    load('src/data/uni-details.js'),
    load('src/data/uni-photos.js'),
    load('src/data/uni-requirements.js'),
    load('src/data/national-lines.js'),
  ]);

  const universities = universityModule.UNIVERSITIES || [];
  const scores = scoreModule.ADMISSION_SCORES || {};
  const details = detailModule.UNI_DETAILS || {};
  const photos = photoModule.UNI_PHOTOS || {};
  const requirements = requirementModule.UNI_REQUIREMENTS || {};
  const nationalLines = nationalLineModule.NATIONAL_LINES || {};
  const masterNames = new Set(universities.map((university) => university.name));
  const scoreYears = new Set();
  let scoreRows = 0;
  let linkedScoreRows = 0;

  for (const [universityName, categories] of Object.entries(scores)) {
    for (const years of Object.values(categories)) {
      for (const year of Object.keys(years || {})) {
        scoreYears.add(Number(year));
        scoreRows += 1;
        if (masterNames.has(universityName)) linkedScoreRows += 1;
      }
    }
  }

  const orphaned = {
    admissionScores: namesMissingFromMaster(scores, masterNames),
    details: namesMissingFromMaster(details, masterNames),
    photos: namesMissingFromMaster(photos, masterNames),
    requirements: namesMissingFromMaster(requirements, masterNames, { allow: ['_default'] }),
  };
  const linkedScoreSchools = [...scoreSchools(scores)].filter((name) => masterNames.has(name));
  const coverage = {
    admissionScores: {
      schools: linkedScoreSchools.length,
      percentage: percentage(linkedScoreSchools.length, universities.length),
      sourceRows: scoreRows,
      linkedRows: linkedScoreRows,
      years: [...scoreYears].sort(),
    },
    details: { schools: Object.keys(details).filter((name) => masterNames.has(name)).length, percentage: percentage(Object.keys(details).filter((name) => masterNames.has(name)).length, universities.length) },
    photos: { schools: Object.keys(photos).filter((name) => masterNames.has(name)).length, percentage: percentage(Object.keys(photos).filter((name) => masterNames.has(name)).length, universities.length), count: Object.values(photos).flat().length },
    requirements: { schools: Object.keys(requirements).filter((name) => masterNames.has(name)).length, percentage: percentage(Object.keys(requirements).filter((name) => masterNames.has(name)).length, universities.length) },
    detailFields: {
      englishName: countNonEmpty(details, 'englishName'),
      description: countNonEmpty(details, 'description'),
      address: countNonEmpty(details, 'address'),
      website: countNonEmpty(details, 'website'),
      phone: countNonEmpty(details, 'phone'),
      ranking: countNonEmpty(details, 'ranking'),
      features: countNonEmpty(details, 'features'),
      pros: countNonEmpty(details, 'pros'),
      cons: countNonEmpty(details, 'cons'),
    },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    master: { universities: universities.length },
    coverage,
    orphaned,
    recommendations: [
      '先为 orphaned.admissionScores 中的院校补齐主表，避免分数资料在 seed 时被跳过。',
      '为每条招生、分数线和报考要求补充年份、来源链接、抓取时间与人工核验状态。',
      '不要将学校级通用要求展示为某专业的当年官方规则；专业和年度必须是必填维度。',
      '校景图片需要登记来源、授权/版权状态、拍摄/获取时间和 CDN 失效检测结果。',
    ],
  };

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('[Catalog Audit] 院校参考数据质量报告');
    console.log(reportLine('院校主表', report.master.universities));
    console.log(reportLine('录取分数覆盖', `${coverage.admissionScores.schools}/${universities.length} 所（${coverage.admissionScores.percentage}%），已关联 ${coverage.admissionScores.linkedRows}/${coverage.admissionScores.sourceRows} 条，年份 ${coverage.admissionScores.years.join('、') || '无'}`));
    console.log(reportLine('院校详情覆盖', `${coverage.details.schools}/${universities.length} 所（${coverage.details.percentage}%）`));
    console.log(reportLine('校园图片覆盖', `${coverage.photos.schools}/${universities.length} 所（${coverage.photos.percentage}%），${coverage.photos.count} 张`));
    console.log(reportLine('报考要求覆盖', `${coverage.requirements.schools}/${universities.length} 所（${coverage.requirements.percentage}%）`));
    console.log('详情字段覆盖：');
    for (const [field, count] of Object.entries(coverage.detailFields)) {
      console.log(`  - ${field}: ${count}/${universities.length} 所`);
    }
    for (const [kind, names] of Object.entries(orphaned)) {
      if (names.length) console.warn(`未关联主表的 ${kind}（${names.length}）：${names.join('、')}`);
    }
  }

  const orphanedCount = Object.values(orphaned).reduce((total, names) => total + names.length, 0);
  if (strict && orphanedCount) {
    throw new Error(`严格审计失败：发现 ${orphanedCount} 条资料无法关联院校主表`);
  }
}

run().catch((error) => {
  console.error('[Catalog Audit] 失败：', error?.message || error);
  process.exitCode = 1;
});
