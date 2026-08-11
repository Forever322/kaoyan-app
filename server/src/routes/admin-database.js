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
const INTEGER_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint']);
const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);
const BOOLEAN_COLUMN = /^(is_|has_|allow_|enabled$|.*_enabled$|.*_required$|.*_allowed$)/iu;
const SENSITIVE_COLUMN = /(pass(?:word)?|secret|token|api[_-]?key|authorization|credential|cookie|private[_-]?key)/iu;
const SERVER_MANAGED_COLUMNS = new Set([
  'created_at', 'updated_at', 'deleted_at', 'applied_at', 'confirmed_at', 'completed_at',
  'source_document_id', 'import_batch_id', 'verification_status', 'catalog_status', 'status',
]);
// Direct database writes are intentionally limited to reference/catalog data.
// Accounts, tokens, policies, audit records and agent control-plane tables must
// always go through their domain services so their authorization invariants
// and side effects cannot be bypassed from the generic workbench.
export const DATABASE_WRITE_ALLOWED_TABLES = new Set([
  'universities', 'uni_details', 'uni_photos', 'national_lines', 'admission_scores', 'uni_requirements',
  'university_aliases', 'campuses', 'academic_units',
  'programs', 'program_offerings', 'exam_subjects', 'score_lines', 'admission_statistics', 'retest_rules',
]);
const DATABASE_READ_ALLOWED_TABLES = new Set([
  ...DATABASE_WRITE_ALLOWED_TABLES,
  'data_import_batches', 'source_documents', 'catalog_change_log', 'catalog_data_issues',
]);
const DATABASE_DELETE_ALLOWED_TABLES = new Set([
  'uni_photos', 'national_lines', 'admission_scores', 'uni_requirements',
  'exam_subjects', 'score_lines', 'admission_statistics', 'retest_rules',
]);
const IMPORT_FORMATS = new Set(['csv', 'txt', 'json', 'sql', 'xlsx', 'db']);
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
  const name = row.table_name || row.TABLE_NAME || '';
  return {
    name,
    readable: DATABASE_READ_ALLOWED_TABLES.has(name),
    writable: DATABASE_WRITE_ALLOWED_TABLES.has(name),
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

export async function loadTableMetadata(db, requestedTable) {
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
  const [indexRows, foreignKeyRows] = await Promise.all([
    db.all(`SELECT index_name,column_name,seq_in_index,non_unique,sub_part
      FROM information_schema.statistics
      WHERE table_schema=DATABASE() AND table_name=?
      ORDER BY index_name ASC,seq_in_index ASC`, [tableName]),
    db.all(`SELECT column_name,referenced_table_name,referenced_column_name,constraint_name
      FROM information_schema.key_column_usage
      WHERE table_schema=DATABASE() AND table_name=? AND referenced_table_name IS NOT NULL
      ORDER BY constraint_name ASC,ordinal_position ASC`, [tableName]),
  ]);
  const columns = columnRows.map(publicColumn);
  if (!columns.length) throw requestError('数据表没有可读取字段', 404);
  const primaryColumns = columns.filter((column) => column.primaryKey);
  const uniqueKeyMap = new Map();
  for (const row of indexRows || []) {
    if (Number(row.non_unique ?? row.NON_UNIQUE) !== 0) continue;
    const indexName = row.index_name || row.INDEX_NAME || '';
    if (!uniqueKeyMap.has(indexName)) uniqueKeyMap.set(indexName, []);
    uniqueKeyMap.get(indexName).push({
      field: row.column_name || row.COLUMN_NAME || '',
      prefixLength: Number(row.sub_part ?? row.SUB_PART) || null,
    });
  }
  return {
    table: publicTable(table),
    tableName,
    columns,
    primaryColumns,
    uniqueKeys: [...uniqueKeyMap.entries()].map(([name, parts]) => ({
      name,
      fields: parts.map((part) => part.field).filter(Boolean),
      parts: parts.filter((part) => part.field),
    })),
    foreignKeys: (foreignKeyRows || []).map((row) => ({
      field: row.column_name || row.COLUMN_NAME || '',
      referencedTable: row.referenced_table_name || row.REFERENCED_TABLE_NAME || '',
      referencedField: row.referenced_column_name || row.REFERENCED_COLUMN_NAME || '',
      constraintName: row.constraint_name || row.CONSTRAINT_NAME || '',
    })),
  };
}

function requireDatabaseOperator(actor) {
  if (!isSuperAdministrator(actor)) throw requestError('只有超级管理员可以直接操作数据库', 403);
}

export function requireWritableDatabaseTable(meta) {
  if (!DATABASE_WRITE_ALLOWED_TABLES.has(meta.tableName)) {
    throw requestError('该表不允许通过数据库工作台写入，请使用对应的领域管理接口', 403);
  }
}

function requireReadableDatabaseTable(meta) {
  if (!DATABASE_READ_ALLOWED_TABLES.has(meta.tableName)) {
    throw requestError('该表包含账号、私密业务数据或控制配置，请使用对应的领域管理接口', 403);
  }
}

function requireDeletableDatabaseTable(meta) {
  if (!DATABASE_DELETE_ALLOWED_TABLES.has(meta.tableName)) {
    throw requestError('该表不允许通过数据库工作台硬删除，请使用归档或领域管理接口', 403);
  }
}

function primaryKey(meta) {
  if (meta.primaryColumns.length !== 1) {
    throw requestError('该表不是单字段主键，请通过领域接口或导入流程维护', 400);
  }
  return meta.primaryColumns[0];
}

export function redactDatabaseRow(row, columns) {
  const sensitive = new Set(columns.filter((column) => column.sensitive).map((column) => column.name));
  const jsonColumns = new Set(columns.filter((column) => column.dataType === 'json').map((column) => column.name));
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [
    key,
    sensitive.has(key) && value !== null && value !== undefined && value !== ''
      ? '[redacted]'
      : jsonColumns.has(key)
        ? safeAuditSnapshot((() => {
          if (typeof value !== 'string') return value;
          try { return JSON.parse(value); } catch { return value; }
        })())
        : value,
  ]));
}

