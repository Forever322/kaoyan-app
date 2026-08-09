import { createHash } from 'node:crypto';

function requestKey(req) {
  const authorization = String(req.get('authorization') || '');
  if (authorization) return `token:${createHash('sha256').update(authorization).digest('hex')}`;
  const devUser = String(req.get('x-user-id') || '');
  if (devUser) return `dev-user:${devUser}`;
  const forwardedFor = String(req.get('x-forwarded-for') || '').split(',')[0].trim();
  return `ip:${forwardedFor || req.ip || 'unknown'}`;
}

/**
 * 进程内限流适合单实例 MVP；切到多实例后应替换为 Redis 实现。
 */
export function createRateLimiter({ windowMs, max, key = requestKey }) {
  const requests = new Map();
  let lastCleanup = 0;

  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup > windowMs) {
      lastCleanup = now;
      for (const [entryKey, entry] of requests) {
        if (entry.resetAt <= now) requests.delete(entryKey);
      }
    }
    const entryKey = key(req);
    const entry = requests.get(entryKey);
    const current = !entry || entry.resetAt <= now ? { count: 0, resetAt: now + windowMs } : entry;
    current.count += 1;
    requests.set(entryKey, current);
    if (current.count > max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: '请求过于频繁，请稍后再试', retryAfter });
    }
    return next();
  };
}

