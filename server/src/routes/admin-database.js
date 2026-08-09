import { Router } from 'express';
import { getDB } from '../db/index.js';
import { requireAdministrator } from '../middleware/admin-auth.js';

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function publicTable(row) {
  return {
    name: row.table_name || '',
    estimatedRows: toNumber(row.table_rows),
    dataBytes: toNumber(row.data_length),
    indexBytes: toNumber(row.index_length),
    updatedAt: row.update_time || null,
  };
}

/**
 * Intentionally read-only database observability. This is not a browser SQL
 * console: direct SQL, credential display and exports stay in the server-side
 * operational runbook so an admin session cannot turn into a database shell.
 */
export function createAdminDatabaseRouter({
  database = getDB,
  authenticate = requireAdministrator,
} = {}) {
  const router = Router();

  router.get('/database/status', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      const [identity, migrations, tables] = await Promise.all([
        db.one('SELECT DATABASE() AS database_name, VERSION() AS server_version, UTC_TIMESTAMP(3) AS checked_at'),
        db.all('SELECT version,applied_at FROM schema_migrations ORDER BY applied_at ASC,version ASC'),
        db.all(`SELECT table_name,table_rows,data_length,index_length,update_time
          FROM information_schema.tables
          WHERE table_schema=DATABASE() AND table_type='BASE TABLE'
          ORDER BY table_name ASC`),
      ]);
      const publicTables = tables.map(publicTable);
      return res.json({
        checkedAt: identity?.checked_at || new Date().toISOString(),
        databaseName: identity?.database_name || '',
        serverVersion: identity?.server_version || '',
        migrationCount: migrations.length,
        migrations: migrations.map((row) => ({ version: row.version, appliedAt: row.applied_at || null })),
        tables: publicTables,
        totals: {
          tables: publicTables.length,
          estimatedRows: publicTables.reduce((sum, table) => sum + table.estimatedRows, 0),
          dataBytes: publicTables.reduce((sum, table) => sum + table.dataBytes, 0),
          indexBytes: publicTables.reduce((sum, table) => sum + table.indexBytes, 0),
        },
      });
    } catch (error) { return next(error); }
  });

  return router;
}

export default createAdminDatabaseRouter();
