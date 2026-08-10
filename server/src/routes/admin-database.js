import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { Router } from 'express';
import initSqlJs from 'sql.js';
import * as XLSX from 'xlsx';
import { getDB } from '../db/index.js';
import { isSuperAdministrator, requireAdministrator } from '../middleware/admin-auth.js';
import { requestAuditMetadata, safeAuditSnapshot, writeAdminAudit } from '../services/admin-audit-service.js';

const MAX_PAGE = 10_000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 20_000;
const MAX_IMPORT_ROWS = 5_000;
const MAX_IMPORT_BYTES = 12 * 1024 * 1024;
const TEXT_TYPES = new Set(['char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext', 'enum', 'set']);
const JSON_TYPES = new Set(['json']);
const NUMBER_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'float', 'double', 'real']);
const BOOLEAN_COLUMN = /^(is_|has_|allow_|enabled$|.*_enabled$|.*_required$|.*_allowed$)/iu;
const SENSITIVE_COLUMN = /(pass(?:word)?|secret|token|api[_-]?key|authorization|credential|cookie|private[_-]?key)/iu;
const WRITE_BLOCKED_TABLES = new Set(['schema_migrations', 'admin_audit_logs', 'auth_tokens']);
const IMPORT_FORMATS = new Set(['csv', 'txt', 'sql', 'xlsx', 'db']);
const EXPORT_FORMATS = new Set(['csv', 'txt', 'sql', 'xlsx']);
const DATABASE_MANAGER_AGENT_TYPE = 'database-manager';

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function scalar(value, field) {
  if (Array.isArray(value)) throw requestError(`${field} 只能传一个值`);
  return value;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parsePositiveInteger(value, field, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/u.test(text)) throw requestError(`${field} 必须是 ${min}–${max} 的整数`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw requestError(`${field} 必须是 ${min}–${max} 的整数`);
  return number;
}

function parsePagination(query = {}) {
  const page = query.page === undefined || String(query.page).trim() === ''
    ? 1
    : parsePositiveInteger(scalar(query.page, 'page'), 'page', { min: 1, max: MAX_PAGE });
  const pageSize = query.pageSize === undefined || String(query.pageSize).trim() === ''
    ? DEFAULT_PAGE_SIZE
    : parsePositiveInteger(scalar(query.pageSize, 'pageSize'), 'pageSize', { min: 1, max: MAX_PAGE_SIZE });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function parseLimit(query = {}) {
  return query.limit === undefined || String(query.limit).trim() === ''
    ? 5_000
    : parsePositiveInteger(scalar(query.limit, 'limit'), 'limit', { min: 1, max: MAX_EXPORT_ROWS });
}

function parseOptionalText(value, field, maxLength) {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  const text = String(scalar(value, field)).trim();
  if (text.length > maxLength) throw requestError(`${field} 不能超过 ${maxLength} 个字符`);
  return text;
}

function parseFormat(value, allowed, field = 'format') {
  const format = String(value || '').trim().toLowerCase();
  if (!allowed.has(format)) throw requestError(`${field} 必须是 ${[...allowed].join(' / ')}`);
  return format;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(text)) return true;
  if (['false', '0', 'no', 'n'].includes(text)) return false;
  throw requestError('布尔值格式不正确');
}

function ensurePlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw requestError(`${field} 必须是对象`);
  }
  return value;
}

function quoteIdentifier(identifier) {
  const name = String(identifier || '').trim();
  if (!/^[A-Za-z0-9_]+$/u.test(name)) throw requestError('数据库标识符格式不正确');
  return `\`${name.replaceAll('`', '``')}\``;
}

function tableNameFromParam(value) {
  const tableName = String(value || '').trim();
  if (!/^[A-Za-z0-9_]{1,64}$/u.test(tableName)) throw requestError('表名格式不正确');
  return tableName;
}

function publicTable(row) {
  return {
    name: row.table_name || row.TABLE_NAME || '',
    estimatedRows: toNumber(row.table_rows ?? row.TABLE_ROWS),
    dataBytes: toNumber(row.data_length ?? row.DATA_LENGTH),
    indexBytes: toNumber(row.index_length ?? row.INDEX_LENGTH),
    updatedAt: row.update_time || row.UPDATE_TIME || null,
  };
}

