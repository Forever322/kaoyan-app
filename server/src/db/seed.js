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
const STATIC_BATCH_KEY = 'project-static-catalog-v1';
const STATIC_VERIFICATION_STATUS = 'unverified';

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

async function ensureStaticImportBatch(db) {
  await db.execute(`INSERT INTO data_import_batches(
    batch_key,display_name,source_system,source_version,source_uri,status,started_at
  ) VALUES(?,?,?,?,?,'running',UTC_TIMESTAMP(3))
  ON DUPLICATE KEY UPDATE
    display_name=VALUES(display_name), source_system=VALUES(source_system), source_version=VALUES(source_version),
    source_uri=VALUES(source_uri), status='running', error_summary=NULL, started_at=UTC_TIMESTAMP(3), finished_at=NULL`, [
    STATIC_BATCH_KEY,
    '项目内置院校参考数据导入',
    'project-static-data',
    'v1',
    'app://src/data',
  ]);
  const row = await db.one('SELECT id FROM data_import_batches WHERE batch_key=?', [STATIC_BATCH_KEY]);
  if (!row) throw new Error('无法创建静态资料导入批次');
  return Number(row.id);
}

async function ensureSourceDocument(tx, {
  batchId, title, sourcePath, documentType = 'project_static_dataset',
}) {
  const existing = await tx.one(`SELECT id FROM source_documents
    WHERE import_batch_id=? AND document_type=? AND title=?
    ORDER BY id ASC LIMIT 1`, [batchId, documentType, title]);
  if (existing) {
    await tx.execute(`UPDATE source_documents
      SET source_url=?, retrieved_at=UTC_TIMESTAMP(3), verification_status=?, status='active'
      WHERE id=?`, [sourcePath, STATIC_VERIFICATION_STATUS, existing.id]);
    return Number(existing.id);
  }
  const result = await tx.execute(`INSERT INTO source_documents(
    import_batch_id,document_type,title,issuing_organization,source_url,retrieved_at,verification_status,status,metadata_json
  ) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3),?,'active',?)`, [
    batchId,
    documentType,
    title,
    '项目内置静态资料（非官方原始文件）',
    sourcePath,
    STATIC_VERIFICATION_STATUS,
    JSON.stringify({ importMode: 'seed', sourcePath }),
  ]);
  return Number(result.insertId);
}

async function recordCatalogIssue(tx, {
  batchId, entityType, entityKey, issueCode, severity = 'warning', details,
}) {
  await tx.execute(`INSERT INTO catalog_data_issues(
    entity_type,entity_key,issue_code,severity,details_json,status,import_batch_id
  ) VALUES(?,?,?,?,?,'open',?)
  ON DUPLICATE KEY UPDATE
    severity=VALUES(severity), details_json=VALUES(details_json), status='open', resolved_by_user_id=NULL,
    resolved_at=NULL, import_batch_id=VALUES(import_batch_id),
    updated_at=UTC_TIMESTAMP(3)`, [
    entityType,
    entityKey,
    issueCode,
    severity,
    JSON.stringify(details || {}),
    batchId,
  ]);
}

