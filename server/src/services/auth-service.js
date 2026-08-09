import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDB, save } from '../db/index.js';

const TOKEN_TTL_DAYS = Number(process.env.AUTH_TOKEN_TTL_DAYS || 90);

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
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
  return { id: user.id, username: user.username, email: user.email || '', avatarUrl: user.avatar_url || '' };
}

export function issueAccessToken(userId) {
  const db = getDB();
  const token = randomBytes(32).toString('base64url');
  const expiresAtDate = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000);
  // SQLite 的 datetime() 使用 "YYYY-MM-DD HH:mm:ss"；对外仍返回 ISO 8601。
  const expiresAt = expiresAtDate.toISOString();
  const expiresAtDb = expiresAt.slice(0, 19).replace('T', ' ');
  db.prepare("DELETE FROM auth_tokens WHERE datetime(expires_at) <= datetime('now')").run();
  db.prepare('INSERT INTO auth_tokens(user_id,token_hash,expires_at) VALUES(?,?,?)')
    .run(userId, tokenHash(token), expiresAtDb);
  save();
  return { accessToken: token, expiresAt };
}

export function revokeAccessToken(token) {
  if (!token) return;
  const db = getDB();
  db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(tokenHash(token));
  save();
}

export function userIdFromRequest(req) {
  const authorization = String(req.get('authorization') || '');
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const db = getDB();
  if (token) {
    const row = db.prepare("SELECT user_id FROM auth_tokens WHERE token_hash = ? AND datetime(expires_at) > datetime('now')")
      .get(tokenHash(token));
    if (row?.user_id) {
      db.prepare("UPDATE auth_tokens SET last_used_at=datetime('now') WHERE token_hash=?").run(tokenHash(token));
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

export function requireAuthenticatedUser(req, res) {
  const userId = userIdFromRequest(req);
  if (!userId) {
    res.status(401).json({ error: '请先登录后再使用该功能' });
    return null;
  }
  const user = getDB().prepare('SELECT id,username,email,avatar_url FROM users WHERE id = ?').get(userId);
  if (!user) {
    res.status(401).json({ error: '登录状态无效，请重新登录' });
    return null;
  }
  return user;
}
