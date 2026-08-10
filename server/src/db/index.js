import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_CONNECTIONS = Math.min(30, Math.max(1, Number(process.env.MYSQL_CONNECTION_LIMIT || 10)));
const CONNECT_RETRIES = Math.min(60, Math.max(0, Number(process.env.MYSQL_CONNECT_RETRIES || 12)));
const CONNECT_RETRY_MS = Math.min(10_000, Math.max(100, Number(process.env.MYSQL_CONNECT_RETRY_MS || 1_000)));

const MIGRATIONS = [
  { version: '001-initial-schema', file: 'migrations/001-initial-schema.sql' },
  { version: '002-extension-primitives', file: 'migrations/002-extension-primitives.sql' },
  { version: '003-university-catalog-governance', file: 'migrations/003-university-catalog-governance.sql' },
  { version: '004-admin-rbac-and-agent-controls', file: 'migrations/004-admin-rbac-and-agent-controls.sql' },
  { version: '005-catalog-issue-lifecycle', file: 'migrations/005-catalog-issue-lifecycle.sql' },
  { version: '006-database-manager-agent', file: 'migrations/006-database-manager-agent.sql' },
];

let dbPromise = null;

export class DatabaseConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseConfigurationError';
  }
}

function mysqlConfig() {
  const mysqlUrl = String(process.env.MYSQL_URL || '').trim();
  if (mysqlUrl) {
    let url;
    try { url = new URL(mysqlUrl); } catch { throw new DatabaseConfigurationError('MYSQL_URL 不是有效的 MySQL 连接地址'); }
    if (!['mysql:', 'mysql2:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/') {
      throw new DatabaseConfigurationError('MYSQL_URL 必须包含 mysql://用户:密码@主机:端口/数据库');
    }
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
    };
  }

  const password = process.env.MYSQL_PASSWORD;
  if (password === undefined || password === '') {
    throw new DatabaseConfigurationError('必须设置 MYSQL_PASSWORD（或 MYSQL_URL），拒绝使用空密码连接 MySQL');
  }
  const database = String(process.env.MYSQL_DATABASE || 'kaoyan').trim();
  const user = String(process.env.MYSQL_USER || 'kaoyan').trim();
  if (!database || !user) throw new DatabaseConfigurationError('MYSQL_DATABASE 和 MYSQL_USER 不能为空');
  return {
    host: String(process.env.MYSQL_HOST || '127.0.0.1').trim(),
    port: Number(process.env.MYSQL_PORT || 3306),
    user,
    password,
    database,
  };
}

function createAdapter(executor, { release = null, end = null } = {}) {
  const adapter = {
    async execute(sql, params = []) {
      const [result] = await executor.execute(sql, params);
      return result;
    },
    async one(sql, params = []) {
      const [rows] = await executor.execute(sql, params);
      return rows[0] || null;
    },
    async all(sql, params = []) {
      const [rows] = await executor.execute(sql, params);
      return rows;
    },
    async transaction(fn) {
      // A transaction adapter is already bound to a single connection. Nested
      // callers participate in the surrounding transaction instead of issuing
      // a second BEGIN/COMMIT pair.
      if (release) return fn(this);
      const connection = await executor.getConnection();
      const transaction = createAdapter(connection, { release: () => connection.release() });
      try {
        await connection.beginTransaction();
        const value = await fn(transaction);
        await connection.commit();
        return value;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        transaction.release?.();
      }
    },
    async withConnection(fn) {
      if (release) return fn(this);
      const connection = await executor.getConnection();
      const scoped = createAdapter(connection, { release: () => connection.release() });
      try {
        return await fn(scoped);
      } finally {
        scoped.release?.();
      }
    },
    release,
    async close() {
      if (end) await end();
    },
  };
  return adapter;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initialise() {
  const config = mysqlConfig();
  const pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: MAX_CONNECTIONS,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS || 10_000),
    timezone: 'Z',
    dateStrings: true,
    jsonStrings: true,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements: false,
  });

  let lastError;
  for (let attempt = 0; attempt <= CONNECT_RETRIES; attempt += 1) {
    try {
      await pool.query('SELECT 1 AS connected');
      return createAdapter(pool, { end: () => pool.end() });
    } catch (error) {
      lastError = error;
      if (attempt >= CONNECT_RETRIES) break;
      await sleep(CONNECT_RETRY_MS);
    }
  }
  await pool.end();
  throw new Error(
    `无法连接 MySQL（已重试 ${CONNECT_RETRIES + 1} 次）：${lastError?.code || lastError?.message || 'unknown_error'}`,
    { cause: lastError },
  );
}

/**
 * Returns the shared asynchronous MySQL adapter. SQL parameter binding must
 * always use `?`; table/column names may only come from static application maps.
 */
