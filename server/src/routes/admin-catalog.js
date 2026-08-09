import { Router } from 'express';
import { getDB } from '../db/index.js';
import { requireAdministrator } from '../middleware/admin-auth.js';
import { requestAuditMetadata, safeAuditSnapshot, writeAdminAudit } from '../services/admin-audit-service.js';

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 10_000;
const UNIVERSITY_LEVELS = new Set(['985', '211', '双一流', '双非']);
const UNIVERSITY_ZONES = new Set(['A', 'B']);
const CATALOG_STATUSES = new Set(['active', 'archived']);
const VERIFICATION_STATUSES = new Set(['pending', 'verified', 'unverified', 'needs_review', 'rejected']);
const ISSUE_STATUSES = new Set(['open', 'resolved', 'ignored']);
const ISSUE_SEVERITIES = new Set(['info', 'warning', 'error', 'critical']);

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function scalar(value, field) {
  if (Array.isArray(value)) throw requestError(`${field} 只能传一个值`);
  return value;
}

function positiveInteger(value, field, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/u.test(text)) throw requestError(`${field} 必须是 ${min}–${max} 的整数`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw requestError(`${field} 必须是 ${min}–${max} 的整数`);
  return number;
}

function parsePagination(query = {}) {
  const page = query.page === undefined || String(query.page).trim() === ''
    ? 1 : positiveInteger(scalar(query.page, 'page'), 'page', { max: MAX_PAGE });
  const pageSize = query.pageSize === undefined || String(query.pageSize).trim() === ''
    ? PAGE_SIZE : positiveInteger(scalar(query.pageSize, 'pageSize'), 'pageSize', { max: MAX_PAGE_SIZE });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null) return '';
  const text = String(scalar(value, field)).trim();
  if (text.length > maxLength) throw requestError(`${field} 不能超过 ${maxLength} 个字符`);
  return text;
}

function requiredText(value, field, maxLength) {
  if (typeof value !== 'string') throw requestError(`${field} 必须是字符串`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw requestError(`${field} 长度需为 1–${maxLength}`);
  return text;
}

function optionalPatchText(value, field, maxLength, maxBytes = null) {
  if (typeof value !== 'string') throw requestError(`${field} 必须是字符串`);
  const text = value.trim();
  if (text.length > maxLength) throw requestError(`${field} 不能超过 ${maxLength} 个字符`);
  if (maxBytes !== null && Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw requestError(`${field} 不能超过 ${maxBytes} 字节`);
  }
  return text;
}

function asPlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw requestError(`${field} 必须是对象`);
  }
  return value;
}

function assertAllowedFields(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw requestError(`${label} 不支持字段 ${key}`);
  }
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function boolOrNull(value, field) {
  if (value === null) return null;
  if (typeof value !== 'boolean') throw requestError(`${field} 必须是布尔值或 null`);
  return value;
}

function boundedStringArray(value, field, { maxItems = 30, maxLength = 160 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) throw requestError(`${field} 必须是不超过 ${maxItems} 项的数组`);
  return value.map((item, index) => requiredText(item, `${field}[${index}]`, maxLength));
}

function parseOptionalSourceDocumentId(value, field = 'sourceDocumentId') {
  if (value === null) return null;
  return positiveInteger(value, field);
}

function toBoolean(value) {
  return value === null || value === undefined ? null : Boolean(Number(value));
}

function publicUniversity(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name || '',
    officialName: row.official_name || '',
    institutionCode: row.institution_code || '',
    foundedYear: row.founded_year === null || row.founded_year === undefined ? null : Number(row.founded_year),
    administrativeLevel: row.administrative_level || '',
    affiliation: row.affiliation || '',
    isDoubleFirstClass: toBoolean(row.is_double_first_class),
    is985: toBoolean(row.is_985),
    is211: toBoolean(row.is_211),
    tags: parseJson(row.tags_json, []),
    province: row.province || '',
    city: row.city || '',
    zone: row.zone || 'A',
    level: row.level || '双非',
    type: row.type || '综合',
    sourceDocumentId: numberOrNull(row.source_document_id),
    verificationStatus: row.verification_status || 'pending',
    catalogStatus: row.catalog_status || 'active',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function publicDetail(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    englishName: row.english_name || '',
    description: row.description || '',
    address: row.address || '',
    website: row.website || '',
    phone: row.phone || '',
    ranking: row.ranking || '',
    advantages: row.advantages || '',
    disadvantages: row.disadvantages || '',
    pros: parseJson(row.pros_json, []),
    cons: parseJson(row.cons_json, []),
    features: row.features || '',
    sourceDocumentId: numberOrNull(row.source_document_id),
    verificationStatus: row.verification_status || 'pending',
    catalogStatus: row.catalog_status || 'active',
    retrievedAt: row.retrieved_at || null,
  };
}