async function seed() {
  console.log('[Seed] 开始导入 MySQL 参考数据...');
  const db = await migrate();
  const batchId = await ensureStaticImportBatch(db);
  const missing = { admissionScores: [], details: [], photos: [], requirements: [] };
  const counts = {};

  await db.transaction(async (tx) => {
    const sourceDocumentIds = {
      universities: await ensureSourceDocument(tx, {
        batchId, title: '项目内置院校主表（待核验）', sourcePath: 'app://src/data/universities.js',
      }),
      nationalLines: await ensureSourceDocument(tx, {
        batchId, title: '项目内置国家线资料（待核验）', sourcePath: 'app://src/data/national-lines.js',
      }),
      admissionScores: await ensureSourceDocument(tx, {
        batchId, title: '项目内置院校分数资料（待核验）', sourcePath: 'app://src/data/admission-scores.js',
      }),
      details: await ensureSourceDocument(tx, {
        batchId, title: '项目内置院校详情资料（待核验）', sourcePath: 'app://src/data/uni-details.js',
      }),
      photos: await ensureSourceDocument(tx, {
        batchId, title: '项目内置校园图片资料（待核验）', sourcePath: 'app://src/data/uni-photos.js',
      }),
      requirements: await ensureSourceDocument(tx, {
        batchId, title: '项目内置报考要求资料（待核验）', sourcePath: 'app://src/data/uni-requirements.js',
      }),
    };
    const { UNIVERSITIES } = await load(join(ROOT, 'src', 'data', 'universities.js'));
    for (const university of UNIVERSITIES) {
      await tx.execute(`INSERT INTO universities(
        name,province,city,zone,level,type,official_name,source_document_id,verification_status,catalog_status
      ) VALUES(?,?,?,?,?,?,?,?,?,'active')
      ON DUPLICATE KEY UPDATE
        province=VALUES(province), city=VALUES(city), zone=VALUES(zone), level=VALUES(level), type=VALUES(type),
        official_name=COALESCE(NULLIF(official_name,''), VALUES(official_name)),
        source_document_id=COALESCE(source_document_id, VALUES(source_document_id)),
        verification_status=IF(verification_status IN ('', 'pending'), VALUES(verification_status), verification_status)`, [
        university.name,
        university.province,
        university.city || '',
        university.zone,
        university.level,
        university.type || '综合',
        university.name,
        sourceDocumentIds.universities,
        STATIC_VERIFICATION_STATUS,
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
            await tx.execute(`INSERT INTO national_lines(
              year,degree,category,zone,score,source_document_id,verification_status,catalog_status,retrieved_at
            ) VALUES(?,?,?,?,?,?,?,'active',UTC_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE
              score=VALUES(score), source_document_id=COALESCE(source_document_id, VALUES(source_document_id)),
              verification_status=IF(verification_status IN ('', 'pending'), VALUES(verification_status), verification_status),
              retrieved_at=COALESCE(retrieved_at, VALUES(retrieved_at))`, [
              Number(year), degreeKey === 'xueshuo' ? '学硕' : '专硕', category, zone, Number(score),
              sourceDocumentIds.nationalLines, STATIC_VERIFICATION_STATUS,
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
          await tx.execute(`INSERT INTO admission_scores(
            university_id,year,degree,category,score,source_document_id,verification_status,catalog_status,retrieved_at
          ) VALUES(?,?,?,?,?,?,?,'active',UTC_TIMESTAMP(3))
          ON DUPLICATE KEY UPDATE
            score=VALUES(score), source_document_id=COALESCE(source_document_id, VALUES(source_document_id)),
            verification_status=IF(verification_status IN ('', 'pending'), VALUES(verification_status), verification_status),
            retrieved_at=COALESCE(retrieved_at, VALUES(retrieved_at))`, [
            universityId, Number(year), degree, category, Number(score),
            sourceDocumentIds.admissionScores, STATIC_VERIFICATION_STATUS,
          ]);
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
        university_id,english_name,description,address,website,phone,ranking,advantages,disadvantages,pros_json,cons_json,features,
        source_document_id,verification_status,catalog_status,retrieved_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
        english_name=VALUES(english_name), description=VALUES(description), address=VALUES(address), website=VALUES(website),
        phone=VALUES(phone), ranking=VALUES(ranking), advantages=VALUES(advantages), disadvantages=VALUES(disadvantages),
        pros_json=VALUES(pros_json), cons_json=VALUES(cons_json), features=VALUES(features),
        source_document_id=COALESCE(source_document_id, VALUES(source_document_id)),
        verification_status=IF(verification_status IN ('', 'pending'), VALUES(verification_status), verification_status),
        retrieved_at=COALESCE(retrieved_at, VALUES(retrieved_at))`, [
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
        sourceDocumentIds.details,
        STATIC_VERIFICATION_STATUS,
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
        await tx.execute(`INSERT INTO uni_photos(
          university_id,filename,label,source_url,copyright_status,source_document_id,verification_status,catalog_status,retrieved_at
        ) VALUES(?,?,?,?,?,?,?,'active',UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
          label=VALUES(label), source_url=IF(source_url='', VALUES(source_url), source_url),
          source_document_id=COALESCE(source_document_id, VALUES(source_document_id)),
          verification_status=IF(verification_status IN ('', 'pending'), VALUES(verification_status), verification_status),
          retrieved_at=COALESCE(retrieved_at, VALUES(retrieved_at))`, [
          universityId, filename, label, filename, 'unknown', sourceDocumentIds.photos, STATIC_VERIFICATION_STATUS,
        ]);
        photoCount += 1;
      }
    }
    counts.photos = photoCount;

    const { UNI_REQUIREMENTS } = await load(join(ROOT, 'src', 'data', 'uni-requirements.js'));
    let requirementCount = 0;
    for (const [name, requirement] of Object.entries(UNI_REQUIREMENTS)) {
      // `_default` is a UI fallback template, not a claim about a real
      // university. It must never be imported or presented as school data.
      if (name === '_default') continue;
      const universityId = universityIdByName.get(name);
      if (!universityId) {
        missing.requirements.push(name);
        continue;
      }
      await tx.execute(`INSERT INTO uni_requirements(
        university_id,degree,category,requirement,source_document_id,verification_status,catalog_status,retrieved_at
      ) VALUES(?,?,?,?,?,?,'active',UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE
        requirement=VALUES(requirement), source_document_id=COALESCE(source_document_id, VALUES(source_document_id)),
        verification_status=IF(verification_status IN ('', 'pending'), VALUES(verification_status), verification_status),
        retrieved_at=COALESCE(retrieved_at, VALUES(retrieved_at))`, [
        universityId, '', '', json(requirement), sourceDocumentIds.requirements, STATIC_VERIFICATION_STATUS,
      ]);
      requirementCount += 1;
    }
    counts.requirements = requirementCount;

    for (const name of missing.admissionScores) {
      await recordCatalogIssue(tx, {
        batchId,
        entityType: 'admission_score_source',
        entityKey: name,
        issueCode: 'missing_university_reference',
        severity: 'error',
        details: { source: 'src/data/admission-scores.js', universityName: name },
      });
    }
    for (const name of missing.details) {
      await recordCatalogIssue(tx, {
        batchId,
        entityType: 'university_detail_source',
        entityKey: name,
        issueCode: 'missing_university_reference',
        severity: 'error',
        details: { source: 'src/data/uni-details.js', universityName: name },
      });
    }
    for (const name of missing.photos) {
      await recordCatalogIssue(tx, {
        batchId,
        entityType: 'university_photo_source',
        entityKey: name,
        issueCode: 'missing_university_reference',
        severity: 'error',
        details: { source: 'src/data/uni-photos.js', universityName: name },
      });
    }
    for (const name of missing.requirements) {
      await recordCatalogIssue(tx, {
        batchId,
        entityType: 'university_requirement_source',
        entityKey: name,
        issueCode: 'ambiguous_or_missing_university_alias',
        severity: 'warning',
        details: { source: 'src/data/uni-requirements.js', universityName: name },
      });
    }

    const missingTotal = Object.values(missing).reduce((total, names) => total + names.length, 0);
    if (strict && missingTotal) {
      throw new Error(`严格导入失败：${missingTotal} 条静态数据没有对应院校主表，请先治理数据后重试`);
    }
  }).catch(async (error) => {
    // Keep a failed batch visible to operations without masking the original
    // import error.  This is intentionally outside the rolled-back data tx.
    await db.execute(`UPDATE data_import_batches
      SET status='failed', error_summary=?, finished_at=UTC_TIMESTAMP(3)
      WHERE id=?`, [String(error?.message || error).slice(0, 4000), batchId]).catch(() => {});
    throw error;
  });

  const importedRecordCount = Object.values(counts).reduce((total, count) => total + Number(count || 0), 0);
  await db.execute(`UPDATE data_import_batches
    SET status='succeeded', record_count=?, finished_at=UTC_TIMESTAMP(3), error_summary=NULL
    WHERE id=?`, [importedRecordCount, batchId]);

  describeMissing('录取分数', missing.admissionScores);
  describeMissing('院校详情', missing.details);
  describeMissing('校园照片', missing.photos);
  describeMissing('报考要求', missing.requirements);

  const count = async (table) => Number((await db.one(`SELECT COUNT(*) AS count FROM \`${table}\``))?.count || 0);
  console.log('\n[Seed] ✅ MySQL 参考数据导入完成！');
  console.table({
    universitiesImported: counts.universities,
    nationalLinesImported: counts.nationalLines,
    admissionScoresImported: counts.admissionScores,
    detailsImported: counts.details,
    photosImported: counts.photos,
    requirementsImported: counts.requirements,
    universities: await count('universities'),
    nationalLines: await count('national_lines'),
    admissionScores: await count('admission_scores'),
    uniDetails: await count('uni_details'),
    uniPhotos: await count('uni_photos'),
    uniRequirements: await count('uni_requirements'),
    catalogDataIssues: await count('catalog_data_issues'),
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