function exportableColumns(columns) {
  return columns.filter((column) => !column.sensitive);
}

function columnMap(meta) {
  return new Map(meta.columns.map((column) => [column.name, column]));
}

function normalizeInteger(value, column) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw requestError(`${column.name} 超出安全整数范围`);
  const text = String(value).trim();
  if (!/^[+-]?\d+$/u.test(text)) throw requestError(`${column.name} 必须是整数`);
  const integer = BigInt(text);
  const unsigned = /\bunsigned\b/iu.test(column.columnType || '');
  const bits = { tinyint: 8n, smallint: 16n, mediumint: 24n, int: 32n, integer: 32n, bigint: 64n }[column.dataType];
  const minimum = unsigned ? 0n : -(2n ** (bits - 1n));
  const maximum = unsigned ? (2n ** bits) - 1n : (2n ** (bits - 1n)) - 1n;
  if (integer < minimum || integer > maximum) throw requestError(`${column.name} 超出 ${column.columnType || column.dataType} 范围`);
  return column.dataType === 'bigint' ? integer.toString() : Number(integer);
}

function normalizeDecimal(value, column) {
  const text = String(value).trim();
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?$/u);
  if (!match) throw requestError(`${column.name} 必须是十进制定点数`);
  const integerDigits = match[2].replace(/^0+(?=\d)/u, '');
  const fractionDigits = match[3] || '';
  const precision = Number(column.numericPrecision);
  const scale = Number(column.numericScale || 0);
  if (Number.isFinite(precision) && precision > 0
    && (integerDigits.length > precision - scale || fractionDigits.length > scale)) {
    throw requestError(`${column.name} 超出 DECIMAL(${precision},${scale}) 精度`);
  }
  const sign = match[1] === '-' && /[1-9]/u.test(`${integerDigits}${fractionDigits}`) ? '-' : '';
  return `${sign}${integerDigits}${fractionDigits ? `.${fractionDigits}` : ''}`;
}

