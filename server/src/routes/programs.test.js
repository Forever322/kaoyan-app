import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createProgramsRouter, parseProgramListQuery } from './programs.js';

const programRow = {
  id: '101',
  university_id: '7',
  academic_unit_id: '11',
  code: '083500',
  name: '软件工程',
  degree: '学硕',
  category: '工学',
  direction: '软件工程',
  university_name: '北京邮电大学',
  university_province: '北京',
  university_city: '北京',
  university_zone: 'A',
  university_level: '211',
  university_type: '理工',
};

const offeringRow = {
  id: '501',
  program_id: '101',
  year: '2027',
  status: 'published',
  source_document_id: '99',
  verification_status: 'verified',
  enrollment_plan: 42,
  application_notes: '以招生专业目录为准',
};

async function withRouter(router, run) {
  const app = express();
  app.use('/api/programs', router);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}/api/programs`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('专业列表会绑定筛选参数并返回稳定分页 DTO', async () => {
  const calls = [];
  const router = createProgramsRouter({
    database: async () => ({
      one: async (sql, params) => {
        calls.push({ type: 'one', sql, params });
        assert.match(sql, /SELECT COUNT\(\*\) AS total FROM programs p/);
        return { total: '1' };
      },
      all: async (sql, params) => {
        calls.push({ type: 'all', sql, params });
        assert.match(sql, /FROM programs p/);
        assert.match(sql, /EXISTS \(SELECT 1 FROM program_offerings po_filter/);
        return [programRow];
      },
    }),
  });

  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}?universityId=7&year=2027&keyword=%E8%BD%AF%E4%BB%B6&page=2&pageSize=5`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      page: 2,
      pageSize: 5,
      total: 1,
      totalPages: 1,
      data: [{
        id: 101,
        universityId: 7,
        academicUnitId: 11,
        code: '083500',
        name: '软件工程',
        degree: '学硕',
        category: '工学',
        direction: '软件工程',
        sourceDocumentId: null,
        academicUnit: { id: 11, parentId: null },
        university: {
          id: 7,
          name: '北京邮电大学',
          province: '北京',
          city: '北京',
          zone: 'A',
          level: '211',
          type: '理工',
        },
      }],
    });
  });

  assert.deepEqual(calls[0].params, [7, '%软件%', '%软件%', '%软件%', 2027]);
  assert.deepEqual(calls[1].params, [7, '%软件%', '%软件%', '%软件%', 2027]);
  assert.match(calls[1].sql, /LIMIT 5 OFFSET 5$/);
});

test('专业详情返回最新年度招生信息，且 JSON 与标识符会规范化', async () => {
  const router = createProgramsRouter({
    database: async () => ({
      one: async (sql, params) => {
        if (sql.includes('FROM programs p')) {
          assert.deepEqual(params, [101]);
          return programRow;
        }
        assert.equal(sql, 'SELECT * FROM program_offerings WHERE program_id=? ORDER BY year DESC, id DESC LIMIT 1');
        assert.deepEqual(params, [101]);
        return offeringRow;
      },
    }),
  });

  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/101`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.id, 101);
    assert.equal(body.university.id, 7);
    assert.deepEqual(body.latestOffering, {
      id: 501,
      programId: 101,
      year: 2027,
      academicUnitId: null,
      campusId: null,
      status: 'published',
      sourceDocumentId: 99,
      verificationStatus: 'verified',
      enrollmentPlan: 42,
      applicationNotes: '以招生专业目录为准',
    });
  });
});

test('年度招生列表验证路径和分页查询，并且不将无效参数交给 SQL', async () => {
  const router = createProgramsRouter({
    database: async () => ({
      one: async (sql, params) => {
        if (sql.includes('FROM programs p')) return programRow;
        assert.equal(sql, 'SELECT COUNT(*) AS total FROM program_offerings WHERE program_id=? AND year=? AND status=?');
        assert.deepEqual(params, [101, 2027, 'published']);
        return { total: 1 };
      },
      all: async (sql, params) => {
        assert.equal(sql, 'SELECT * FROM program_offerings WHERE program_id=? AND year=? AND status=? ORDER BY year DESC, id DESC LIMIT 10 OFFSET 0');
        assert.deepEqual(params, [101, 2027, 'published']);
        return [offeringRow];
      },
    }),
  });

  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/101/offerings?year=2027&status=published&pageSize=10`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.program.id, 101);
    assert.equal(body.total, 1);
    assert.equal(body.data[0].id, 501);

    const invalid = await fetch(`${baseUrl}/0/offerings?pageSize=1000`);
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /programId/);
  });
});

test('专业查询 DTO 拒绝超范围和多值参数', () => {
  assert.throws(() => parseProgramListQuery({ page: '0' }), /page/);
  assert.throws(() => parseProgramListQuery({ pageSize: '101' }), /pageSize/);
  assert.throws(() => parseProgramListQuery({ year: '1999' }), /year/);
  assert.throws(() => parseProgramListQuery({ universityId: ['1', '2'] }), /universityId/);

  const filters = parseProgramListQuery({
    status: 'active',
    offeringStatus: 'published',
    verificationStatus: 'verified',
    sourceDocumentId: '12',
    offeringSourceDocumentId: '13',
    studyMode: '全日制',
  });
  assert.equal(filters.status, 'active');
  assert.equal(filters.offeringStatus, 'published');
  assert.equal(filters.verificationStatus, 'verified');
  assert.equal(filters.sourceDocumentId, 12);
  assert.equal(filters.offeringSourceDocumentId, 13);
  assert.equal(filters.studyMode, '全日制');
});
