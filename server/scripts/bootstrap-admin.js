import 'dotenv/config';
import { timingSafeEqual } from 'node:crypto';
import { assertMigrationsCurrent, closeDB } from '../src/db/index.js';
import { writeAdminAudit } from '../src/services/admin-audit-service.js';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function secretMatches(expected, actual) {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function bootstrapAdmin() {
  const username = argValue('--username') || String(process.env.ADMIN_BOOTSTRAP_USERNAME || '').trim();
  const expectedToken = String(process.env.ADMIN_BOOTSTRAP_TOKEN || '');
  const suppliedToken = argValue('--token') || String(process.env.ADMIN_BOOTSTRAP_CONFIRM_TOKEN || '');
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/u.test(username)) {
    throw new Error('请通过 --username 或 ADMIN_BOOTSTRAP_USERNAME 提供已注册的 2–32 位用户名');
  }
  if (expectedToken.length < 32) {
    throw new Error('ADMIN_BOOTSTRAP_TOKEN 必须设置为至少 32 位的随机值；该变量只应临时用于首次管理员初始化');
  }
  if (!suppliedToken || !secretMatches(expectedToken, suppliedToken)) {
    throw new Error('请通过 --token 提供与 ADMIN_BOOTSTRAP_TOKEN 一致的确认令牌');
  }

  const db = await assertMigrationsCurrent();
  try {
    await db.transaction(async (tx) => {
      const target = await tx.one('SELECT id,username,role,status FROM users WHERE username=? FOR UPDATE', [username]);
      if (!target) throw new Error('目标用户不存在；请先在 App 或 /api/auth/register 注册该账号');
      const existing = await tx.one("SELECT id,username FROM users WHERE role='super_admin' LIMIT 1 FOR UPDATE");
      if (existing && Number(existing.id) !== Number(target.id)) {
        throw new Error(`已有超级管理员 ${existing.username}；拒绝重复初始化。请由现有超级管理员在受控运维流程中授权。`);
      }
      const before = { id: Number(target.id), username: target.username, role: target.role || 'user', status: target.status || 'active' };
      await tx.execute("UPDATE users SET role='super_admin',status='active' WHERE id=?", [target.id]);
      await tx.execute('DELETE FROM auth_tokens WHERE user_id=?', [target.id]);
      await writeAdminAudit(tx, {
        actorUserId: null,
        action: 'admin.bootstrap',
        resourceType: 'user',
        resourceId: String(target.id),
        before,
        after: { ...before, role: 'super_admin', status: 'active' },
        metadata: { mechanism: 'cli', initialBootstrap: true },
      });
      console.log(`[Admin] 用户 ${target.username}（#${target.id}）已初始化为 super_admin；其旧登录令牌已失效，请重新登录。`);
    });
  } finally {
    await closeDB();
  }
}

bootstrapAdmin().catch((error) => {
  console.error(`[Admin] 初始化失败：${error?.message || error}`);
  process.exitCode = 1;
});
