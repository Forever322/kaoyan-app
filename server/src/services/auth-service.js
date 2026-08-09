import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDB } from '../db/index.js';

const TOKEN_TTL_DAYS = Number(process.env.AUTH_TOKEN_TTL_DAYS || 90);

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function mysqlUtcDate(date) {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [algorithm, salt, hash] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function publicUser(user) {
  return {
    id: Number(user.id),
    username: user.username,
    email: user.email || '',
    avatarUrl: user.avatar_url || '',
    role: user.role || 'user',
    status: user.status || 'active',
    lastLoginAt: user.last_login_at || null,
  };
}

export async function issueAccessToken(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAtDate = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000);
  const expiresAt = expiresAtDate.toISOString();
  await db.execute('DELETE FROM auth_tokens WHERE expires_at <= UTC_TIMESTAMP(3)');
  await db.execute('INSERT INTO auth_tokens(user_id,token_hash,expires_at) VALUES(?,?,?)', [
    userId,
    tokenHash(token),
    mysqlUtcDate(expiresAtDate),
  ]);
  return { accessToken: token, expiresAt };
}

export async function revokeAccessToken(token, db = null) {
  if (!token) return;
  const database = db || await getDB();
  await database.execute('DELETE FROM auth_tokens WHERE token_hash = ?', [tokenHash(token)]);
}

export async function userIdFromRequest(req, db = null) {
  const database = db || await getDB();
  const authorization = String(req.get('authorization') || '');
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (token) {
    const hash = tokenHash(token);
    const row = await database.one('SELECT user_id FROM auth_tokens WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)', [hash]);
    if (row?.user_id) {
      await database.execute('UPDATE auth_tokens SET last_used_at=UTC_TIMESTAMP(3) WHERE token_hash=?', [hash]);
      return Number(row.user_id);
    }
    return null;
  }

  // 仅用于本地前端联调。生产环境默认关闭，只有显式设为 true 才会开启。
  const allowDevHeader = process.env.ALLOW_DEV_HEADER_AUTH === 'true'
    || (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_HEADER_AUTH !== 'false');
  if (!allowDevHeader) return null;
  const userId = Number(req.get('x-user-id'));
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

export async function requireAuthenticatedUser(req, res, db = null) {
  const database = db || await getDB();
  const userId = await userIdFromRequest(req, database);
  if (!userId) {
    res.status(401).json({ error: '请先登录后再使用该功能' });
    return null;
  }
  const user = await database.one(
    'SELECT id,username,email,avatar_url,role,status,last_login_at FROM users WHERE id = ?',
    [userId],
  );
  if (!user) {
    res.status(401).json({ error: '登录状态无效，请重新登录' });
    return null;
  }
  if (String(user.status || 'active') !== 'active') {
    res.status(403).json({ error: '该账号已被停用，请联系管理员' });
    return null;
  }
  return user;
}