function normalizeDateValue(value, column) {
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?)?$/u);
  if (!match || (column.dataType !== 'date' && match[4] === undefined) || (column.dataType === 'date' && match[4] !== undefined)) {
    throw requestError(`${column.name} 日期格式不正确`);
  }
  const [, yearText, monthText, dayText, hourText = '00', minuteText = '00', secondText = '00'] = match;
  const fraction = match[7] || '';
  const declaredFraction = Number(String(column.columnType || '').match(/\((\d+)\)/u)?.[1] || 0);
  if (fraction.length > declaredFraction) throw requestError(`${column.name} 的小数秒精度不能超过 ${declaredFraction} 位`);
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    throw requestError(`${column.name} 不是有效日历日期`);
  }
  return column.dataType === 'date' ? `${yearText}-${monthText}-${dayText}` : text.replace('T', ' ');
}

function normalizeCellValue(value, column) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' && column.nullable) return null;
    if (trimmed === '' && NUMBER_TYPES.has(column.dataType)) {
      throw requestError(`${column.name} 不能为空`);
    }
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
  if (DATE_TYPES.has(column.dataType)) return normalizeDateValue(value, column);
  if (NUMBER_TYPES.has(column.dataType)) {
    if (value === '' && column.nullable) return null;
    if (column.columnType === 'tinyint(1)' || BOOLEAN_COLUMN.test(column.name)) {
      if (typeof value === 'boolean') return value ? 1 : 0;
      const text = String(value).trim().toLowerCase();
      if (['true', 'yes', 'y'].includes(text)) return 1;
      if (['false', 'no', 'n'].includes(text)) return 0;
      if (text === '1' || text === '0') return Number(text);
      throw requestError(`${column.name} 必须是布尔值或 0/1`);
    }
    if (INTEGER_TYPES.has(column.dataType)) return normalizeInteger(value, column);
    if (column.dataType === 'decimal') return normalizeDecimal(value, column);
    const number = Number(value);
    if (!Number.isFinite(number)) throw requestError(`${column.name} 必须是数字`);
    return number;
  }
  if (typeof value === 'object') value = JSON.stringify(value);
  if (column.maxLength && [...String(value)].length > column.maxLength) {
    throw requestError(`${column.name} 不能超过 ${column.maxLength} 个字符`);
  }
  return value;
}

function writableColumns(meta, { importMode = false, allowSystemManaged = false } = {}) {
  const blocked = !DATABASE_WRITE_ALLOWED_TABLES.has(meta.tableName);
  return meta.columns.filter((column) => !blocked && !column.sensitive
    && (allowSystemManaged || !SERVER_MANAGED_COLUMNS.has(column.name))
    && (!column.autoIncrement || (importMode && column.primaryKey))
    && (importMode || !column.primaryKey));
}