function auditText(value, maxLength = 800) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function auditStringList(value, { maxItems = 20, maxLength = 300 } = {}) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => auditText(item, maxLength)) : [];
}

export function adminUniversitySnapshot(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    province: record.province,
    city: record.city,
    zone: record.zone,
    level: record.level,
    type: record.type,
    institutionCode: record.institutionCode,
    verificationStatus: record.verificationStatus,
    catalogStatus: record.catalogStatus,
    detail: record.detail ? {
      englishName: auditText(record.detail.englishName, 120),
      address: auditText(record.detail.address, 180),
      website: auditText(record.detail.website, 180),
      phone: auditText(record.detail.phone, 64),
      ranking: auditText(record.detail.ranking, 64),
      description: auditText(record.detail.description, 300),
      advantages: auditText(record.detail.advantages, 300),
      disadvantages: auditText(record.detail.disadvantages, 300),
      pros: auditStringList(record.detail.pros, { maxItems: 8, maxLength: 80 }),
      cons: auditStringList(record.detail.cons, { maxItems: 8, maxLength: 80 }),
      features: auditText(record.detail.features, 300),
      verificationStatus: record.detail.verificationStatus,
      catalogStatus: record.detail.catalogStatus,
    } : null,
  };
}

function publicIssue(row) {
  return {
    id: Number(row.id),
    entityType: row.entity_type || '',
    entityKey: row.entity_key || '',
    issueCode: row.issue_code || '',
    severity: row.severity || 'warning',
    details: parseJson(row.details_json, null),
    status: row.status || 'open',
    sourceDocument: row.source_document_id ? {
      id: Number(row.source_document_id),
      title: row.source_document_title || '',
    } : null,
    resolvedBy: row.resolved_by_user_id ? {
      id: Number(row.resolved_by_user_id),
      username: row.resolved_by_username || '',
    } : null,
    resolvedAt: row.resolved_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function parseUniversityPayload(body, { create = false } = {}) {
  const input = asPlainObject(body, '请求体');
  const allowed = new Set([
    'name', 'officialName', 'institutionCode', 'foundedYear', 'administrativeLevel', 'affiliation',
    'isDoubleFirstClass', 'is985', 'is211', 'tags', 'province', 'city', 'zone', 'level', 'type',
    'sourceDocumentId', 'verificationStatus', 'catalogStatus', 'detail',
  ]);
  assertAllowedFields(input, allowed, '院校资料');
  if (create && (!Object.hasOwn(input, 'name') || !Object.hasOwn(input, 'province'))) {
    throw requestError('创建院校时必须提供 name 和 province');
  }
  if (!create && Object.keys(input).length === 0) throw requestError('请至少提供一个要更新的院校字段');

  const patch = {};
  if (Object.hasOwn(input, 'name')) patch.name = requiredText(input.name, 'name', 191);
  if (Object.hasOwn(input, 'officialName')) patch.officialName = optionalPatchText(input.officialName, 'officialName', 191);
  if (Object.hasOwn(input, 'institutionCode')) patch.institutionCode = optionalPatchText(input.institutionCode, 'institutionCode', 64);
  if (Object.hasOwn(input, 'foundedYear')) {
    if (input.foundedYear === null || input.foundedYear === '') patch.foundedYear = null;
    else patch.foundedYear = positiveInteger(input.foundedYear, 'foundedYear', { min: 1800, max: 2100 });
  }
  if (Object.hasOwn(input, 'administrativeLevel')) patch.administrativeLevel = optionalPatchText(input.administrativeLevel, 'administrativeLevel', 64);
  if (Object.hasOwn(input, 'affiliation')) patch.affiliation = optionalPatchText(input.affiliation, 'affiliation', 191);
  if (Object.hasOwn(input, 'isDoubleFirstClass')) patch.isDoubleFirstClass = boolOrNull(input.isDoubleFirstClass, 'isDoubleFirstClass');
  if (Object.hasOwn(input, 'is985')) patch.is985 = boolOrNull(input.is985, 'is985');
  if (Object.hasOwn(input, 'is211')) patch.is211 = boolOrNull(input.is211, 'is211');
  if (Object.hasOwn(input, 'tags')) patch.tags = boundedStringArray(input.tags, 'tags', { maxItems: 30, maxLength: 64 });
  if (Object.hasOwn(input, 'province')) patch.province = requiredText(input.province, 'province', 64);
  if (Object.hasOwn(input, 'city')) patch.city = optionalPatchText(input.city, 'city', 64);
  if (Object.hasOwn(input, 'zone')) {
    if (!UNIVERSITY_ZONES.has(input.zone)) throw requestError('zone 只能是 A 或 B');
    patch.zone = input.zone;
  }
  if (Object.hasOwn(input, 'level')) {
    if (!UNIVERSITY_LEVELS.has(input.level)) throw requestError('level 不合法');
    patch.level = input.level;
  }
  if (Object.hasOwn(input, 'type')) patch.type = optionalPatchText(input.type, 'type', 64) || '综合';
  if (Object.hasOwn(input, 'sourceDocumentId')) patch.sourceDocumentId = parseOptionalSourceDocumentId(input.sourceDocumentId);
  if (Object.hasOwn(input, 'verificationStatus')) {
    if (!VERIFICATION_STATUSES.has(input.verificationStatus)) throw requestError('verificationStatus 不合法');
    patch.verificationStatus = input.verificationStatus;
  }
  if (Object.hasOwn(input, 'catalogStatus')) {
    if (!CATALOG_STATUSES.has(input.catalogStatus)) throw requestError('catalogStatus 不合法');
    patch.catalogStatus = input.catalogStatus;
  }
  if (Object.hasOwn(input, 'detail')) patch.detail = parseDetailPayload(input.detail);
  return patch;
}

function parseDetailPayload(value) {
  const input = asPlainObject(value, 'detail');
  const allowed = new Set([
    'englishName', 'description', 'address', 'website', 'phone', 'ranking', 'advantages', 'disadvantages',
    'pros', 'cons', 'features', 'sourceDocumentId', 'verificationStatus', 'catalogStatus',
  ]);
  assertAllowedFields(input, allowed, 'detail');
  const patch = {};
  const textFields = new Map([
    ['englishName', [191, 764]], ['description', [30_000, 60_000]], ['address', [500, 2_000]], ['website', [500, 2_000]], ['phone', [128, 512]],
    ['ranking', [128, 512]], ['advantages', [30_000, 60_000]], ['disadvantages', [30_000, 60_000]], ['features', [60_000, 240_000]],
  ]);
  for (const [key, [maxLength, maxBytes]] of textFields) {
    if (Object.hasOwn(input, key)) patch[key] = optionalPatchText(input[key], `detail.${key}`, maxLength, maxBytes);
  }
  if (Object.hasOwn(input, 'pros')) patch.pros = boundedStringArray(input.pros, 'detail.pros', { maxItems: 60, maxLength: 1_000 });
  if (Object.hasOwn(input, 'cons')) patch.cons = boundedStringArray(input.cons, 'detail.cons', { maxItems: 60, maxLength: 1_000 });
  if (Object.hasOwn(input, 'sourceDocumentId')) patch.sourceDocumentId = parseOptionalSourceDocumentId(input.sourceDocumentId, 'detail.sourceDocumentId');
  if (Object.hasOwn(input, 'verificationStatus')) {
    if (!VERIFICATION_STATUSES.has(input.verificationStatus)) throw requestError('detail.verificationStatus 不合法');
    patch.verificationStatus = input.verificationStatus;
  }
  if (Object.hasOwn(input, 'catalogStatus')) {
    if (!CATALOG_STATUSES.has(input.catalogStatus)) throw requestError('detail.catalogStatus 不合法');
    patch.catalogStatus = input.catalogStatus;
  }
  return patch;
}

async function sourceDocumentExists(db, id) {
  if (id === null || id === undefined) return true;
  return Boolean(await db.one('SELECT id FROM source_documents WHERE id=?', [id]));
}

function mergeUniversity(row, patch) {
  const current = publicUniversity(row);
  return {
    name: patch.name ?? current.name,
    officialName: patch.officialName ?? current.officialName,
    institutionCode: patch.institutionCode ?? current.institutionCode,
    foundedYear: Object.hasOwn(patch, 'foundedYear') ? patch.foundedYear : current.foundedYear,
    administrativeLevel: patch.administrativeLevel ?? current.administrativeLevel,
    affiliation: patch.affiliation ?? current.affiliation,
    isDoubleFirstClass: Object.hasOwn(patch, 'isDoubleFirstClass') ? patch.isDoubleFirstClass : current.isDoubleFirstClass,
    is985: Object.hasOwn(patch, 'is985') ? patch.is985 : current.is985,
    is211: Object.hasOwn(patch, 'is211') ? patch.is211 : current.is211,
    tags: patch.tags ?? current.tags,
    province: patch.province ?? current.province,
    city: patch.city ?? current.city,
    zone: patch.zone ?? current.zone,
    level: patch.level ?? current.level,
    type: patch.type ?? current.type,
    sourceDocumentId: Object.hasOwn(patch, 'sourceDocumentId') ? patch.sourceDocumentId : current.sourceDocumentId,
    verificationStatus: patch.verificationStatus ?? current.verificationStatus,
    catalogStatus: patch.catalogStatus ?? current.catalogStatus,
  };
}

function mergeDetail(row, patch, defaults) {
  const current = publicDetail(row) || {};
  return {
    englishName: patch.englishName ?? current.englishName ?? '',
    description: patch.description ?? current.description ?? '',
    address: patch.address ?? current.address ?? '',
    website: patch.website ?? current.website ?? '',
    phone: patch.phone ?? current.phone ?? '',
    ranking: patch.ranking ?? current.ranking ?? '',
    advantages: patch.advantages ?? current.advantages ?? '',
    disadvantages: patch.disadvantages ?? current.disadvantages ?? '',
    pros: patch.pros ?? current.pros ?? [],
    cons: patch.cons ?? current.cons ?? [],
    features: patch.features ?? current.features ?? '',
    sourceDocumentId: Object.hasOwn(patch, 'sourceDocumentId') ? patch.sourceDocumentId : (current.sourceDocumentId ?? null),
    verificationStatus: patch.verificationStatus ?? current.verificationStatus ?? defaults.verificationStatus,
    catalogStatus: patch.catalogStatus ?? current.catalogStatus ?? defaults.catalogStatus,
  };
}

async function selectUniversity(db, id, { forUpdate = false } = {}) {
  const university = await db.one(`SELECT * FROM universities WHERE id=?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  if (!university) return null;
  const detail = await db.one(`SELECT * FROM uni_details WHERE university_id=?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  return { university, detail };
}

async function publicUniversityRecord(db, id, { includeRelationCounts = false } = {}) {
  const record = await selectUniversity(db, id);
  if (!record) return null;
  const output = { ...publicUniversity(record.university), detail: publicDetail(record.detail) };
  if (!includeRelationCounts) return output;
  const [programs, photos, scores] = await Promise.all([
    db.one('SELECT COUNT(*) AS total FROM programs WHERE university_id=?', [id]),
    db.one('SELECT COUNT(*) AS total FROM uni_photos WHERE university_id=?', [id]),
    db.one('SELECT COUNT(*) AS total FROM admission_scores WHERE university_id=?', [id]),
  ]);
  output.relationCounts = {
    programs: Number(programs?.total || 0),
    photos: Number(photos?.total || 0),
    admissionScores: Number(scores?.total || 0),
  };
  return output;
}

async function writeDetail(db, universityId, existing, patch, defaults) {
  const value = mergeDetail(existing, patch, defaults);
  if (!(await sourceDocumentExists(db, value.sourceDocumentId))) throw requestError('detail.sourceDocumentId 对应来源文件不存在');
  await db.execute(`INSERT INTO uni_details(
    university_id,english_name,description,address,website,phone,ranking,advantages,disadvantages,pros_json,cons_json,features,
    source_document_id,verification_status,catalog_status,retrieved_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))
  ON DUPLICATE KEY UPDATE
    english_name=VALUES(english_name),description=VALUES(description),address=VALUES(address),website=VALUES(website),
    phone=VALUES(phone),ranking=VALUES(ranking),advantages=VALUES(advantages),disadvantages=VALUES(disadvantages),
    pros_json=VALUES(pros_json),cons_json=VALUES(cons_json),features=VALUES(features),source_document_id=VALUES(source_document_id),
    verification_status=VALUES(verification_status),catalog_status=VALUES(catalog_status),retrieved_at=VALUES(retrieved_at)`, [
    universityId, value.englishName, value.description, value.address, value.website, value.phone, value.ranking,
    value.advantages, value.disadvantages, JSON.stringify(value.pros), JSON.stringify(value.cons), value.features,
    value.sourceDocumentId, value.verificationStatus, value.catalogStatus,
  ]);
}

export async function synchronizeLegacyCatalogStatus(db, universityId, catalogStatus) {
  // A parent archive/restore is a lifecycle operation, not a hard delete. Keep
  // every legacy child in the same visibility state so public school detail,
  // matching and favorite flows cannot surface a half-archived record.
  for (const table of ['uni_details', 'uni_photos', 'admission_scores', 'uni_requirements']) {
    await db.execute(`UPDATE ${table} SET catalog_status=? WHERE university_id=?`, [catalogStatus, universityId]);
  }
}

async function writeCatalogChange(db, { actorUserId, universityId, operation, before, after, changedFields }) {
  await db.execute(`INSERT INTO catalog_change_log(
    entity_type,entity_id,operation,changed_fields_json,before_json,after_json,actor_user_id
  ) VALUES(?,?,?,?,?,?,?)`, [
    'university', String(universityId), operation, JSON.stringify(changedFields),
    JSON.stringify(adminUniversitySnapshot(before)), JSON.stringify(adminUniversitySnapshot(after)), actorUserId,
  ]);
}

function changedKeys(before, after) {
  const prior = adminUniversitySnapshot(before) || {};
  const next = adminUniversitySnapshot(after) || {};
  return Object.keys(next).filter((key) => JSON.stringify(prior[key]) !== JSON.stringify(next[key]));
}

function asPagination(query, total) {
  return { page: query.page, pageSize: query.pageSize, total, totalPages: total ? Math.ceil(total / query.pageSize) : 0 };
}

function withTransaction(db, task) {
  return typeof db.transaction === 'function' ? db.transaction(task) : task(db);
}

/**
 * Admin-only catalog operations.  These routes intentionally archive records
 * instead of hard-deleting a university, preserving favorites and historical
 * admissions data for auditability.
 */
export function createAdminCatalogRouter({
  database = getDB,
  authenticate = requireAdministrator,
  audit = writeAdminAudit,
} = {}) {
  const router = Router();

  router.get('/universities', async (req, res, next) => {
    try {
      const query = parsePagination(req.query || {});
      const keyword = optionalText(req.query?.keyword, 'keyword', 100);
      const catalogStatus = optionalText(req.query?.catalogStatus, 'catalogStatus', 32);
      if (catalogStatus && !CATALOG_STATUSES.has(catalogStatus)) throw requestError('catalogStatus 不合法');
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const clauses = [];
      const params = [];
      if (keyword) {
        const like = `%${keyword}%`;
        clauses.push('(u.name LIKE ? OR u.province LIKE ? OR u.city LIKE ? OR u.institution_code LIKE ?)');
        params.push(like, like, like, like);
      }
      if (catalogStatus) { clauses.push('u.catalog_status=?'); params.push(catalogStatus); }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const total = Number((await db.one(`SELECT COUNT(*) AS total FROM universities u${where}`, params))?.total || 0);
      const rows = await db.all(`SELECT u.* FROM universities u${where}
        ORDER BY u.catalog_status='active' DESC,u.updated_at DESC,u.id DESC LIMIT ${query.pageSize} OFFSET ${query.offset}`, params);
      return res.json({ ...asPagination(query, total), data: rows.map(publicUniversity) });
    } catch (error) { return next(error); }
  });

  router.get('/universities/:id', async (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id, 'universityId');
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const university = await publicUniversityRecord(db, id, { includeRelationCounts: true });
      if (!university) return res.status(404).json({ error: '院校不存在' });
      return res.json(university);
    } catch (error) { return next(error); }
  });

  router.post('/universities', async (req, res, next) => {
    try {
      const patch = parseUniversityPayload(req.body || {}, { create: true });
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const created = await withTransaction(db, async (tx) => {
        if (patch.sourceDocumentId !== undefined && !(await sourceDocumentExists(tx, patch.sourceDocumentId))) {
          throw requestError('sourceDocumentId 对应来源文件不存在');
        }
        const data = {
          ...mergeUniversity({
            id: 0, name: '', official_name: '', institution_code: '', founded_year: null, administrative_level: '', affiliation: '',
            is_double_first_class: null, is_985: null, is_211: null, tags_json: '[]', province: '', city: '', zone: 'A', level: '双非',
            type: '综合', source_document_id: null, verification_status: 'pending', catalog_status: 'active',
          }, patch),
        };
        const result = await tx.execute(`INSERT INTO universities(
          name,official_name,institution_code,founded_year,administrative_level,affiliation,is_double_first_class,is_985,is_211,tags_json,
          province,city,zone,level,type,source_document_id,verification_status,catalog_status
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
          data.name, data.officialName || null, data.institutionCode || null, data.foundedYear, data.administrativeLevel,
          data.affiliation, data.isDoubleFirstClass, data.is985, data.is211, JSON.stringify(data.tags), data.province, data.city,
          data.zone, data.level, data.type, data.sourceDocumentId, data.verificationStatus, data.catalogStatus,
        ]);
        const id = Number(result.insertId);
        if (patch.detail) await writeDetail(tx, id, null, patch.detail, data);
        const output = await publicUniversityRecord(tx, id);
        await writeCatalogChange(tx, { actorUserId: actor.id, universityId: id, operation: 'create', before: null, after: output, changedFields: Object.keys(patch) });
        await audit(tx, {
          actorUserId: actor.id, action: 'catalog.university.create', resourceType: 'university', resourceId: String(id),
          ...requestAuditMetadata(req), after: adminUniversitySnapshot(output), metadata: { changedFields: Object.keys(patch) },
        });
        return output;
      });
      return res.status(201).json({ university: created });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') error.status = 409;
      return next(error);
    }
  });

  router.patch('/universities/:id', async (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id, 'universityId');
      const patch = parseUniversityPayload(req.body || {});
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const updated = await withTransaction(db, async (tx) => {
        const current = await selectUniversity(tx, id, { forUpdate: true });
        if (!current) throw requestError('院校不存在', 404);
        const before = { ...publicUniversity(current.university), detail: publicDetail(current.detail) };
        const nextUniversity = mergeUniversity(current.university, patch);
        if (patch.sourceDocumentId !== undefined && !(await sourceDocumentExists(tx, patch.sourceDocumentId))) {
          throw requestError('sourceDocumentId 对应来源文件不存在');
        }
        await tx.execute(`UPDATE universities SET
          name=?,official_name=?,institution_code=?,founded_year=?,administrative_level=?,affiliation=?,is_double_first_class=?,is_985=?,is_211=?,tags_json=?,
          province=?,city=?,zone=?,level=?,type=?,source_document_id=?,verification_status=?,catalog_status=? WHERE id=?`, [
          nextUniversity.name, nextUniversity.officialName || null, nextUniversity.institutionCode || null, nextUniversity.foundedYear,
          nextUniversity.administrativeLevel, nextUniversity.affiliation, nextUniversity.isDoubleFirstClass, nextUniversity.is985,
          nextUniversity.is211, JSON.stringify(nextUniversity.tags), nextUniversity.province, nextUniversity.city, nextUniversity.zone,
          nextUniversity.level, nextUniversity.type, nextUniversity.sourceDocumentId, nextUniversity.verificationStatus,
          nextUniversity.catalogStatus, id,
        ]);
        if (patch.detail) await writeDetail(tx, id, current.detail, patch.detail, nextUniversity);
        if (Object.hasOwn(patch, 'catalogStatus') && patch.catalogStatus !== before.catalogStatus) {
          await synchronizeLegacyCatalogStatus(tx, id, nextUniversity.catalogStatus);
        }
        const output = await publicUniversityRecord(tx, id);
        const keys = changedKeys(before, output);
        if (patch.detail && !keys.includes('detail')) keys.push('detail');
        await writeCatalogChange(tx, { actorUserId: actor.id, universityId: id, operation: 'update', before, after: output, changedFields: keys });
        await audit(tx, {
          actorUserId: actor.id, action: 'catalog.university.update', resourceType: 'university', resourceId: String(id),
          ...requestAuditMetadata(req), before: adminUniversitySnapshot(before), after: adminUniversitySnapshot(output), metadata: { changedFields: keys },
        });
        return output;
      });
      return res.json({ university: updated });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') error.status = 409;
      return next(error);
    }
  });

  router.delete('/universities/:id', async (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id, 'universityId');
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const archived = await withTransaction(db, async (tx) => {
        const current = await selectUniversity(tx, id, { forUpdate: true });
        if (!current) throw requestError('院校不存在', 404);
        const before = { ...publicUniversity(current.university), detail: publicDetail(current.detail) };
        if (before.catalogStatus === 'archived') throw requestError('该院校已经归档');
        await tx.execute("UPDATE universities SET catalog_status='archived' WHERE id=?", [id]);
        await synchronizeLegacyCatalogStatus(tx, id, 'archived');
        const output = await publicUniversityRecord(tx, id);
        await writeCatalogChange(tx, { actorUserId: actor.id, universityId: id, operation: 'archive', before, after: output, changedFields: ['catalogStatus'] });
        await audit(tx, {
          actorUserId: actor.id, action: 'catalog.university.archive', resourceType: 'university', resourceId: String(id),
          ...requestAuditMetadata(req), before: adminUniversitySnapshot(before), after: adminUniversitySnapshot(output), metadata: { softDelete: true },
        });
        return output;
      });
      return res.json({ archived: true, university: archived });
    } catch (error) { return next(error); }
  });

  router.get('/catalog/issues', async (req, res, next) => {
    try {
      const query = parsePagination(req.query || {});
      const status = optionalText(req.query?.status, 'status', 32);
      const severity = optionalText(req.query?.severity, 'severity', 16);
      if (status && !ISSUE_STATUSES.has(status)) throw requestError('status 不合法');
      if (severity && !ISSUE_SEVERITIES.has(severity)) throw requestError('severity 不合法');
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const clauses = [];
      const params = [];
      if (status) { clauses.push('i.status=?'); params.push(status); }
      if (severity) { clauses.push('i.severity=?'); params.push(severity); }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const total = Number((await db.one(`SELECT COUNT(*) AS total FROM catalog_data_issues i${where}`, params))?.total || 0);
      const rows = await db.all(`SELECT i.*,s.title AS source_document_title,u.username AS resolved_by_username
        FROM catalog_data_issues i
        LEFT JOIN source_documents s ON s.id=i.source_document_id
        LEFT JOIN users u ON u.id=i.resolved_by_user_id${where}
        ORDER BY i.status='open' DESC,
          FIELD(i.severity,'critical','error','warning','info'),i.created_at DESC,i.id DESC
        LIMIT ${query.pageSize} OFFSET ${query.offset}`, params);
      return res.json({ ...asPagination(query, total), data: rows.map(publicIssue) });
    } catch (error) { return next(error); }
  });

  router.patch('/catalog/issues/:id', async (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id, 'issueId');
      const body = asPlainObject(req.body || {}, '请求体');
      assertAllowedFields(body, new Set(['status']), '数据问题');
      if (!ISSUE_STATUSES.has(body.status)) throw requestError('status 必须是 open、resolved 或 ignored');
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const output = await withTransaction(db, async (tx) => {
        const current = await tx.one('SELECT * FROM catalog_data_issues WHERE id=? FOR UPDATE', [id]);
        if (!current) throw requestError('数据问题不存在', 404);
        const before = publicIssue(current);
        const resolving = body.status === 'resolved' || body.status === 'ignored';
        await tx.execute(`UPDATE catalog_data_issues
          SET status=?,resolved_by_user_id=?,resolved_at=${resolving ? 'UTC_TIMESTAMP(3)' : 'NULL'} WHERE id=?`, [
          body.status, resolving ? actor.id : null, id,
        ]);
        const updated = await tx.one(`SELECT i.*,s.title AS source_document_title,u.username AS resolved_by_username
          FROM catalog_data_issues i
          LEFT JOIN source_documents s ON s.id=i.source_document_id
          LEFT JOIN users u ON u.id=i.resolved_by_user_id WHERE i.id=?`, [id]);
        const after = publicIssue(updated);
        await audit(tx, {
          actorUserId: actor.id, action: 'catalog.issue.update', resourceType: 'catalog_issue', resourceId: String(id),
          ...requestAuditMetadata(req), before: safeAuditSnapshot(before), after: safeAuditSnapshot(after),
        });
        return after;
      });
      return res.json({ issue: output });
    } catch (error) { return next(error); }
  });

  return router;
}

export default createAdminCatalogRouter();
