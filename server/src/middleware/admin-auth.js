import { requireAuthenticatedUser } from '../services/auth-service.js';

export const ADMIN_ROLES = new Set(['admin', 'super_admin']);

/**
 * Admin APIs always require a real Bearer token.  The legacy X-User-Id local
 * development compatibility path intentionally cannot grant admin access.
 */
export async function requireAdministrator(req, res, db) {
  const authorization = String(req.get('authorization') || '');
  if (!/^Bearer\s+\S+$/iu.test(authorization)) {
    res.status(401).json({ error: '管理后台需要使用登录令牌' });
    return null;
  }
  const user = await requireAuthenticatedUser(req, res, db);
  if (!user) return null;
  if (!ADMIN_ROLES.has(String(user.role || 'user'))) {
    res.status(403).json({ error: '当前账号没有管理权限' });
    return null;
  }
  // This reviewed emergency switch is intentionally checked server-side. The
  // static /admin/ assets may still load, but no management data or mutation
  // is available while the console flag is paused.
  const consoleFlag = await db.one('SELECT enabled FROM feature_flags WHERE flag_key=?', ['admin-console']);
  if (consoleFlag && !(consoleFlag.enabled === true || Number(consoleFlag.enabled) === 1)) {
    res.status(403).json({ error: '管理后台当前已被运维暂停' });
    return null;
  }
  return user;
}

export function isSuperAdministrator(user) {
  return String(user?.role || '') === 'super_admin';
}