export function normalizeDatabaseRow(row, meta, { requireValue = true, importMode = false, allowSystemManaged = false } = {}) {
  const input = ensurePlainObject(row, 'row');
  const known = columnMap(meta);
  const allowed = new Map(writableColumns(meta, { importMode, allowSystemManaged }).map((column) => [column.name, column]));
  const normalized = {};
  for (const [key, value] of Object.entries(input)) {
    if (!known.has(key)) throw requestError(`字段 ${key} 不存在于表 ${meta.tableName}`);
    if (!allowed.has(key)) throw requestError(`字段 ${key} 不允许通过数据库工作台写入`);
    const normalizedValue = normalizeCellValue(value, allowed.get(key));
    if (normalizedValue !== undefined) normalized[key] = normalizedValue;
  }
  if (String(normalized.verification_status || '').toLowerCase() === 'verified') {
    throw requestError('通用工作台不能将资料直接标记为 verified，请通过带来源核验的领域流程处理');
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
  // Prevent spreadsheet programs from interpreting exported user-controlled
  // text as a formula when an operator opens CSV/TXT files.
  const raw = String(value);
  const text = /^[=+\-@]/u.test(raw) ? `'${raw}` : raw;
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
  if (quoted) throw requestError('导入文件包含未闭合的引号');
  if (row.some((value) => value !== '') || rows.length) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || '').trim());
  if (!headers.length || headers.some((header) => !header)) throw requestError('导入文件缺少表头');
  if (new Set(headers).size !== headers.length) throw requestError('导入文件包含重复表头');
  return rows.slice(1)
    .filter((values) => values.some((value) => String(value || '').trim() !== ''))
    .map((values) => {
      if (values.length > headers.length && values.slice(headers.length).some((value) => String(value || '').trim())) {
        throw requestError('导入文件的数据列数超过表头列数');
      }
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    });
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
    return sqliteObjects(database, `SELECT * FROM ${quoteIdentifier(sourceName).replaceAll('`', '"')} LIMIT ${MAX_IMPORT_ROWS + 1}`);
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
  if (format === 'json') {
    let parsed;
    try { parsed = JSON.parse(content); } catch { throw requestError('JSON 文件格式不正确'); }
    const rows = Array.isArray(parsed) ? parsed : parsed?.data;
    if (!Array.isArray(rows)) throw requestError('JSON 文件必须是数组，或包含 data 数组');
    return rows;
  }
  if (format === 'sql') return parseSqlImport(content, tableName);
  if (format === 'xlsx') {
    const workbook = XLSX.read(content, { type: 'buffer', raw: false, cellDates: false, sheetRows: MAX_IMPORT_ROWS + 2 });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw requestError('XLSX 文件没有工作表');
    return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '', raw: false });
  }
  if (format === 'db') return parseDbImport(content, tableName, body.sourceTable);
  throw requestError('不支持的导入格式');
}

export async function normalizeImportRows(body, format, meta) {
  const rows = await rowsFromImportBody(body, format, meta.tableName);
  if (!Array.isArray(rows) || rows.length === 0) throw requestError('导入文件没有数据行');
  if (rows.length > MAX_IMPORT_ROWS) throw requestError(`单次最多导入 ${MAX_IMPORT_ROWS} 行`);
  return rows.map((row) => normalizeDatabaseRow(row, meta, { importMode: true }));
}

export async function insertRows(tx, meta, rows, mode, { existingRows = [] } = {}) {
  const primaryNames = new Set(meta.primaryColumns.map((column) => column.name));
  const results = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const fields = Object.keys(row);
    if (!fields.length) continue;
    const values = fields.map((field) => row[field]);
    const existing = mode === 'upsert' ? existingRows[rowIndex] : null;
    if (existing) {
      if (meta.primaryColumns.length !== 1) throw requestError('现有记录不是单字段主键，不能安全更新', 409);
      const primary = meta.primaryColumns[0];
      const updateFields = fields.filter((field) => !primaryNames.has(field));
      if (!updateFields.length) throw requestError('没有可更新字段', 409);
      const result = await tx.execute(
        `UPDATE ${quoteIdentifier(meta.tableName)} SET ${updateFields.map((field) => `${quoteIdentifier(field)}=?`).join(',')} WHERE ${quoteIdentifier(primary.name)}=?`,
        [...updateFields.map((field) => row[field]), existing[primary.name]],
      );
      const after = await tx.one(`SELECT * FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(primary.name)}=?`, [existing[primary.name]]);
      results.push({ ...result, entityId: existing[primary.name], before: existing, after });
      continue;
    }
    const insertSql = `INSERT INTO ${quoteIdentifier(meta.tableName)} (${fields.map(quoteIdentifier).join(',')}) VALUES (${fields.map(() => '?').join(',')})`;
    const result = await tx.execute(insertSql, values);
    const primary = meta.primaryColumns.length === 1 ? meta.primaryColumns[0] : null;
    const entityId = primary ? (row[primary.name] ?? result.insertId) : null;
    const after = primary && entityId
      ? await tx.one(`SELECT * FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(primary.name)}=?`, [entityId])
      : null;
    results.push({ ...result, entityId: entityId || null, before: null, after });
  }
  return results;
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
      value[key] === undefined ? [] : [[key, stableJsonValue(value[key])]]
    )));
  }
  return value;
}

