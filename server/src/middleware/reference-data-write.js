import { timingSafeEqual } from 'node:crypto';

/**
 * 院校与国家线属于平台参考数据，不能由公开浏览器接口直接写入。
 * 运维导入若确有需要，必须显式配置 DATA_ADMIN_TOKEN 并通过 X-Data-Admin-Token 提交。
 */
export function requireReferenceDataWriteToken(req, res, next) {
  const expected = String(process.env.DATA_ADMIN_TOKEN || '');
  const received = String(req.get('x-data-admin-token') || '');
  if (!expected) {
    return res.status(403).json({ error: '参考数据写入接口未启用，请使用受控导入任务更新数据' });
  }
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return res.status(403).json({ error: '参考数据写入权限不足' });
  }
  return next();
}
