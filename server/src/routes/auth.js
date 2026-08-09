import { Router } from 'express';
import { getDB, save } from '../db/index.js';
import { hashPassword, issueAccessToken, publicUser, requireAuthenticatedUser, revokeAccessToken, verifyPassword } from '../services/auth-service.js';

const router = Router();
const USERNAME_PATTERN = /^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/;

function validateCredentials({ username, password, email = '' }) {
  if (!USERNAME_PATTERN.test(String(username || ''))) return '昵称需为 2–32 位中文、字母、数字、下划线或连字符';
  if (String(password || '').length < 8 || String(password || '').length > 128) return '密码长度需为 8–128 位';
  if (String(email).length > 120) return '邮箱长度不能超过 120 位';
  return null;
}

router.post('/register', (req, res) => {
  const { username = '', password = '', email = '' } = req.body || {};
  const error = validateCredentials({ username, password, email });
  if (error) return res.status(400).json({ error });
  const db = getDB();
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username.trim())) {
    return res.status(409).json({ error: '该昵称已被注册' });
  }
  db.prepare('INSERT INTO users(username,password_hash,email) VALUES(?,?,?)').run(username.trim(), hashPassword(password), String(email).trim());
  const user = db.prepare('SELECT id,username,email,avatar_url FROM users WHERE id=last_insert_rowid()').get();
  const token = issueAccessToken(user.id);
  save();
  return res.status(201).json({ user: publicUser(user), ...token });
});

router.post('/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  if (!String(username).trim() || String(username).length > 32 || !String(password) || String(password).length > 128) {
    return res.status(400).json({ error: '昵称或密码格式不正确' });
  }
  const user = getDB().prepare('SELECT id,username,email,avatar_url,password_hash FROM users WHERE username=?').get(String(username).trim());
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: '昵称或密码错误' });
  const token = issueAccessToken(user.id);
  return res.json({ user: publicUser(user), ...token });
});

router.get('/me', (req, res) => {
  const user = requireAuthenticatedUser(req, res);
  if (!user) return;
  return res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  const token = String(req.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (token) revokeAccessToken(token);
  return res.status(204).end();
});

export default router;
