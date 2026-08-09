import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createFavoritesRouter } from './favorites.js';

const university = {
  id: 1,
  name: '清华大学',
  province: '北京',
  city: '北京',
  zone: 'A',
  level: '985',
  type: '综合',
};

const favorite = {
  favorite_id: 9,
  university_id: 1,
  university_name: '清华大学',
  province: '北京',
  city: '北京',
  zone: 'A',
  level: '985',
  type: '综合',
  created_at: '2026-08-09 09:00:00.000',
};

async function withRouter(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/favorites', router);
  app.use((error, _req, res, _next) =>
    res.status(error.status || 500).json({ error: error.message }),
  );
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}/api/favorites`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('收藏列表只按当前登录用户读取，并返回院校摘要', async () => {
  let listParams;
  let listSql;
  const router = createFavoritesRouter({
    database: async () => ({
      all: async (sql, params) => {
        listSql = sql;
        listParams = params;
        return [favorite];
      },
    }),
    authenticate: async () => ({ id: 42 }),
  });

  await withRouter(router, async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      total: 1,
      favorites: [
        {
          favoriteId: 9,
          universityId: 1,
          universityName: '清华大学',
          province: '北京',
          city: '北京',
          zone: 'A',
          level: '985',
          type: '综合',
          createdAt: '2026-08-09 09:00:00.000',
        },
      ],
    });
  });
  assert.deepEqual(listParams, [42]);
  assert.match(listSql, /COALESCE\(u\.catalog_status,'active'\)='active'/);
});

test('按院校名称创建收藏，名称会在服务端解析为唯一院校', async () => {
  let saved = false;
  let insertParams;
  const router = createFavoritesRouter({
    database: async () => ({
      one: async (sql, params) => {
        if (sql.startsWith('SELECT id,name,province')) {
          assert.deepEqual(params, ['清华大学']);
          assert.match(sql, /COALESCE\(catalog_status,'active'\)='active'/);
          return university;
        }
        if (sql.includes('FROM user_favorites')) return saved ? favorite : null;
        throw new Error(`unexpected query: ${sql}`);
      },
      execute: async (sql, params) => {
        assert.equal(sql, 'INSERT INTO user_favorites(user_id,university_id) VALUES(?,?)');
        insertParams = params;
        saved = true;
        return { affectedRows: 1 };
      },
    }),
    authenticate: async () => ({ id: 7 }),
  });

  await withRouter(router, async (baseUrl) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ universityName: '清华大学' }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.created, true);
    assert.equal(body.favorite.universityId, 1);
    assert.equal(body.favorite.universityName, '清华大学');
  });
  assert.deepEqual(insertParams, [7, 1]);
});

test('删除收藏始终携带当前用户条件，不能影响其他用户', async () => {
  let deleteParams;
  const router = createFavoritesRouter({
    database: async () => ({
      one: async (sql, params) => {
        assert.equal(
          sql,
          'SELECT id,name,province,city,zone,level,type FROM universities WHERE id=?',
        );
        assert.deepEqual(params, [1]);
        return university;
      },
      execute: async (sql, params) => {
        assert.equal(sql, 'DELETE FROM user_favorites WHERE user_id=? AND university_id=?');
        deleteParams = params;
        return { affectedRows: 1 };
      },
    }),
    authenticate: async () => ({ id: 8 }),
  });

  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/1`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      deleted: true,
      favorite: { universityId: 1, universityName: '清华大学' },
    });
  });
  assert.deepEqual(deleteParams, [8, 1]);
});
