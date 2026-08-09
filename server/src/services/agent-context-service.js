import { getLegacyCurrentPlans } from './plan-service.js';

const MAX_CONTEXT_FAVORITES = 12;
const MAX_CONTEXT_PROGRAMS = 4;
const MAX_CONTEXT_OFFERINGS = 6;
const MAX_CONTEXT_EXAM_SUBJECTS = 24;
const MAX_CONTEXT_SCORE_LINES = 8;
const MAX_CONTEXT_ADMISSION_STATS = 6;
const MAX_CONTEXT_RETEST_RULES = 4;

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

export async function getCurrentPlans(db, userId) {
  return getLegacyCurrentPlans(db, userId);
}

function limitedText(value, maxLength = 191) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, maxLength);
}

function firstPlanText(plan, keys, maxLength = 191) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return '';
  for (const key of keys) {
    const text = limitedText(plan[key], maxLength);
    if (text) return text;
  }
  return '';
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function catalogSource(row, prefix = 'source_') {
  const sourceDocumentId = normalizeNumber(row[`${prefix}document_id`]);
  if (!sourceDocumentId) return null;
  return {
    id: sourceDocumentId,
    title: row[`${prefix}title`] || '',
    url: row[`${prefix}url`] || '',
    effectiveYear: normalizeNumber(row[`${prefix}effective_year`]),
    publishedAt: row[`${prefix}published_at`] || null,
    retrievedAt: row[`${prefix}retrieved_at`] || null,
    verificationStatus: row[`${prefix}verification_status`] || 'pending',
  };
}

