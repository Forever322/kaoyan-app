import { Router } from 'express';
import { getDB } from '../db/index.js';
import { hashPassword, issueAccessToken, publicUser, requireAuthenticatedUser, revokeAccessToken, verifyPassword } from '../services/auth-service.js';

const router = Router();
const USERNAME_PATTERN = /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/;

function validateCredentials({ username, password, email = '' }) {
  if (!USERNAME_PATTERN.test(String(username || ''))) return '昵称需为 2–32 位中文、字母、数字、下划线或连字符';
  if (String(password || '').length < 8 || String(password || '').length > 128) return '密码长度需为 8–128 位';
  if (String(email).length > 120) return '邮箱长度不能超过 120 位';
  return null;
}

router.post('/register', async (req, res, next) => {
  try {
    const { username = '', password = '', email = '' } = req.body || {};
    const error = validateCredentials({ username, password, email });
    if (error) return res.status(400).json({ error });

    const db = await getDB();
    const normalizedUsername = username.trim();
    if (await db.one('SELECT id FROM users WHERE username=?', [normalizedUsername])) {
      return res.status(409).json({ error: '该昵称已被注册' });
    }

    let result;
    try {
      result = await db.execute('INSERT INTO users(username,password_hash,email) VALUES(?,?,?)', [
        normalizedUsername,
        hashPassword(password),
        String(email).trim(),
      ]);
    } catch (insertError) {
      // The preflight lookup is user-friendly, while this preserves the same
      // conflict response when two requests register the same name concurrently.
      if (insertError?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: '该昵称已被注册' });
      }
      throw insertError;
    }
    const user = await db.one('SELECT id,username,email,avatar_url FROM users WHERE id=?', [result.insertId]);
    const token = await issueAccessToken(db, user.id);
    return res.status(201).json({ user: publicUser(user), ...token });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username = '', password = '' } = req.body || {};
    if (!String(username).trim() || String(username).length > 32 || !String(password) || String(password).length > 128) {
      return res.status(400).json({ error: '昵称或密码格式不正确' });
    }
    const db = await getDB();
    const user = await db.one('SELECT id,username,email,avatar_url,password_hash FROM users WHERE username=?', [String(username).trim()]);
    if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: '昵称或密码错误' });
    const token = await issueAccessToken(db, user.id);
    return res.json({ user: publicUser(user), ...token });
  } catch (error) {
    next(error);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const db = await getDB();
    const user = await requireAuthenticatedUser(req, res, db);
    if (!user) return;
    return res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = String(req.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (token) {
      const db = await getDB();
      await revokeAccessToken(token, db);
    }
    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