export async function getDB() {
  if (!dbPromise) {
    dbPromise = initialise().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

function splitStatements(sql) {
  // Migration files intentionally contain ordinary DDL only (no routines or
  // DELIMITER blocks), so statement splitting can stay narrow and safe.
  return sql.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean);
}

function isRetryableAlreadyAppliedDdl(error) {
  // MySQL 8.4 does not support `ADD COLUMN IF NOT EXISTS` in the form used by
  // multi-column ALTER statements. When a deployment is interrupted after a
  // DDL statement committed but before schema_migrations was recorded, retry
  // only the narrow duplicate-DDL cases and continue the migration. Any type,
  // constraint, permission, or data error still aborts the release.
  return ['ER_TABLE_EXISTS_ERROR', 'ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME', 'ER_CANT_DROP_FIELD_OR_KEY'].includes(error?.code);
}

async function ensureMigrationTable(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(191) NOT NULL,
    checksum CHAR(64) NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function runMigration(db, migration) {
  const path = join(__dirname, migration.file);
  const source = await readFile(path, 'utf8');
  const checksum = createHash('sha256').update(source).digest('hex');
  const applied = await db.one('SELECT version, checksum FROM schema_migrations WHERE version=?', [migration.version]);
  if (applied) {
    if (applied.checksum !== checksum) {
      throw new Error(`迁移文件 ${migration.version} 已被修改。请新增迁移文件，不能改写已部署迁移。`);
    }
    return false;
  }

  // MySQL DDL 会隐式提交，因此每个语句必须可重复执行；只有全部 DDL 成功后
  // 才记录版本。中途失败时修复后可安全重新运行。
  for (const statement of splitStatements(source)) {
    try {
      await db.execute(statement);
    } catch (error) {
      if (!isRetryableAlreadyAppliedDdl(error)) throw error;
      console.warn(`[DB] 迁移 ${migration.version} 检测到已存在的 DDL，跳过并继续：${error.code}`);
    }
  }
  await db.execute('INSERT INTO schema_migrations(version, checksum) VALUES(?, ?)', [migration.version, checksum]);
  console.log(`[DB] 已应用迁移 ${migration.version}`);
  return true;
}

export async function assertMigrationsCurrent() {
  const db = await getDB();
  let rows;
  try {
    rows = await db.all('SELECT version, checksum FROM schema_migrations');
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      throw new Error('MySQL 尚未初始化：请先运行 api-migrate（或 pnpm db:migrate）', { cause: error });
    }
    throw error;
  }
  const applied = new Map(rows.map((row) => [row.version, row.checksum]));
  for (const migration of MIGRATIONS) {
    const source = await readFile(join(__dirname, migration.file), 'utf8');
    const checksum = createHash('sha256').update(source).digest('hex');
    if (!applied.has(migration.version)) {
      throw new Error(`MySQL 缺少迁移 ${migration.version}：请先运行 api-migrate（或 pnpm db:migrate）`);
    }
    if (applied.get(migration.version) !== checksum) {
      throw new Error(`MySQL 迁移 ${migration.version} 的校验和不匹配：请检查发布版本，不能跳过迁移`);
    }
  }
  return db;
}

export async function migrate() {
  const db = await getDB();
  const lockTimeout = Math.min(600, Math.max(1, Number(process.env.MYSQL_MIGRATION_LOCK_TIMEOUT_SECONDS || 60)));
  await db.withConnection(async (connection) => {
    await ensureMigrationTable(connection);
    const lock = await connection.one('SELECT GET_LOCK(?, ?) AS acquired', ['kaoyan_schema_migrations', lockTimeout]);
    if (Number(lock?.acquired || 0) !== 1) throw new Error('等待 MySQL 数据库迁移锁超时，请确认没有其他发布任务正在迁移');
    try {
      for (const migration of MIGRATIONS) await runMigration(connection, migration);
    } finally {
      await connection.execute('SELECT RELEASE_LOCK(?)', ['kaoyan_schema_migrations']);
    }
  });
  console.log('[DB] MySQL 迁移完成');
  return db;
}

/**
 * Destructive reset is intentionally gated so a typo cannot erase production.
 * Use only an empty development database with ALLOW_DB_RESET=true.
 */
export async function reset() {
  if (process.env.ALLOW_DB_RESET !== 'true') {
    throw new Error('拒绝重置数据库：请显式设置 ALLOW_DB_RESET=true（仅开发环境）');
  }
  const db = await getDB();
  const tables = [
    'domain_events', 'background_jobs', 'catalog_data_issues', 'catalog_change_log',
    'retest_rules', 'admission_statistics', 'exam_subjects', 'score_lines',
    'program_offerings', 'programs', 'academic_units', 'campuses', 'university_aliases',
    'source_documents', 'data_import_batches', 'admin_audit_logs', 'agent_configurations',
    'feature_flags', 'agent_runs', 'agent_proposals',
    'user_study_plans', 'user_admission_plans', 'agent_memories', 'agent_messages',
    'agent_conversations', 'study_sessions', 'user_favorites', 'auth_tokens', 'users',
    'uni_requirements', 'admission_scores', 'uni_photos', 'uni_details', 'national_lines', 'universities',
    'schema_migrations',
  ];
  await db.execute('SET FOREIGN_KEY_CHECKS=0');
  try {
    for (const table of tables) await db.execute(`DROP TABLE IF EXISTS \`${table}\``);
  } finally {
    await db.execute('SET FOREIGN_KEY_CHECKS=1');
  }
  console.log('[DB] 已清除 MySQL 表');
  return migrate();
}

export async function closeDB() {
  if (!dbPromise) return;
  const db = await dbPromise;
  await db.close();
  dbPromise = null;
}