function programQueryTarget(admissionPlan) {
  return {
    universityName: firstPlanText(admissionPlan, [
      'university', 'school', 'targetUniversity', 'targetSchool', 'universityName', '院校', '学校', '目标院校',
    ]),
    programName: firstPlanText(admissionPlan, [
      'major', 'targetMajor', 'majorName', 'program', 'programName', '专业', '目标专业',
    ]),
    programCode: firstPlanText(admissionPlan, [
      'majorCode', 'programCode', '专业代码', '目标专业代码',
    ], 64),
  };
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

/**
 * Builds a bounded, source-aware reference package for the model. The model
 * never receives a DB connection or query ability: all identifiers are from
 * database rows and all user-originating values are bound SQL parameters.
 */
export async function getAdmissionCatalogReference(db, admissionPlan) {
  const requested = programQueryTarget(admissionPlan);
  if (!requested.universityName) return null;

  const university = await db.one(`SELECT
    u.id, u.name, u.official_name, u.province, u.city, u.zone, u.level, u.type,
    u.institution_code, u.verification_status, u.catalog_status, u.source_document_id,
    ua.alias_name AS matched_alias, ua.alias_type AS matched_alias_type, ua.verification_status AS alias_verification_status,
    sd.id AS source_document_id, sd.title AS source_title, sd.source_url AS source_url,
    sd.effective_year AS source_effective_year, sd.published_at AS source_published_at,
    sd.retrieved_at AS source_retrieved_at, sd.verification_status AS source_verification_status
    FROM universities u
    LEFT JOIN university_aliases ua ON ua.university_id=u.id AND ua.alias_name=?
    LEFT JOIN source_documents sd ON sd.id=u.source_document_id
    WHERE (u.name=? OR ua.alias_name=?) AND u.catalog_status <> 'archived'
    ORDER BY CASE WHEN u.name=? THEN 0 ELSE 1 END,
      CASE WHEN ua.verification_status='verified' THEN 0 ELSE 1 END, u.id ASC
    LIMIT 1`, [requested.universityName, requested.universityName, requested.universityName, requested.universityName]);

  if (!university) {
    return { requested, matchedUniversity: null, programs: [], scoreLines: [], note: '未在院校主表匹配到目标院校' };
  }

  const matchedUniversity = {
    id: Number(university.id),
    name: university.name,
    officialName: university.official_name || university.name,
    province: university.province || '',
    city: university.city || '',
    zone: university.zone || '',
    level: university.level || '',
    type: university.type || '',
    institutionCode: university.institution_code || '',
    verificationStatus: university.verification_status || 'pending',
    catalogStatus: university.catalog_status || 'active',
    matchedBy: university.matched_alias ? {
      alias: university.matched_alias,
      aliasType: university.matched_alias_type || '',
      verificationStatus: university.alias_verification_status || 'pending',
    } : 'canonical_name',
    source: catalogSource(university),
  };

  // Without an intended program, the coach still benefits from knowing that
  // the school matched, but we deliberately do not dump unrelated programs.
  if (!requested.programName && !requested.programCode) {
    return { requested, matchedUniversity, programs: [], scoreLines: [], note: '尚未提供目标专业或专业代码' };
  }

  const programClauses = ['p.university_id=?', "p.status <> 'archived'"];
  const programParams = [matchedUniversity.id];
  if (requested.programCode) {
    programClauses.push('p.code=?');
    programParams.push(requested.programCode);
  }
  if (requested.programName) {
    programClauses.push('p.name LIKE ?');
    programParams.push(`%${requested.programName}%`);
  }
  const programRows = await db.all(`SELECT
    p.id, p.code, p.name, p.degree, p.category, p.direction, p.discipline_code, p.discipline_name,
    p.study_mode, p.program_type, p.status, p.source_document_id,
    au.id AS academic_unit_id, au.name AS academic_unit_name, au.unit_type AS academic_unit_type,
    sd.id AS source_document_id, sd.title AS source_title, sd.source_url AS source_url,
    sd.effective_year AS source_effective_year, sd.published_at AS source_published_at,
    sd.retrieved_at AS source_retrieved_at, sd.verification_status AS source_verification_status
    FROM programs p
    LEFT JOIN academic_units au ON au.id=p.academic_unit_id
    LEFT JOIN source_documents sd ON sd.id=p.source_document_id
    WHERE ${programClauses.join(' AND ')}
    ORDER BY p.name ASC, p.id ASC LIMIT ${MAX_CONTEXT_PROGRAMS}`, programParams);

  const programIds = programRows.map((row) => Number(row.id)).filter(Number.isSafeInteger);
  const programs = programRows.map((row) => ({
    id: Number(row.id),
    code: row.code || '',
    name: row.name || '',
    degree: row.degree || '',
    category: row.category || '',
    direction: row.direction || '',
    disciplineCode: row.discipline_code || '',
    disciplineName: row.discipline_name || '',
    studyMode: row.study_mode || '',
    programType: row.program_type || '',
    status: row.status || 'active',
    academicUnit: row.academic_unit_id ? {
      id: Number(row.academic_unit_id), name: row.academic_unit_name || '', type: row.academic_unit_type || '',
    } : null,
    source: catalogSource(row),
  }));

  if (!programIds.length) {
    return { requested, matchedUniversity, programs, scoreLines: [], note: '未找到与目标专业匹配的已入库资料' };
  }

  const programIdPlaceholders = placeholders(programIds);
  const offeringRows = await db.all(`SELECT
    po.*, sd.id AS source_document_id, sd.title AS source_title, sd.source_url AS source_url,
    sd.effective_year AS source_effective_year, sd.published_at AS source_published_at,
    sd.retrieved_at AS source_retrieved_at, sd.verification_status AS source_verification_status
    FROM program_offerings po
    LEFT JOIN source_documents sd ON sd.id=po.source_document_id
    WHERE po.program_id IN (${programIdPlaceholders}) AND po.status <> 'archived'
    ORDER BY po.year DESC, po.id DESC LIMIT ${MAX_CONTEXT_OFFERINGS}`, programIds);
  const offeringIds = offeringRows.map((row) => Number(row.id)).filter(Number.isSafeInteger);
  const offerings = offeringRows.map((row) => ({
    id: Number(row.id),
    programId: Number(row.program_id),
    year: Number(row.year),
    admissionType: row.admission_type || '',
    studyMode: row.study_mode || '',
    enrollmentPlan: normalizeNumber(row.enrollment_plan),
    recommendedExemptPlan: normalizeNumber(row.recommended_exempt_plan),
    durationYears: normalizeNumber(row.duration_years),
    tuitionFee: normalizeNumber(row.tuition_fee),
    examMode: row.exam_mode || '',
    verificationStatus: row.verification_status || 'pending',
    status: row.status || 'active',
    source: catalogSource(row),
  }));

  const [examRows, scoreRows, statisticRows, retestRows] = await Promise.all([
    offeringIds.length
      ? db.all(`SELECT es.*, sd.id AS source_document_id, sd.title AS source_title, sd.source_url AS source_url,
          sd.effective_year AS source_effective_year, sd.published_at AS source_published_at,
          sd.retrieved_at AS source_retrieved_at, sd.verification_status AS source_verification_status
        FROM exam_subjects es LEFT JOIN source_documents sd ON sd.id=es.source_document_id
        WHERE es.program_offering_id IN (${placeholders(offeringIds)})
        ORDER BY es.program_offering_id ASC, es.sequence_no ASC LIMIT ${MAX_CONTEXT_EXAM_SUBJECTS}`, offeringIds)
      : [],
    db.all(`SELECT sl.*, sd.id AS source_document_id, sd.title AS source_title, sd.source_url AS source_url,
        sd.effective_year AS source_effective_year, sd.published_at AS source_published_at,
        sd.retrieved_at AS source_retrieved_at, sd.verification_status AS source_verification_status
      FROM score_lines sl LEFT JOIN source_documents sd ON sd.id=sl.source_document_id
      WHERE sl.status <> 'archived' AND (sl.university_id=? OR sl.program_id IN (${programIdPlaceholders}))
      ORDER BY sl.year DESC, sl.id DESC LIMIT ${MAX_CONTEXT_SCORE_LINES}`, [matchedUniversity.id, ...programIds]),
    offeringIds.length
      ? db.all(`SELECT ast.*, sd.id AS source_document_id, sd.title AS source_title, sd.source_url AS source_url,
          sd.effective_year AS source_effective_year, sd.published_at AS source_published_at,
          sd.retrieved_at AS source_retrieved_at, sd.verification_status AS source_verification_status
        FROM admission_statistics ast LEFT JOIN source_documents sd ON sd.id=ast.source_document_id
        WHERE ast.program_offering_id IN (${placeholders(offeringIds)}) AND ast.status <> 'archived'
        ORDER BY ast.year DESC, ast.id DESC LIMIT ${MAX_CONTEXT_ADMISSION_STATS}`, offeringIds)
      : [],
    offeringIds.length
      ? db.all(`SELECT rr.*, sd.id AS source_document_id, sd.title AS source_title, sd.source_url AS source_url,
          sd.effective_year AS source_effective_year, sd.published_at AS source_published_at,
          sd.retrieved_at AS source_retrieved_at, sd.verification_status AS source_verification_status
        FROM retest_rules rr LEFT JOIN source_documents sd ON sd.id=rr.source_document_id
        WHERE rr.program_offering_id IN (${placeholders(offeringIds)}) AND rr.status <> 'archived'
        ORDER BY rr.year DESC, rr.id DESC LIMIT ${MAX_CONTEXT_RETEST_RULES}`, offeringIds)
      : [],
  ]);

  return {
    requested,
    matchedUniversity,
    programs,
    offerings,
    examSubjects: examRows.map((row) => ({
      offeringId: Number(row.program_offering_id), sequence: Number(row.sequence_no), code: row.subject_code || '',
      name: row.subject_name || '', type: row.subject_type || '', selfProposed: Boolean(row.is_self_proposed),
      fullScore: normalizeNumber(row.full_score), referenceBooks: parseJson(row.reference_books_json, []),
      source: catalogSource(row),
    })),
    scoreLines: scoreRows.map((row) => ({
      scope: row.scope || '', year: Number(row.year), universityId: normalizeNumber(row.university_id),
      programId: normalizeNumber(row.program_id), degree: row.degree || '', category: row.category || '',
      candidateType: row.candidate_type || '', totalScore: normalizeNumber(row.total_score),
      politicsLine: normalizeNumber(row.politics_line), foreignLanguageLine: normalizeNumber(row.foreign_language_line),
      business1Line: normalizeNumber(row.business_1_line), business2Line: normalizeNumber(row.business_2_line),
      verificationStatus: row.verification_status || 'pending', source: catalogSource(row),
    })),
    admissionStatistics: statisticRows.map((row) => ({
      offeringId: Number(row.program_offering_id), year: Number(row.year), scope: row.statistic_scope || '',
      applicantCount: normalizeNumber(row.applicant_count), admittedCount: normalizeNumber(row.admitted_count),
      recommendedExemptCount: normalizeNumber(row.recommended_exempt_count), enrolledCount: normalizeNumber(row.enrolled_count),
      admissionRatio: normalizeNumber(row.admission_ratio), lowestScore: normalizeNumber(row.lowest_score),
      averageScore: normalizeNumber(row.average_score), highestScore: normalizeNumber(row.highest_score),
      verificationStatus: row.verification_status || 'pending', source: catalogSource(row),
    })),
    retestRules: retestRows.map((row) => ({
      offeringId: Number(row.program_offering_id), year: Number(row.year), mode: row.retest_mode || '',
      initialExamWeight: normalizeNumber(row.initial_exam_weight), retestWeight: normalizeNumber(row.retest_weight),
      writtenTestWeight: normalizeNumber(row.written_test_weight), interviewWeight: normalizeNumber(row.interview_weight),
      computerTestWeight: normalizeNumber(row.computer_test_weight),
      foreignLanguageTestRequired: Boolean(row.foreign_language_test_required), crossMajorAllowed: row.cross_major_allowed === null ? null : Boolean(row.cross_major_allowed),
      verificationStatus: row.verification_status || 'pending', source: catalogSource(row),
    })),
  };
}

export async function buildAgentContext(db, userId) {
  const [user, subjectStats, totals, memoryRows, favoriteRows] = await Promise.all([
    db.one('SELECT id,username,email FROM users WHERE id=?', [userId]),
    db.all(`SELECT subject, SUM(duration_s) AS duration_s, COUNT(*) AS session_count
      FROM study_sessions
      WHERE user_id=? AND started_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
      GROUP BY subject ORDER BY duration_s DESC LIMIT 8`, [userId]),
    db.one(`SELECT COALESCE(SUM(duration_s),0) AS duration_s, COUNT(*) AS session_count
      FROM study_sessions WHERE user_id=? AND started_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)`, [userId]),
    db.all(`SELECT memory_type,content,metadata_json,updated_at FROM agent_memories
      WHERE user_id=? AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
      ORDER BY updated_at DESC LIMIT 12`, [userId]),
    // The model only receives this small, server-built summary. It never gets
    // database credentials or the ability to construct/run SQL itself.
    db.all(`SELECT
        f.university_id,
        f.created_at AS favorited_at,
        u.name,
        u.province,
        u.city,
        u.zone,
        u.level,
        u.type
      FROM user_favorites f
      INNER JOIN universities u ON u.id=f.university_id
        AND COALESCE(u.catalog_status,'active')='active'
      WHERE f.user_id=?
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ${MAX_CONTEXT_FAVORITES}`, [userId]),
  ]);

  const plans = await getCurrentPlans(db, userId);
  const catalogReference = await getAdmissionCatalogReference(db, plans.admissionPlan);

  return {
    user: user ? { id: Number(user.id), username: user.username } : null,
    plans,
    study30d: {
      duration_s: Number(totals?.duration_s || 0),
      session_count: Number(totals?.session_count || 0),
      bySubject: subjectStats.map((row) => ({
        ...row,
        duration_s: Number(row.duration_s || 0),
        session_count: Number(row.session_count || 0),
      })),
    },
    memories: memoryRows.map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) })),
    favoriteUniversities: favoriteRows.map((row) => ({
      universityId: Number(row.university_id),
      name: row.name || '',
      province: row.province || '',
      city: row.city || '',
      zone: row.zone || '',
      level: row.level || '',
      type: row.type || '',
      favoritedAt: row.favorited_at || null,
    })),
    // `catalogReference` is server-built and bounded. It is intentionally
    // absent until the user has supplied a target school; this avoids sending
    // the entire public catalog (or another user's preferences) to the model.
    catalogReference,
  };
}

export function publicProposal(row) {
  return {
    id: Number(row.id),
    proposalType: row.proposal_type,
    status: row.status,
    summary: row.summary,
    rationale: row.rationale,
    changes: parseJson(row.changes_json, []),
    baseRevision: Number(row.base_revision || 0),
    expiresAt: row.expires_at || null,
    appliedAt: row.applied_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