function publicColumn(row) {
  const name = row.column_name || row.COLUMN_NAME || '';
  const dataType = String(row.data_type || row.DATA_TYPE || '').toLowerCase();
  const columnType = String(row.column_type || row.COLUMN_TYPE || dataType).toLowerCase();
  const extra = String(row.extra || row.EXTRA || '').toLowerCase();
  const primaryKey = String(row.column_key || row.COLUMN_KEY || '') === 'PRI';
  const autoIncrement = extra.includes('auto_increment');
  const sensitive = SENSITIVE_COLUMN.test(name);
  return {
    name,
    dataType,
    columnType,
    nullable: String(row.is_nullable || row.IS_NULLABLE || '').toUpperCase() === 'YES',
    defaultValue: row.column_default ?? row.COLUMN_DEFAULT ?? null,
    maxLength: row.character_maximum_length === null || row.character_maximum_length === undefined
      ? null
      : toNumber(row.character_maximum_length, null),
    numericPrecision: row.numeric_precision === null || row.numeric_precision === undefined
      ? null
      : toNumber(row.numeric_precision, null),
    numericScale: row.numeric_scale === null || row.numeric_scale === undefined
      ? null
      : toNumber(row.numeric_scale, null),
    primaryKey,
    autoIncrement,
    sensitive,
    writable: !autoIncrement && !sensitive,
  };
}

async function loadTableMetadata(db, requestedTable) {
  const tableName = tableNameFromParam(requestedTable);
  const table = await db.one(`SELECT table_name,table_rows,data_length,index_length,update_time
    FROM information_schema.tables
    WHERE table_schema=DATABASE() AND table_type='BASE TABLE' AND table_name=?`, [tableName]);
  if (!table) throw requestError('数据表不存在', 404);
  const columnRows = await db.all(`SELECT column_name,data_type,column_type,is_nullable,column_default,column_key,extra,
      character_maximum_length,numeric_precision,numeric_scale
    FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name=?
    ORDER BY ordinal_position ASC`, [tableName]);
  const columns = columnRows.map(publicColumn);
  if (!columns.length) throw requestError('数据表没有可读取字段', 404);
  const primaryColumns = columns.filter((column) => column.primaryKey);
  return { table: publicTable(table), tableName, columns, primaryColumns };
}

function requireDatabaseOperator(actor) {
  if (!isSuperAdministrator(actor)) throw requestError('只有超级管理员可以直接操作数据库', 403);
}

function primaryKey(meta) {
  if (meta.primaryColumns.length !== 1) {
    throw requestError('该表不是单字段主键，请通过领域接口或导入流程维护', 400);
  }
  return meta.primaryColumns[0];
}

function redactRow(row, columns) {
  const sensitive = new Set(columns.filter((column) => column.sensitive).map((column) => column.name));
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [
    key,
    sensitive.has(key) && value !== null && value !== undefined && value !== '' ? '[redacted]' : value,
  ]));
}

function exportableColumns(columns) {
  return columns.filter((column) => !column.sensitive);
}

function columnMap(meta) {
  return new Map(meta.columns.map((column) => [column.name, column]));
}

