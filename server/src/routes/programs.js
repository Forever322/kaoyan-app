import { Router } from 'express';
import { getDB } from '../db/index.js';

// Public catalog endpoints deliberately expose only reference data.  They do
// not authenticate a user and never mutate the catalog, so they are safe for
// the App, search crawlers and a later agent retrieval layer to share.
const MAX_PAGE = 10_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_TEXT_LENGTH = 191;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function scalarQueryValue(value, field) {
  if (Array.isArray(value)) throw requestError(`${field} 只能传一个值`);
  return value;
}

function parsePositiveInteger(value, field, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw requestError(`${field} 必须是 ${min}–${max} 的整数`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw requestError(`${field} 必须是 ${min}–${max} 的整数`);
  }
  return number;
}

function parseOptionalId(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return parsePositiveInteger(scalarQueryValue(value, field), field);
}

function parseOptionalYear(value, field = 'year') {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return parsePositiveInteger(scalarQueryValue(value, field), field, { min: MIN_YEAR, max: MAX_YEAR });
}

function parseOptionalText(value, field, maxLength = MAX_TEXT_LENGTH) {
  if (value === undefined || value === null) return null;
  const text = String(scalarQueryValue(value, field)).trim();
  if (!text) return null;
  if (text.length > maxLength) throw requestError(`${field} 不能超过 ${maxLength} 个字符`);
  return text;
}

function parsePagination(query) {
  const page = query.page === undefined || String(query.page).trim() === ''
    ? 1
    : parsePositiveInteger(scalarQueryValue(query.page, 'page'), 'page', { min: 1, max: MAX_PAGE });
  const pageSizeValue = query.pageSize ?? query.limit;
  const pageSize = pageSizeValue === undefined || String(pageSizeValue).trim() === ''
    ? DEFAULT_PAGE_SIZE
    : parsePositiveInteger(scalarQueryValue(pageSizeValue, 'pageSize'), 'pageSize', { min: 1, max: MAX_PAGE_SIZE });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * Validates the public GET /api/programs query DTO.  Values are intentionally
 * kept as text except numeric identifiers and year: degree/category/status
 * are reference-data labels and must not be hard-coded into the API.
 */
export function parseProgramListQuery(query = {}) {
  const pagination = parsePagination(query);
  return {
    ...pagination,
    universityId: parseOptionalId(query.universityId, 'universityId'),
    academicUnitId: parseOptionalId(query.academicUnitId, 'academicUnitId'),
    year: parseOptionalYear(query.year),
    degree: parseOptionalText(query.degree, 'degree', 32),
    category: parseOptionalText(query.category, 'category', 128),
    disciplineCode: parseOptionalText(query.disciplineCode, 'disciplineCode', 64),
    studyMode: parseOptionalText(query.studyMode, 'studyMode', 32),
    programType: parseOptionalText(query.programType, 'programType', 32),
    status: parseOptionalText(query.status, 'status', 32),
    offeringStatus: parseOptionalText(query.offeringStatus, 'offeringStatus', 32),
    verificationStatus: parseOptionalText(query.verificationStatus, 'verificationStatus', 32),
    sourceDocumentId: parseOptionalId(query.sourceDocumentId, 'sourceDocumentId'),
    offeringSourceDocumentId: parseOptionalId(query.offeringSourceDocumentId, 'offeringSourceDocumentId'),
    code: parseOptionalText(query.code, 'code', 64),
    keyword: parseOptionalText(query.keyword, 'keyword', 100),
    province: parseOptionalText(query.province, 'province', 64),
    zone: parseOptionalText(query.zone, 'zone', 8),
  };
}

export function parseOfferingListQuery(query = {}) {
  const pagination = parsePagination(query);
  return {
    ...pagination,
    year: parseOptionalYear(query.year),
    status: parseOptionalText(query.status, 'status', 32),
    verificationStatus: parseOptionalText(query.verificationStatus, 'verificationStatus', 32),
    sourceDocumentId: parseOptionalId(query.sourceDocumentId, 'sourceDocumentId'),
  };
}

function parsePathId(value, field = 'id') {
  return parsePositiveInteger(value, field);
}

function normalizeScalar(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value;
  }
  return value;
}

function parseJsonValue(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function normalizeRecord(row) {
  const result = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (key === 'id' || key.endsWith('_id') || key === 'year') result[key] = normalizeScalar(value);
    else if (key.endsWith('_json')) result[key] = parseJsonValue(value);
    else result[key] = value;
  }
  return result;
}

function withoutUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function toProgram(row) {
  if (!row) return null;
  const {
    university_name: universityName,
    university_province: universityProvince,
    university_city: universityCity,
    university_zone: universityZone,
    university_level: universityLevel,
    university_type: universityType,
    academic_unit_catalog_id: academicUnitCatalogId,
    academic_unit_name: academicUnitName,
    academic_unit_code: academicUnitCode,
    academic_unit_type: academicUnitType,
    academic_unit_parent_id: academicUnitParentId,
    ...program
  } = normalizeRecord(row);
  return withoutUndefined({
    id: program.id,
    universityId: program.university_id,
    academicUnitId: program.academic_unit_id ?? null,
    code: program.code,
    name: program.name,
    degree: program.degree,
    category: program.category,
    direction: program.direction,
    disciplineCode: program.discipline_code,
    disciplineName: program.discipline_name,
    studyMode: program.study_mode,
    programType: program.program_type,
    status: program.status,
    sourceDocumentId: program.source_document_id ?? null,
    createdAt: program.created_at,
    updatedAt: program.updated_at,
    university: {
      id: program.university_id,
      name: universityName,
      province: universityProvince,
      city: universityCity,
      zone: universityZone,
      level: universityLevel,
      type: universityType,
    },
    academicUnit: program.academic_unit_id === null || program.academic_unit_id === undefined
      ? null
      : withoutUndefined({
        id: academicUnitCatalogId ?? program.academic_unit_id,
        name: academicUnitName,
        code: academicUnitCode,
        type: academicUnitType,
        parentId: academicUnitParentId ?? null,
      }),
  });
}

function toOffering(row) {
  if (!row) return null;
  const offering = normalizeRecord(row);
  return withoutUndefined({
    id: offering.id,
    programId: offering.program_id,
    year: offering.year,
    academicUnitId: offering.academic_unit_id ?? null,
    campusId: offering.campus_id ?? null,
    admissionType: offering.admission_type,
    studyMode: offering.study_mode,
    enrollmentPlan: offering.enrollment_plan,
    recommendedExemptPlan: offering.recommended_exempt_plan,
    targetPopulation: offering.target_population,
    durationYears: offering.duration_years,
    tuitionFee: offering.tuition_fee,
    examMode: offering.exam_mode,
    applicationNotes: offering.application_notes,
    sourceDocumentId: offering.source_document_id ?? null,
    verificationStatus: offering.verification_status,
    status: offering.status,
    createdAt: offering.created_at,
    updatedAt: offering.updated_at,
  });
}

