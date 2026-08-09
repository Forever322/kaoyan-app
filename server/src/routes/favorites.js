import { Router } from 'express';
import { getDB } from '../db/index.js';
import { requireAuthenticatedUser } from '../services/auth-service.js';

const MAX_UNIVERSITY_NAME_LENGTH = 191;
const FAVORITE_SELECT = `SELECT
  f.id AS favorite_id,
  f.user_id,
  f.university_id,
  f.created_at,
  u.name AS university_name,
  u.province,
  u.city,
  u.zone,
  u.level,
  u.type
FROM user_favorites f
INNER JOIN universities u ON u.id = f.university_id`;

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function parseUniversityId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw requestError('universityId 必须是正整数');
  const universityId = Number(text);
  if (!Number.isSafeInteger(universityId) || universityId <= 0) {
    throw requestError('universityId 必须是正整数');
  }
  return universityId;
}

function parseUniversityName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw requestError('universityName 不能为空');
  if (name.length > MAX_UNIVERSITY_NAME_LENGTH) {
    throw requestError(`universityName 不能超过 ${MAX_UNIVERSITY_NAME_LENGTH} 个字符`);
  }
  return name;
}

/**
 * A client may use the stable database id or the legacy static-data name.
 * When both are supplied, resolving and comparing them prevents a stale UI
 * from saving/deleting the wrong university.
 */
function normalizeUniversityTarget({ universityId, universityName } = {}) {
  const hasId = hasValue(universityId);
  const hasName = hasValue(universityName);
  if (!hasId && !hasName) throw requestError('请提供 universityId 或 universityName');
  return {
    universityId: hasId ? parseUniversityId(universityId) : null,
    universityName: hasName ? parseUniversityName(universityName) : null,
  };
}

function toFavorite(row) {
  return {
    favoriteId: Number(row.favorite_id),
    universityId: Number(row.university_id),
    universityName: row.university_name,
    province: row.province,
    city: row.city,
    zone: row.zone,
    level: row.level,
    type: row.type,
    createdAt: row.created_at,
  };
}

async function resolveUniversity(db, rawTarget) {
  const target = normalizeUniversityTarget(rawTarget);
  let university;

  if (target.universityId) {
    university = await db.one(
      'SELECT id,name,province,city,zone,level,type FROM universities WHERE id=?',
      [target.universityId],
    );
    if (!university) throw requestError('院校不存在或已下架', 404);
    if (target.universityName && university.name !== target.universityName) {
      throw requestError('universityId 与 universityName 不匹配');
    }
  } else {
    university = await db.one(
      'SELECT id,name,province,city,zone,level,type FROM universities WHERE name=?',
      [target.universityName],
    );
    if (!university) throw requestError('院校不存在或已下架', 404);
  }

  return {
    id: Number(university.id),
    name: university.name,
    province: university.province,
    city: university.city,
    zone: university.zone,
    level: university.level,
    type: university.type,
  };
}

async function findFavorite(db, userId, universityId) {
  return db.one(`${FAVORITE_SELECT} WHERE f.user_id=? AND f.university_id=?`, [
    userId,
    universityId,
  ]);
}

function bodyOrQueryTarget(req) {
  const body = req.body || {};
  const query = req.query || {};
  return {
    universityId: hasValue(body.universityId) ? body.universityId : query.universityId,
    universityName: hasValue(body.universityName) ? body.universityName : query.universityName,
  };
}

/**
 * Factory export keeps the route independently testable without connecting to
 * MySQL. Production uses the default dependencies below.
 */
export function createFavoritesRouter({
  database = getDB,
  authenticate = requireAuthenticatedUser,
} = {}) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const db = await database();
      const user = await authenticate(req, res, db);
      if (!user) return;
      const rows = await db.all(
        `${FAVORITE_SELECT} WHERE f.user_id=? ORDER BY f.created_at DESC, f.id DESC`,
        [user.id],
      );
      const favorites = rows.map(toFavorite);
      return res.json({ total: favorites.length, favorites });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const db = await database();
      const user = await authenticate(req, res, db);
      if (!user) return;
      const university = await resolveUniversity(db, req.body || {});
      const existing = await findFavorite(db, user.id, university.id);
      if (existing) return res.json({ created: false, favorite: toFavorite(existing) });

      let created = true;
      try {
        await db.execute('INSERT INTO user_favorites(user_id,university_id) VALUES(?,?)', [
          user.id,
          university.id,
        ]);
      } catch (error) {
        // A competing request may have saved the same unique pair immediately
        // after our lookup. Treat only that race as the normal idempotent path.
        if (error?.code !== 'ER_DUP_ENTRY') throw error;
        created = false;
      }

      const favorite = await findFavorite(db, user.id, university.id);
      if (!favorite) throw new Error('收藏写入后未能读取记录');
      return res.status(created ? 201 : 200).json({ created, favorite: toFavorite(favorite) });
    } catch (error) {
      return next(error);
    }
  });

  async function removeFavorite(req, res, next, target) {
    try {
      const db = await database();
      const user = await authenticate(req, res, db);
      if (!user) return;
      const university = await resolveUniversity(db, target);
      const result = await db.execute(
        'DELETE FROM user_favorites WHERE user_id=? AND university_id=?',
        [user.id, university.id],
      );
      if (Number(result.affectedRows || 0) !== 1) {
        return res.status(404).json({ error: '未找到该收藏记录' });
      }
      return res.json({
        deleted: true,
        favorite: {
          universityId: university.id,
          universityName: university.name,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  // Supports static frontend data during the migration period:
  // DELETE /api/favorites?universityName=清华大学
  // DELETE /api/favorites with { universityName } JSON also works.
  router.delete('/', async (req, res, next) =>
    removeFavorite(req, res, next, bodyOrQueryTarget(req)),
  );
  router.delete('/:universityId', async (req, res, next) =>
    removeFavorite(req, res, next, {
      universityId: req.params.universityId,
      universityName: hasValue(req.body?.universityName)
        ? req.body.universityName
        : req.query?.universityName,
    }),
  );

  return router;
}

export default createFavoritesRouter();
