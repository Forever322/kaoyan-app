import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createMatchRouter } from './match.js';

test('匹配接口不会返回已归档院校或其归档分数记录', async () => {
  const queries = [];
  const app = express();
  app.use('/api/match', createMatchRouter({
    database: async () => ({
      all: async (sql, params) => {
        queries.push({ sql, params });
        return [];
      },
    }),
  }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/match?score=350&degree=%E5%AD%A6%E7%A1%95&category=%E5%B7%A5%E5%AD%A6&zone=A`);
    assert.equal(response.status, 200);
    assert.equal(queries.length, 2);
    const universityQuery = queries.find((query) => query.sql.includes('FROM universities u'));
    assert.match(universityQuery.sql, /COALESCE\(u\.catalog_status,'active'\)='active'/);
    assert.match(universityQuery.sql, /COALESCE\(a\.catalog_status,'active'\)='active'/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