function buildProgramWhere(filters) {
  // Public program data follows the university archive state as well. Admin
  // catalog routes remain the only place that can inspect archived records.
  const clauses = ["COALESCE(u.catalog_status,'active')='active'"];
  const params = [];
  if (filters.universityId !== null) { clauses.push('p.university_id=?'); params.push(filters.universityId); }
  if (filters.academicUnitId !== null) { clauses.push('p.academic_unit_id=?'); params.push(filters.academicUnitId); }
  if (filters.degree) { clauses.push('p.degree=?'); params.push(filters.degree); }
  if (filters.category) { clauses.push('p.category=?'); params.push(filters.category); }
  if (filters.disciplineCode) { clauses.push('p.discipline_code=?'); params.push(filters.disciplineCode); }
  if (filters.studyMode) { clauses.push('p.study_mode=?'); params.push(filters.studyMode); }
  if (filters.programType) { clauses.push('p.program_type=?'); params.push(filters.programType); }
  if (filters.status) { clauses.push('p.status=?'); params.push(filters.status); }
  if (filters.sourceDocumentId !== null) { clauses.push('p.source_document_id=?'); params.push(filters.sourceDocumentId); }
  if (filters.code) { clauses.push('p.code=?'); params.push(filters.code); }
  if (filters.keyword) {
    clauses.push('(p.code LIKE ? OR p.name LIKE ? OR p.direction LIKE ?)');
    const like = `%${filters.keyword}%`;
    params.push(like, like, like);
  }
  if (filters.province) { clauses.push('u.province=?'); params.push(filters.province); }
  if (filters.zone) { clauses.push('u.zone=?'); params.push(filters.zone); }

  // Offering filters use EXISTS so that a program still appears only once
  // even if it has multiple directions or annual offerings.
  if (filters.year !== null) {
    clauses.push('EXISTS (SELECT 1 FROM program_offerings po_filter WHERE po_filter.program_id=p.id AND po_filter.year=?)');
    params.push(filters.year);
  }
  if (filters.offeringStatus) {
    clauses.push('EXISTS (SELECT 1 FROM program_offerings po_filter WHERE po_filter.program_id=p.id AND po_filter.status=?)');
    params.push(filters.offeringStatus);
  }
  if (filters.verificationStatus) {
    clauses.push('EXISTS (SELECT 1 FROM program_offerings po_filter WHERE po_filter.program_id=p.id AND po_filter.verification_status=?)');
    params.push(filters.verificationStatus);
  }
  if (filters.offeringSourceDocumentId !== null) {
    clauses.push('EXISTS (SELECT 1 FROM program_offerings po_filter WHERE po_filter.program_id=p.id AND po_filter.source_document_id=?)');
    params.push(filters.offeringSourceDocumentId);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

const PROGRAM_SELECT = `SELECT p.*,
  u.name AS university_name,
  u.province AS university_province,
  u.city AS university_city,
  u.zone AS university_zone,
  u.level AS university_level,
  u.type AS university_type,
  au.id AS academic_unit_catalog_id,
  au.name AS academic_unit_name,
  au.code AS academic_unit_code,
  au.unit_type AS academic_unit_type,
  au.parent_id AS academic_unit_parent_id
FROM programs p
INNER JOIN universities u ON u.id=p.university_id
LEFT JOIN academic_units au ON au.id=p.academic_unit_id`;

async function getProgram(db, id) {
  const row = await db.one(`${PROGRAM_SELECT} WHERE p.id=? AND COALESCE(u.catalog_status,'active')='active'`, [id]);
  return toProgram(row);
}

function paginationPayload({ page, pageSize, total }) {
  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

/**
 * Factory export keeps the catalog route independently testable without a
 * live MySQL instance. Production uses the shared MySQL adapter by default.
 */
export function createProgramsRouter({ database = getDB } = {}) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const filters = parseProgramListQuery(req.query || {});
      const db = await database();
      const where = buildProgramWhere(filters);
      const totalRow = await db.one(
        `SELECT COUNT(*) AS total FROM programs p INNER JOIN universities u ON u.id=p.university_id${where.sql}`,
        where.params,
      );
      const total = Number(totalRow?.total || 0);
      // mysql2 binds JS numbers as a type MySQL refuses in prepared LIMIT /
      // OFFSET markers on this deployment. These values were parsed as bounded
      // integers above, so interpolating them is safe and keeps all user text
      // filters parameterized.
      const rows = await db.all(
        `${PROGRAM_SELECT}${where.sql} ORDER BY p.name ASC, p.id ASC LIMIT ${filters.pageSize} OFFSET ${filters.offset}`,
        where.params,
      );
      return res.json({
        ...paginationPayload({ ...filters, total }),
        data: rows.map(toProgram),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/offerings', async (req, res, next) => {
    try {
      const id = parsePathId(req.params.id, 'programId');
      const filters = parseOfferingListQuery(req.query || {});
      const db = await database();
      const program = await getProgram(db, id);
      if (!program) return res.status(404).json({ error: '专业不存在或已下架' });

      const clauses = ['program_id=?'];
      const params = [id];
      if (filters.year !== null) { clauses.push('year=?'); params.push(filters.year); }
      if (filters.status) { clauses.push('status=?'); params.push(filters.status); }
      if (filters.verificationStatus) { clauses.push('verification_status=?'); params.push(filters.verificationStatus); }
      if (filters.sourceDocumentId !== null) { clauses.push('source_document_id=?'); params.push(filters.sourceDocumentId); }
      const where = ` WHERE ${clauses.join(' AND ')}`;
      const totalRow = await db.one(`SELECT COUNT(*) AS total FROM program_offerings${where}`, params);
      const total = Number(totalRow?.total || 0);
      const rows = await db.all(
        `SELECT * FROM program_offerings${where} ORDER BY year DESC, id DESC LIMIT ${filters.pageSize} OFFSET ${filters.offset}`,
        params,
      );
      return res.json({
        program,
        ...paginationPayload({ ...filters, total }),
        data: rows.map(toOffering),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const id = parsePathId(req.params.id, 'programId');
      const db = await database();
      const program = await getProgram(db, id);
      if (!program) return res.status(404).json({ error: '专业不存在或已下架' });
      const latestOffering = await db.one(
        'SELECT * FROM program_offerings WHERE program_id=? ORDER BY year DESC, id DESC LIMIT 1',
        [id],
      );
      return res.json({ ...program, latestOffering: toOffering(latestOffering) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export default createProgramsRouter();