export function checksumRows(rows) {
  return createHash('sha256').update(JSON.stringify(stableJsonValue(rows))).digest('hex');
}

async function writeDatabaseCatalogChange(tx, {
  meta, actorUserId, operation, entityId, before = null, after = null,
}) {
  const safeBefore = before ? redactDatabaseRow(before, meta.columns) : null;
  const safeAfter = after ? redactDatabaseRow(after, meta.columns) : null;
  const fields = [...new Set([...Object.keys(safeBefore || {}), ...Object.keys(safeAfter || {})])]
    .filter((field) => JSON.stringify(safeBefore?.[field]) !== JSON.stringify(safeAfter?.[field]));
  await tx.execute(`INSERT INTO catalog_change_log(
    entity_type,entity_id,operation,changed_fields_json,before_json,after_json,source_document_id,actor_user_id
  ) VALUES(?,?,?,?,?,?,?,?)`, [
    meta.tableName,
    String(entityId ?? 'unknown').slice(0, 128),
    operation,
    JSON.stringify(fields),
    safeBefore ? JSON.stringify(safeBefore) : null,
    safeAfter ? JSON.stringify(safeAfter) : null,
    safeAfter?.source_document_id ?? safeBefore?.source_document_id ?? null,
    actorUserId,
  ]);
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
      requireReadableDatabaseTable(meta);
      return res.json({
        table: meta.table,
        primaryKey: meta.primaryColumns.map((column) => column.name),
        writeBlocked: !DATABASE_WRITE_ALLOWED_TABLES.has(meta.tableName),
        columns: meta.columns.map((column) => ({
          ...column,
          writable: DATABASE_WRITE_ALLOWED_TABLES.has(meta.tableName)
            && !column.sensitive && !column.autoIncrement && !column.primaryKey
            && !SERVER_MANAGED_COLUMNS.has(column.name),
        })),
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
      requireReadableDatabaseTable(meta);
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
        data: rows.map((row) => redactDatabaseRow(row, meta.columns)),
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
      requireWritableDatabaseTable(meta);
      const row = normalizeDatabaseRow(req.body?.row || req.body, meta, { importMode: false });
      const created = await db.transaction(async (tx) => {
        const fields = Object.keys(row);
        const result = await tx.execute(
          `INSERT INTO ${quoteIdentifier(meta.tableName)} (${fields.map(quoteIdentifier).join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
          fields.map((field) => row[field]),
        );
        const pk = meta.primaryColumns.length === 1 ? meta.primaryColumns[0] : null;
        const id = pk && (row[pk.name] ?? result.insertId);
        const after = id ? await tx.one(`SELECT * FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(pk.name)}=?`, [id]) : null;
        await writeDatabaseCatalogChange(tx, {
          meta, actorUserId: actor.id, operation: 'create', entityId: id ?? result.insertId, after: after || row,
        });
        await writeAdminAudit(tx, {
          actorUserId: actor.id,
          action: 'database.row.create',
          resourceType: 'database_table',
          resourceId: meta.tableName,
          after: after ? redactDatabaseRow(after, meta.columns) : safeAuditSnapshot(row),
          metadata: { ...requestAuditMetadata(req), table: meta.tableName, columns: fields },
        });
        return { result, after };
      });
      return res.status(201).json({ affectedRows: toNumber(created.result.affectedRows, 1), data: created.after ? redactDatabaseRow(created.after, meta.columns) : null });
    } catch (error) { return next(error); }
  });

  router.patch('/database/tables/:table/rows/:id', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireDatabaseOperator(actor);
      const meta = await loadTableMetadata(db, req.params.table);
      requireWritableDatabaseTable(meta);
      const pk = primaryKey(meta);
      const patch = normalizeDatabaseRow(req.body?.row || req.body, meta, { importMode: false });
      const updated = await db.transaction(async (tx) => {
        const before = await tx.one(`SELECT * FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(pk.name)}=? FOR UPDATE`, [req.params.id]);
        if (!before) throw requestError('记录不存在', 404);
        const fields = Object.keys(patch);
        const result = await tx.execute(
          `UPDATE ${quoteIdentifier(meta.tableName)} SET ${fields.map((field) => `${quoteIdentifier(field)}=?`).join(',')} WHERE ${quoteIdentifier(pk.name)}=?`,
          [...fields.map((field) => patch[field]), req.params.id],
        );
        const after = await tx.one(`SELECT * FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(pk.name)}=?`, [req.params.id]);
        await writeDatabaseCatalogChange(tx, {
          meta, actorUserId: actor.id, operation: 'update', entityId: req.params.id, before, after,
        });
        await writeAdminAudit(tx, {
          actorUserId: actor.id,
          action: 'database.row.update',
          resourceType: 'database_table',
          resourceId: meta.tableName,
          before: redactDatabaseRow(before, meta.columns),
          after: redactDatabaseRow(after, meta.columns),
          metadata: { ...requestAuditMetadata(req), table: meta.tableName, primaryKey: pk.name, id: String(req.params.id), columns: fields },
        });
        return { result, after };
      });
      return res.json({ affectedRows: toNumber(updated.result.affectedRows), data: redactDatabaseRow(updated.after, meta.columns) });
    } catch (error) { return next(error); }
  });

  router.delete('/database/tables/:table/rows/:id', async (req, res, next) => {
    try {
      const db = await database();
      const actor = await authenticate(req, res, db);
      if (!actor) return;
      requireDatabaseOperator(actor);
      const meta = await loadTableMetadata(db, req.params.table);
      requireWritableDatabaseTable(meta);
      requireDeletableDatabaseTable(meta);
      const pk = primaryKey(meta);
      const deleted = await db.transaction(async (tx) => {
        const before = await tx.one(`SELECT * FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(pk.name)}=? FOR UPDATE`, [req.params.id]);
        if (!before) throw requestError('记录不存在', 404);
        const result = await tx.execute(`DELETE FROM ${quoteIdentifier(meta.tableName)} WHERE ${quoteIdentifier(pk.name)}=?`, [req.params.id]);
        await writeDatabaseCatalogChange(tx, {
          meta, actorUserId: actor.id, operation: 'delete', entityId: req.params.id, before,
        });
        await writeAdminAudit(tx, {
          actorUserId: actor.id,
          action: 'database.row.delete',
          resourceType: 'database_table',
          resourceId: meta.tableName,
          before: redactDatabaseRow(before, meta.columns),
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
      requireReadableDatabaseTable(meta);
      const format = parseFormat(req.query.format || 'csv', EXPORT_FORMATS);
      const limit = parseLimit(req.query);
      const keyword = parseOptionalText(req.query.keyword, 'keyword', 100);
      const rows = (await selectRows(db, meta, {
        keyword,
        limit,
        offset: 0,
        orderBy: parseOptionalText(req.query.orderBy, 'orderBy', 64),
        orderDir: parseOptionalText(req.query.orderDir, 'orderDir', 8),
      })).map((row) => redactDatabaseRow(row, meta.columns));
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
      requireWritableDatabaseTable(meta);
      const format = parseFormat(req.body?.format, IMPORT_FORMATS);
      const dryRun = parseBoolean(req.body?.dryRun, true);
      if (!dryRun) {
        throw requestError('直接导入已关闭，请在数据库管理 Agent 中审核并确认后写入', 409);
      }
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
        preview: rows.slice(0, 10).map((row) => redactDatabaseRow(row, meta.columns)),
        review: {
          agentType: DATABASE_MANAGER_AGENT_TYPE,
          displayName: '数据库管理 Agent',
          status: 'preview_only',
          modelReady: Boolean(process.env.LLM_API_KEY),
          capabilities: ['import_review', 'duplicate_detection', 'field_anomaly_check', 'referential_consistency_check', 'repair_plan'],
          requiresHumanConfirmation: true,
          note: '此接口只提供兼容预览。请进入数据库管理 Agent 创建持久化审核任务，确认校验和后再写入。',
        },
      };
      return res.json(summary);
    } catch (error) { return next(error); }
  });

  return router;
}

export default createAdminDatabaseRouter();