function normalizeCellValue(value, column) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' && column.nullable) return null;
    if (trimmed.toUpperCase() === 'NULL' && column.nullable) return null;
    value = trimmed;
  }
  if (JSON_TYPES.has(column.dataType)) {
    if (typeof value === 'string') {
      try { JSON.parse(value); } catch { throw requestError(`${column.name} 必须是有效 JSON`); }
      return value;
    }
    return JSON.stringify(value);
  }
  if (NUMBER_TYPES.has(column.dataType)) {
    if (value === '' && column.nullable) return null;
    if (column.columnType === 'tinyint(1)' || BOOLEAN_COLUMN.test(column.name)) {
      if (typeof value === 'boolean') return value ? 1 : 0;
      const text = String(value).trim().toLowerCase();
      if (['true', 'yes', 'y'].includes(text)) return 1;
      if (['false', 'no', 'n'].includes(text)) return 0;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) throw requestError(`${column.name} 必须是数字`);
    return number;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function writableColumns(meta, { importMode = false } = {}) {
  const blocked = WRITE_BLOCKED_TABLES.has(meta.tableName);
  return meta.columns.filter((column) => !blocked && !column.sensitive
    && (!column.autoIncrement || (importMode && column.primaryKey))
    && (importMode || !column.primaryKey));
}

function normalizeInputRow(row, meta, { requireValue = true, importMode = false } = {}) {
  const input = ensurePlainObject(row, 'row');
  const known = columnMap(meta);
  const allowed = new Map(writableColumns(meta, { importMode }).map((column) => [column.name, column]));
  const normalized = {};
  for (const [key, value] of Object.entries(input)) {
    if (!known.has(key)) throw requestError(`字段 ${key} 不存在于表 ${meta.tableName}`);
    if (!allowed.has(key)) throw requestError(`字段 ${key} 不允许通过数据库工作台写入`);
    const normalizedValue = normalizeCellValue(value, allowed.get(key));
    if (normalizedValue !== undefined) normalized[key] = normalizedValue;
  }
  if (requireValue && Object.keys(normalized).length === 0) throw requestError('请至少提供一个可写字段');
  return normalized;
}

function whereForKeyword(keyword, columns) {
  if (!keyword) return { sql: '', params: [] };
  const textColumns = columns.filter((column) => TEXT_TYPES.has(column.dataType));
  if (!textColumns.length) return { sql: '', params: [] };
  return {
    sql: ` WHERE ${textColumns.map((column) => `${quoteIdentifier(column.name)} LIKE ?`).join(' OR ')}`,
    params: textColumns.map(() => `%${keyword}%`),
  };
}

function orderClause(query, meta) {
  const requested = parseOptionalText(query.orderBy, 'orderBy', 64);
  const column = requested
    ? meta.columns.find((candidate) => candidate.name === requested)
    : (meta.primaryColumns[0] || meta.columns[0]);
  if (!column) return '';
  const direction = String(query.orderDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return ` ORDER BY ${quoteIdentifier(column.name)} ${direction}`;
}

async function selectRows(db, meta, { keyword = '', limit = DEFAULT_PAGE_SIZE, offset = 0, orderBy = '', orderDir = '' } = {}) {
  const where = whereForKeyword(keyword, meta.columns);
  const sql = `SELECT * FROM ${quoteIdentifier(meta.tableName)}${where.sql}${orderClause({ orderBy, orderDir }, meta)} LIMIT ${limit} OFFSET ${offset}`;
  return db.all(sql, where.params);
}

async function selectRowByPrimaryKey(db, meta, id) {
  const pk = primaryKey(meta);
  return db.one(`SELECT * FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(pk.name)}=?`, [id]);
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function delimitedExport(rows, columns, delimiter) {
  const names = columns.map((column) => column.name);
  return [
    names.map(csvEscape).join(delimiter),
    ...rows.map((row) => names.map((name) => csvEscape(row[name])).join(delimiter)),
  ].join('\r\n');
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
}

function sqlExport(tableName, rows, columns) {
  const names = columns.map((column) => column.name);
  const identifiers = names.map(quoteIdentifier).join(',');
  return rows.length
    ? rows.map((row) => `INSERT INTO ${quoteIdentifier(tableName)} (${identifiers}) VALUES (${names.map((name) => sqlLiteral(row[name])).join(',')});`).join('\n')
    : `-- ${tableName}: no rows exported\n`;
}

function xlsxExport(rows, columns, tableName) {
  const names = columns.map((column) => column.name);
  const worksheet = XLSX.utils.json_to_sheet(rows.map((row) => Object.fromEntries(names.map((name) => [name, row[name] ?? '']))), { header: names });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, tableName.slice(0, 31) || 'data');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/u, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value !== '') || rows.length) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || '').trim()).filter(Boolean);
  if (!headers.length) throw requestError('导入文件缺少表头');
  return rows.slice(1)
    .filter((values) => values.some((value) => String(value || '').trim() !== ''))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function splitSqlStatements(source) {
  const statements = [];
  let current = '';
  let quoted = false;
  let quote = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    current += char;
    if (quoted) {
      if (char === '\\') {
        current += source[index + 1] || '';
        index += 1;
      } else if (char === quote) quoted = false;
      continue;
    }
    if (char === "'" || char === '"') {
      quoted = true;
      quote = char;
    } else if (char === ';') {
      statements.push(current.slice(0, -1).trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter(Boolean);
}

function parseSqlValueList(source) {
  const rows = [];
  let index = 0;
  const skipWhitespace = () => { while (/\s/u.test(source[index] || '')) index += 1; };
  const parseValue = () => {
    skipWhitespace();
    if (source[index] === "'") {
      index += 1;
      let value = '';
      while (index < source.length) {
        const char = source[index];
        const next = source[index + 1];
        if (char === "'" && next === "'") {
          value += "'";
          index += 2;
        } else if (char === '\\') {
          value += next || '';
          index += 2;
        } else if (char === "'") {
          index += 1;
          break;
        } else {
          value += char;
          index += 1;
        }
      }
      return value;
    }
    let raw = '';
    while (index < source.length && ![',', ')'].includes(source[index])) {
      raw += source[index];
      index += 1;
    }
    const text = raw.trim();
    if (/^null$/iu.test(text)) return null;
    if (/^true$/iu.test(text)) return true;
    if (/^false$/iu.test(text)) return false;
    if (/^-?\d+(?:\.\d+)?$/u.test(text)) return Number(text);
    return text;
  };

  while (index < source.length) {
    skipWhitespace();
    if (index >= source.length) break;
    if (source[index] !== '(') throw requestError('SQL 导入仅支持 INSERT ... VALUES (...)');
    index += 1;
    const row = [];
    while (index < source.length) {
      row.push(parseValue());
      skipWhitespace();
      if (source[index] === ',') {
        index += 1;
        continue;
      }
      if (source[index] === ')') {
        index += 1;
        break;
      }
      throw requestError('SQL VALUES 格式不正确');
    }
    rows.push(row);
    skipWhitespace();
    if (source[index] === ',') index += 1;
  }
  return rows;
}

function parseSqlImport(content, expectedTable) {
  const rows = [];
  for (const statement of splitSqlStatements(content)) {
    const match = statement.match(/^INSERT\s+INTO\s+`?([A-Za-z0-9_]+)`?\s*\(([^)]+)\)\s*VALUES\s*(.+)$/isu);
    if (!match) throw requestError('SQL 导入仅支持 INSERT INTO table (columns) VALUES (...) 语句');
    const [, tableName, rawColumns, rawValues] = match;
    if (tableName !== expectedTable) throw requestError(`SQL 导入表名 ${tableName} 与目标表 ${expectedTable} 不一致`);
    const columns = rawColumns.split(',').map((column) => column.trim().replace(/^`|`$/gu, ''));
    const valueRows = parseSqlValueList(rawValues.trim());
    for (const values of valueRows) {
      if (values.length !== columns.length) throw requestError('SQL 导入字段数量与值数量不一致');
      rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
    }
  }
  return rows;
}

async function sqliteObjects(database, sql, params = []) {
  const statement = database.prepare(sql);
  const rows = [];
  try {
    statement.bind(params);
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

async function parseDbImport(content, expectedTable, sourceTable = expectedTable) {
  const sourceName = tableNameFromParam(sourceTable || expectedTable);
  const SQL = await initSqlJs();
  const database = new SQL.Database(content);
  try {
    const tables = await sqliteObjects(database, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC");
    const tableNames = tables.map((table) => String(table.name || ''));
    if (!tableNames.includes(sourceName)) {
      throw requestError(`DB 文件中找不到表 ${sourceName}，可用表：${tableNames.slice(0, 20).join('、') || '无'}`);
    }
    return sqliteObjects(database, `SELECT * FROM ${quoteIdentifier(sourceName).replaceAll('`', '"')}`);
  } finally {
    database.close();
  }
}

function contentFromBody(body = {}, format) {
  if (Array.isArray(body.rows)) return null;
  if (typeof body.content === 'string') {
    const bytes = Buffer.byteLength(body.content, 'utf8');
    if (bytes > MAX_IMPORT_BYTES) throw requestError(`导入内容不能超过 ${MAX_IMPORT_BYTES} 字节`);
    return body.content;
  }
  if (typeof body.contentBase64 === 'string') {
    const buffer = Buffer.from(body.contentBase64, 'base64');
    if (buffer.byteLength > MAX_IMPORT_BYTES) throw requestError(`导入文件不能超过 ${MAX_IMPORT_BYTES} 字节`);
    return ['xlsx', 'db'].includes(format) ? buffer : buffer.toString('utf8');
  }
  throw requestError('请提供 content、contentBase64 或 rows');
}

async function rowsFromImportBody(body, format, tableName) {
  if (Array.isArray(body.rows)) return body.rows;
  const content = contentFromBody(body, format);
  if (format === 'csv') return parseDelimited(content, ',');
  if (format === 'txt') return parseDelimited(content, '\t');
  if (format === 'sql') return parseSqlImport(content, tableName);
  if (format === 'xlsx') {
    const workbook = XLSX.read(content, { type: 'buffer', raw: false, cellDates: false });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw requestError('XLSX 文件没有工作表');
    return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '', raw: false });
  }
  if (format === 'db') return parseDbImport(content, tableName, body.sourceTable);
  throw requestError('不支持的导入格式');
}

async function normalizeImportRows(body, format, meta) {
  const rows = await rowsFromImportBody(body, format, meta.tableName);
  if (!Array.isArray(rows) || rows.length === 0) throw requestError('导入文件没有数据行');
  if (rows.length > MAX_IMPORT_ROWS) throw requestError(`单次最多导入 ${MAX_IMPORT_ROWS} 行`);
  return rows.map((row) => normalizeInputRow(row, meta, { importMode: true }));
}

async function insertRows(tx, meta, rows, mode) {
  const primaryNames = new Set(meta.primaryColumns.map((column) => column.name));
  const results = [];
  for (const row of rows) {
    const fields = Object.keys(row);
    if (!fields.length) continue;
    const values = fields.map((field) => row[field]);
    const insertSql = `INSERT INTO ${quoteIdentifier(meta.tableName)} (${fields.map(quoteIdentifier).join(',')}) VALUES (${fields.map(() => '?').join(',')})`;
    const updateFields = fields.filter((field) => !primaryNames.has(field));
    const sql = mode === 'upsert' && updateFields.length
      ? `${insertSql} ON DUPLICATE KEY UPDATE ${updateFields.map((field) => `${quoteIdentifier(field)}=VALUES(${quoteIdentifier(field)})`).join(',')}`
      : insertSql;
    results.push(await tx.execute(sql, values));
  }
  return results;
}

function checksumRows(rows) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function responseFileName(tableName, format) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/gu, '');
  return `${tableName}-${stamp}.${format}`;
}

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

  router.get('/database/tables/:table/schema', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireDatabaseOperator(actor);
      const meta = await loadTableMetadata(db, req.params.table);
      return res.json({
        table: meta.table,
        primaryKey: meta.primaryColumns.map((column) => column.name),
        writeBlocked: WRITE_BLOCKED_TABLES.has(meta.tableName),
        columns: meta.columns,
      });
    } catch (error) { return next(error); }
  });

  router.get('/database/tables/:table/rows', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireDatabaseOperator(actor);
      const meta = await loadTableMetadata(db, req.params.table);
      const pagination = parsePagination(req.query);
      const keyword = parseOptionalText(req.query.keyword, 'keyword', 100);
      const where = whereForKeyword(keyword, meta.columns);
      const total = toNumber((await db.one(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(meta.tableName)}${where.sql}`, where.params))?.total);
      const rows = await selectRows(db, meta, {
        keyword,
        limit: pagination.pageSize,
        offset: pagination.offset,
        orderBy: parseOptionalText(req.query.orderBy, 'orderBy', 64),
        orderDir: parseOptionalText(req.query.orderDir, 'orderDir', 8),
      });
      return res.json({
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pagination.pageSize),
        primaryKey: meta.primaryColumns.map((column) => column.name),
        columns: meta.columns,
        data: rows.map((row) => redactRow(row, meta.columns)),
      });
    } catch (error) { return next(error); }
  });

  router.post('/database/tables/:table/rows', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireDatabaseOperator(actor);
      const meta = await loadTableMetadata(db, req.params.table);
      if (WRITE_BLOCKED_TABLES.has(meta.tableName)) throw requestError('该系统表不允许通过数据库工作台写入', 403);
      const row = normalizeInputRow(req.body?.row || req.body, meta, { importMode: true });
      const created = await db.transaction(async (tx) => {
        const fields = Object.keys(row);
        const result = await tx.execute(
          `INSERT INTO ${quoteIdentifier(meta.tableName)} (${fields.map(quoteIdentifier).join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
          fields.map((field) => row[field]),
        );
        const pk = meta.primaryColumns.length === 1 ? meta.primaryColumns[0] : null;
        const id = pk && (row[pk.name] ?? result.insertId);
        const after = id ? await tx.one(`SELECT * FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(pk.name)}=?`, [id]) : null;
        await writeAdminAudit(tx, {
          actorUserId: actor.id,
          action: 'database.row.create',
          resourceType: 'database_table',
          resourceId: meta.tableName,
          after: after ? redactRow(after, meta.columns) : safeAuditSnapshot(row),
          metadata: { ...requestAuditMetadata(req), table: meta.tableName, columns: fields },
        });
        return { result, after };
      });
      return res.status(201).json({ affectedRows: toNumber(created.result.affectedRows, 1), data: created.after ? redactRow(created.after, meta.columns) : null });
    } catch (error) { return next(error); }
  });

  router.patch('/database/tables/:table/rows/:id', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireDatabaseOperator(actor);
      const meta = await loadTableMetadata(db, req.params.table);
      if (WRITE_BLOCKED_TABLES.has(meta.tableName)) throw requestError('该系统表不允许通过数据库工作台写入', 403);
      const pk = primaryKey(meta);
      const patch = normalizeInputRow(req.body?.row || req.body, meta, { importMode: false });
      const updated = await db.transaction(async (tx) => {
        const before = await tx.one(`SELECT * FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(pk.name)}=? FOR UPDATE`, [req.params.id]);
        if (!before) throw requestError('记录不存在', 404);
        const fields = Object.keys(patch);
        const result = await tx.execute(
          `UPDATE ${quoteIdentifier(meta.tableName)} SET ${fields.map((field) => `${quoteIdentifier(field)}=?`).join(',')} WHERE ${quoteIdentifier(pk.name)}=?`,
          [...fields.map((field) => patch[field]), req.params.id],
        );
        const after = await tx.one(`SELECT * FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(pk.name)}=?`, [req.params.id]);
        await writeAdminAudit(tx, {
          actorUserId: actor.id,
          action: 'database.row.update',
          resourceType: 'database_table',
          resourceId: meta.tableName,
          before: redactRow(before, meta.columns),
          after: redactRow(after, meta.columns),
          metadata: { ...requestAuditMetadata(req), table: meta.tableName, primaryKey: pk.name, id: String(req.params.id), columns: fields },
        });
        return { result, after };
      });
      return res.json({ affectedRows: toNumber(updated.result.affectedRows), data: redactRow(updated.after, meta.columns) });
    } catch (error) { return next(error); }
  });

  router.delete('/database/tables/:table/rows/:id', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireDatabaseOperator(actor);
      const meta = await loadTableMetadata(db, req.params.table);
      if (WRITE_BLOCKED_TABLES.has(meta.tableName)) throw requestError('该系统表不允许通过数据库工作台删除', 403);
      const pk = primaryKey(meta);
      const deleted = await db.transaction(async (tx) => {
        const before = await tx.one(`SELECT * FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(pk.name)}=? FOR UPDATE`, [req.params.id]);
        if (!before) throw requestError('记录不存在', 404);
        const result = await tx.execute(`DELETE FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(pk.name)}=?`, [req.params.id]);
        await writeAdminAudit(tx, {
          actorUserId: actor.id,
          action: 'database.row.delete',
          resourceType: 'database_table',
          resourceId: meta.tableName,
          before: redactRow(before, meta.columns),
          metadata: { ...requestAuditMetadata(req), table: meta.tableName, primaryKey: pk.name, id: String(req.params.id) },
        });
        return result;
      });
      return res.json({ affectedRows: toNumber(deleted.affectedRows) });
    } catch (error) { return next(error); }
  });

  router.get('/database/tables/:table/export', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireDatabaseOperator(actor);
      const meta = await loadTableMetadata(db, req.params.table);
      const format = parseFormat(req.query.format || 'csv', EXPORT_FORMATS);
      const limit = parseLimit(req.query);
      const keyword = parseOptionalText(req.query.keyword, 'keyword', 100);
      const rows = (await selectRows(db, meta, {
        keyword,
        limit,
        offset: 0,
        orderBy: parseOptionalText(req.query.orderBy, 'orderBy', 64),
        orderDir: parseOptionalText(req.query.orderDir, 'orderDir', 8),
      })).map((row) => redactRow(row, meta.columns));
      const columns = exportableColumns(meta.columns);
      const filename = responseFileName(meta.tableName, format);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      if (format === 'csv') {
        res.type('text/csv; charset=utf-8');
        return res.send(`\uFEFF${delimitedExport(rows, columns, ',')}`);
      }
      if (format === 'txt') {
        res.type('text/plain; charset=utf-8');
        return res.send(delimitedExport(rows, columns, '\t'));
      }
      if (format === 'sql') {
        res.type('application/sql; charset=utf-8');
        return res.send(sqlExport(meta.tableName, rows, columns));
      }
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(xlsxExport(rows, columns, meta.tableName));
    } catch (error) { return next(error); }
  });

  router.post('/database/tables/:table/import', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireDatabaseOperator(actor);
      const meta = await loadTableMetadata(db, req.params.table);
      if (WRITE_BLOCKED_TABLES.has(meta.tableName)) throw requestError('该系统表不允许通过数据库工作台导入', 403);
      const format = parseFormat(req.body?.format, IMPORT_FORMATS);
      const dryRun = parseBoolean(req.body?.dryRun, true);
      const mode = String(req.body?.mode || 'insert').trim().toLowerCase();
      if (!['insert', 'upsert'].includes(mode)) throw requestError('mode 必须是 insert 或 upsert');
      const rows = await normalizeImportRows(req.body || {}, format, meta);
      const summary = {
        table: meta.tableName,
        format,
        mode,
        dryRun,
        rowCount: rows.length,
        columns: [...new Set(rows.flatMap((row) => Object.keys(row)))],
        checksum: checksumRows(rows),
        preview: rows.slice(0, 10).map((row) => redactRow(row, meta.columns)),
        review: {
          agentType: DATABASE_MANAGER_AGENT_TYPE,
          displayName: '数据库管理 Agent',
          status: dryRun ? 'waiting_for_confirmation' : 'imported_without_model_review',
          modelReady: false,
          capabilities: ['import_review', 'duplicate_detection', 'field_anomaly_check', 'referential_consistency_check', 'repair_plan'],
          requiresHumanConfirmation: true,
          note: '后续服务器小模型可作为数据库管理 Agent 复用本次解析结果进行来源核对、字段异常检测、重复记录审核和修复计划生成；模型不直接写库。',
        },
      };
      if (dryRun) return res.json(summary);

      const importResult = await db.transaction(async (tx) => {
        const results = await insertRows(tx, meta, rows, mode);
        await writeAdminAudit(tx, {
          actorUserId: actor.id,
          action: 'database.table.import',
          resourceType: 'database_table',
          resourceId: meta.tableName,
          metadata: { ...requestAuditMetadata(req), ...summary, preview: undefined },
        });
        return results;
      });
      return res.status(201).json({
        ...summary,
        affectedRows: importResult.reduce((sum, result) => sum + toNumber(result.affectedRows, 1), 0),
      });
    } catch (error) { return next(error); }
  });

  return router;
}

export default createAdminDatabaseRouter();
