#!/usr/bin/env node
/**
 * 将现有 sql.js / SQLite 数据库安全导入 MySQL。
 *
 * 这个脚本只负责一次性数据迁移，不会改变 API 运行时使用的数据库实现。
 * MySQL 表结构必须已由 `db:migrate:mysql` 创建。
 *
 * 示例：
 *   MYSQL_HOST=127.0.0.1 MYSQL_DATABASE=kaoyan MYSQL_USER=kaoyan \
 *   MYSQL_PASSWORD=... node scripts/import-sqljs-to-mysql.js \
 *   --source ./data/kaoyan.db --apply
 *
 * 默认是 dry-run；只有明确传入 --apply 才会写入 MySQL。
 */

import 'dotenv/config';

import initSqlJs from 'sql.js';
import mysql from 'mysql2/promise';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const SQLITE_SYSTEM_TABLE = /^(sqlite_|schema_migrations$)/i;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MYSQL_DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);
const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1_000;

// 已发布 SQLite 版本的 uni_details 没有这三个 MySQL 扩展列。导入时使用安全的
// 空值占位，随后由 MySQL seed 从 src/data 的完整资料补充真实内容。
const LEGACY_COLUMN_DEFAULTS = Object.freeze({
  uni_details: Object.freeze({
    pros_json: '[]',
    cons_json: '[]',
    features: '',
  }),
});

function usage() {
  return `
用法：
  pnpm --dir server db:import:mysql -- --source /path/to/kaoyan.db [--apply]

必要配置（二选一）：
  MYSQL_URL=mysql://user:password@host:3306/database
  或 MYSQL_HOST、MYSQL_PORT（默认 3306）、MYSQL_DATABASE、MYSQL_USER、MYSQL_PASSWORD

源数据库：
  --source <path>                 必填；也可使用 SQLJS_IMPORT_SOURCE 环境变量。
  KAOYAN_DB_PATH                  仅为兼容旧部署的后备环境变量，不建议新部署使用。

安全选项：
  --apply                         真正写入 MySQL；省略时只做预检，不写任何数据。
  --replace                       先清空本次源库包含的目标表，再完整导入。
  --confirm-replace               与 --replace 同时使用，防止误清空。
  --batch-size <1-${MAX_BATCH_SIZE}>  每批写入行数，默认 ${DEFAULT_BATCH_SIZE}。
  --help                          显示本帮助。

说明：
  - 导入前请先运行 MySQL schema migration；脚本不会把 SQLite 的 schema_migrations
    当作 MySQL migration 状态导入。
  - 默认使用保留原主键 ID 的 upsert，可重复执行。若发现同一唯一键对应不同 ID，
    会中止，避免破坏外键关联。
  - MySQL JSON 字段会严格校验；非法 JSON 会中止而不会静默丢失数据。
  - 旧版 uni_details 缺少的 pros_json、cons_json、features 会临时写入 []、[]、''；
    随后应运行 MySQL seed，用 src/data 中的完整资料补齐。
`;
}

function fail(message) {
  throw new Error(message);
}

function assertIdentifier(value, label = '标识符') {
  if (!IDENTIFIER.test(value)) fail(`${label}不合法：${String(value)}`);
  return value;
}

function quoteIdentifier(value) {
  return `\`${assertIdentifier(value)}\``;
}

function quoteSqliteIdentifier(value) {
  return `"${assertIdentifier(value)}"`;
}

function parseArgs(argv) {
  const options = {
    source: null,
    apply: false,
    replace: false,
    confirmReplace: false,
    batchSize: DEFAULT_BATCH_SIZE,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = (name) => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) fail(`${name} 需要一个值`);
      index += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--replace') options.replace = true;
    else if (arg === '--confirm-replace') options.confirmReplace = true;
    else if (arg === '--source') options.source = nextValue('--source');
    else if (arg.startsWith('--source=')) options.source = arg.slice('--source='.length);
    else if (arg === '--batch-size') options.batchSize = Number(nextValue('--batch-size'));
    else if (arg.startsWith('--batch-size=')) options.batchSize = Number(arg.slice('--batch-size='.length));
    else fail(`未知参数：${arg}\n${usage()}`);
  }

  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > MAX_BATCH_SIZE) {
    fail(`--batch-size 必须是 1 到 ${MAX_BATCH_SIZE} 的整数`);
  }
  if (options.replace && !options.confirmReplace) {
    fail('使用 --replace 前必须同时传入 --confirm-replace，防止误清空 MySQL 数据');
  }
  if (options.replace && !options.apply) {
    fail('--replace 只能与 --apply 一起使用');
  }
  return options;
}

function resolveSourcePath(options) {
  const requested = options.source || process.env.SQLJS_IMPORT_SOURCE || process.env.KAOYAN_DB_PATH;
  if (!requested) {
    fail('未指定源数据库。请传入 --source /path/to/kaoyan.db 或设置 SQLJS_IMPORT_SOURCE');
  }
  const sourcePath = resolve(requested);
  if (!existsSync(sourcePath)) fail(`找不到 sql.js 源数据库：${sourcePath}`);
  return sourcePath;
}

function makeMysqlConnection() {
  if (process.env.MYSQL_URL) return mysql.createConnection(process.env.MYSQL_URL);

  const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];
  const missing = required.filter((name) => process.env[name] === undefined || process.env[name] === '');
  if (missing.length) {
    fail(`缺少 MySQL 连接配置：${missing.join(', ')}（或设置 MYSQL_URL）`);
  }

  const port = Number(process.env.MYSQL_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('MYSQL_PORT 必须是 1 到 65535 的整数');

  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    // 当前 SQLite ID 均在 JS 安全整数范围内；保持数值类型可以稳定比较旧/新主键。
    // 超出安全范围时 mysql2 仍会以 string 返回，导入会保守地报出唯一键冲突而非误关联。
    bigNumberStrings: false,
  });
}

function sqliteRows(raw, sql) {
  const statement = raw.prepare(sql);
  const rows = [];
  try {
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function sourceTables(raw) {
  return sqliteRows(raw, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .map((row) => row.name)
    .filter((name) => !SQLITE_SYSTEM_TABLE.test(name))
    .map((name) => assertIdentifier(name, 'SQLite 表名'));
}

function sourceColumns(raw, table) {
  return sqliteRows(raw, `PRAGMA table_info(${quoteSqliteIdentifier(table)})`)
    .map((row) => ({
      name: assertIdentifier(row.name, `${table} 列名`),
      type: String(row.type || '').toLowerCase(),
      notNull: Number(row.notnull) === 1,
      primaryKeyOrder: Number(row.pk || 0),
    }));
}

function sourceKeyDefinitions(raw, table, columns) {
  const primaryKey = columns
    .filter((column) => column.primaryKeyOrder > 0)
    .sort((left, right) => left.primaryKeyOrder - right.primaryKeyOrder)
    .map((column) => column.name);
  if (!primaryKey.length) fail(`源表 ${table} 没有主键，拒绝导入以避免无法安全重跑`);

  const uniqueKeys = [primaryKey];
  const indexes = sqliteRows(raw, `PRAGMA index_list(${quoteSqliteIdentifier(table)})`);
  for (const index of indexes) {
    if (Number(index.unique) !== 1) continue;
    const indexName = assertIdentifier(index.name, `${table} 索引名`);
    const fields = sqliteRows(raw, `PRAGMA index_info(${quoteSqliteIdentifier(indexName)})`)
      .sort((left, right) => Number(left.seqno) - Number(right.seqno))
      .map((row) => assertIdentifier(row.name, `${table} 唯一索引列名`));
    if (!fields.length) continue;
    if (!uniqueKeys.some((known) => known.length === fields.length && known.every((field, i) => field === fields[i]))) {
      uniqueKeys.push(fields);
    }
  }
  return { primaryKey, uniqueKeys };
}

function sourceDependencies(raw, table, knownTables) {
  const known = new Set(knownTables);
  return sqliteRows(raw, `PRAGMA foreign_key_list(${quoteSqliteIdentifier(table)})`)
    .map((row) => row.table)
    .filter((parent) => known.has(parent));
}

function sortTablesByDependencies(raw, tables) {
  const dependencies = new Map(tables.map((table) => [table, new Set(sourceDependencies(raw, table, tables))]));
  const order = [];
  const remaining = new Set(tables);

  while (remaining.size) {
    const ready = [...remaining]
      .filter((table) => [...dependencies.get(table)].every((parent) => !remaining.has(parent)))
      .sort((left, right) => left.localeCompare(right));
    if (!ready.length) fail(`无法按外键排序源表，存在循环依赖：${[...remaining].join(', ')}`);
    for (const table of ready) {
      order.push(table);
      remaining.delete(table);
    }
  }
  return order;
}

async function mysqlTargetColumns(connection, tables) {
  if (!tables.length) return new Map();
  const placeholders = tables.map(() => '?').join(',');
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, ORDINAL_POSITION
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    tables,
  );

  const result = new Map(tables.map((table) => [table, new Map()]));
  for (const row of rows) {
    if (result.has(row.TABLE_NAME)) {
      result.get(row.TABLE_NAME).set(row.COLUMN_NAME, {
        name: row.COLUMN_NAME,
        dataType: String(row.DATA_TYPE || '').toLowerCase(),
        nullable: row.IS_NULLABLE === 'YES',
        defaultValue: row.COLUMN_DEFAULT,
        extra: String(row.EXTRA || '').toLowerCase(),
      });
    }
  }
  return result;
}

async function mysqlTargetUniqueKeys(connection, tables) {
  if (!tables.length) return new Map();
  const placeholders = tables.map(() => '?').join(',');
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    tables,
  );

  const indexes = new Map(tables.map((table) => [table, new Map()]));
  for (const row of rows) {
    if (Number(row.NON_UNIQUE) !== 0) continue;
    const byName = indexes.get(row.TABLE_NAME);
    if (!byName.has(row.INDEX_NAME)) byName.set(row.INDEX_NAME, []);
    byName.get(row.INDEX_NAME).push(assertIdentifier(row.COLUMN_NAME, `${row.TABLE_NAME} MySQL 唯一索引列名`));
  }

  return new Map([...indexes].map(([table, byName]) => [table, {
    primaryKey: byName.get('PRIMARY') || [],
    uniqueKeys: [...byName.values()],
  }]));
}

function stableValue(value) {
  if (value === null || value === undefined) return 'null';
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `bin:${Buffer.from(value).toString('base64')}`;
  return `${typeof value}:${String(value)}`;
}

function uniqueKeyValue(row, fields) {
  const values = fields.map((field) => row[field]);
  // SQL 的 UNIQUE 对 NULL 不视为相等，不能以 NULL 作为冲突判断依据。
  if (values.some((value) => value === null || value === undefined)) return null;
  return values.map(stableValue).join('\u001f');
}

function primaryKeyValue(row, fields) {
  const value = uniqueKeyValue(row, fields);
  if (value === null) fail(`源记录主键 ${fields.join(', ')} 不能为空`);
  return value;
}

function jsonValue(value, context) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.stringify(JSON.parse(String(value)));
  } catch {
    fail(`${context} 不是有效 JSON，已中止导入以避免丢失或篡改数据`);
  }
}

function dateTimeValue(value, context) {
  if (value === null || value === undefined || value === '') return value;
  const stringValue = String(value).trim();
  // SQLite datetime('now') 的 `YYYY-MM-DD HH:mm:ss` 已是 UTC；保留原样，避免本地时区偏移。
  if (/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)?$/.test(stringValue)) return stringValue;
  const timestamp = Date.parse(stringValue);
  if (Number.isNaN(timestamp)) fail(`${context} 不是有效 UTC 时间：${stringValue}`);
  const date = new Date(timestamp);
  const pad = (number, width = 2) => String(number).padStart(width, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`;
}

function convertValue(value, targetColumn, context) {
  if (value === null || value === undefined) {
    if (!targetColumn.nullable && targetColumn.defaultValue === null && !targetColumn.extra.includes('auto_increment')) {
      fail(`${context} 不能为空，而目标 MySQL 列没有默认值`);
    }
    return value;
  }
  if (targetColumn.dataType === 'json') return jsonValue(value, context);
  if (MYSQL_DATE_TYPES.has(targetColumn.dataType)) return dateTimeValue(value, context);
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
  return value;
}

function ensureCompatibleColumns(table, source, targetColumns) {
  if (!targetColumns?.size) {
    fail(`目标 MySQL 缺少表 ${table}。请先执行 db:migrate:mysql，再运行导入脚本`);
  }

  for (const column of source.columns) {
    if (!targetColumns.has(column.name)) {
      fail(`目标 MySQL 表 ${table} 缺少源列 ${column.name}，拒绝静默丢失数据`);
    }
  }

  const compatibilityColumns = [];
  for (const targetColumn of targetColumns.values()) {
    const existsInSource = source.columns.some((column) => column.name === targetColumn.name);
    if (!existsInSource && Object.hasOwn(LEGACY_COLUMN_DEFAULTS[table] || {}, targetColumn.name)) {
      compatibilityColumns.push(targetColumn.name);
      continue;
    }
    const isGenerated = targetColumn.extra.includes('generated');
    const canBeOmitted = targetColumn.nullable || targetColumn.defaultValue !== null || targetColumn.extra.includes('auto_increment') || isGenerated;
    if (!existsInSource && !canBeOmitted) {
      fail(`目标 MySQL 表 ${table} 新增的必填列 ${targetColumn.name} 没有默认值，无法从旧库安全导入`);
    }
  }
  return compatibilityColumns;
}

async function ensureNoIdentityCollision(connection, tablePlan) {
  const { table, primaryKey, uniqueKeys, rows } = tablePlan;
  if (!rows.length) return;

  const identityColumns = [...new Set(uniqueKeys.flat())];
  const selectColumns = identityColumns.map(quoteIdentifier).join(', ');
  const [targetRows] = await connection.query(`SELECT ${selectColumns} FROM ${quoteIdentifier(table)}`);
  if (!targetRows.length) return;

  const targetByUniqueKey = new Map();
  for (const fields of uniqueKeys) {
    const lookup = new Map();
    for (const row of targetRows) {
      const key = uniqueKeyValue(row, fields);
      if (key !== null) lookup.set(key, primaryKeyValue(row, primaryKey));
    }
    targetByUniqueKey.set(fields.join('\u001f'), lookup);
  }

  for (const row of rows) {
    const sourcePrimaryKey = primaryKeyValue(row, primaryKey);
    for (const fields of uniqueKeys) {
      const key = uniqueKeyValue(row, fields);
      if (key === null) continue;
      const matchedTargetPrimaryKey = targetByUniqueKey.get(fields.join('\u001f')).get(key);
      if (matchedTargetPrimaryKey && matchedTargetPrimaryKey !== sourcePrimaryKey) {
        fail(`目标 MySQL 的 ${table} 表存在唯一键冲突（${fields.join(', ')}）：源主键 ${sourcePrimaryKey} 与目标主键 ${matchedTargetPrimaryKey} 不同。请使用空目标库，或先人工处理冲突后再导入`);
      }
    }
  }
}

function sourceRowsForTable(raw, table, sourceColumns, compatibilityColumns, targetColumns) {
  const rows = sqliteRows(raw, `SELECT * FROM ${quoteSqliteIdentifier(table)}`);
  return rows.map((row, rowIndex) => {
    const converted = {};
    for (const column of sourceColumns) {
      converted[column.name] = convertValue(row[column.name], targetColumns.get(column.name), `${table}[${rowIndex}].${column.name}`);
    }
    for (const column of compatibilityColumns) {
      converted[column] = convertValue(LEGACY_COLUMN_DEFAULTS[table][column], targetColumns.get(column), `${table}[${rowIndex}].${column}（旧库兼容占位）`);
    }
    return converted;
  });
}

function makeTablePlan(raw, table, targetColumns, targetKeys) {
  const sourceColumnDefinitions = sourceColumns(raw, table);
  const { primaryKey, uniqueKeys: sourceUniqueKeys } = sourceKeyDefinitions(raw, table, sourceColumnDefinitions);
  const compatibilityColumns = ensureCompatibleColumns(table, { columns: sourceColumnDefinitions }, targetColumns);
  const columns = [...sourceColumnDefinitions.map((column) => column.name), ...compatibilityColumns];
  const targetPrimaryKey = targetKeys?.primaryKey || [];
  if (targetPrimaryKey.length !== primaryKey.length || targetPrimaryKey.some((column, index) => column !== primaryKey[index])) {
    fail(`目标 MySQL 表 ${table} 的主键与 SQLite 源表不一致，无法安全保留 ID`);
  }
  const uniqueKeys = [...sourceUniqueKeys];
  for (const targetUniqueKey of targetKeys?.uniqueKeys || []) {
    if (!targetUniqueKey.every((column) => columns.includes(column))) {
      fail(`目标 MySQL 表 ${table} 的唯一键（${targetUniqueKey.join(', ')}）包含无法从旧库提供的列，拒绝进行不安全 upsert`);
    }
    if (!uniqueKeys.some((known) => known.length === targetUniqueKey.length && known.every((column, index) => column === targetUniqueKey[index]))) {
      uniqueKeys.push(targetUniqueKey);
    }
  }
  const rows = sourceRowsForTable(raw, table, sourceColumnDefinitions, compatibilityColumns, targetColumns);
  return { table, columns, primaryKey, uniqueKeys, rows, targetColumns, compatibilityColumns };
}

async function insertTableRows(connection, tablePlan, batchSize) {
  const { table, columns, primaryKey, rows } = tablePlan;
  if (!rows.length) return;
  const quotedColumns = columns.map(quoteIdentifier).join(', ');
  const updateColumns = columns.filter((column) => !primaryKey.includes(column));
  const updateClause = updateColumns.length
    ? updateColumns.map((column) => `${quoteIdentifier(column)}=VALUES(${quoteIdentifier(column)})`).join(', ')
    : `${quoteIdentifier(primaryKey[0])}=${quoteIdentifier(primaryKey[0])}`;

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const placeholders = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const params = batch.flatMap((row) => columns.map((column) => row[column]));
    await connection.execute(
      `INSERT INTO ${quoteIdentifier(table)} (${quotedColumns}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updateClause}`,
      params,
    );
  }
}

async function clearTables(connection, tablePlans) {
  for (const tablePlan of [...tablePlans].reverse()) {
    await connection.query(`DELETE FROM ${quoteIdentifier(tablePlan.table)}`);
  }
}

async function getTargetCounts(connection, tablePlans) {
  const counts = new Map();
  for (const { table } of tablePlans) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`);
    counts.set(table, Number(rows[0].count));
  }
  return counts;
}

async function adjustAutoIncrement(connection, tablePlans) {
  for (const { table, primaryKey, targetColumns } of tablePlans) {
    if (primaryKey.length !== 1) continue;
    const key = primaryKey[0];
    const targetColumn = targetColumns.get(key);
    if (!targetColumn?.extra.includes('auto_increment')) continue;
    const [rows] = await connection.query(`SELECT COALESCE(MAX(${quoteIdentifier(key)}), 0) + 1 AS next_id FROM ${quoteIdentifier(table)}`);
    const nextId = Number(rows[0].next_id);
    if (!Number.isSafeInteger(nextId) || nextId < 1) continue;
    // DDL 会隐式提交，所以必须在数据事务成功后才执行。AUTO_INCREMENT 只会前进，不会破坏既有 ID。
    await connection.query(`ALTER TABLE ${quoteIdentifier(table)} AUTO_INCREMENT = ${nextId}`);
  }
}

function printPlan(tablePlans, targetCounts) {
  console.log('[Import] 将处理以下表（SQLite schema_migrations 不会导入）：');
  for (const plan of tablePlans) {
    const targetCount = targetCounts?.get(plan.table);
    const targetText = targetCount === undefined ? '' : `，目标现有 ${targetCount}`;
    console.log(`  - ${plan.table}: 源 ${plan.rows.length} 行${targetText}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const sourcePath = resolveSourcePath(options);
  const SQL = await initSqlJs();
  let raw;
  try {
    raw = new SQL.Database(readFileSync(sourcePath));
  } catch (error) {
    fail(`无法读取 sql.js 源数据库 ${sourcePath}：${error.message}`);
  }

  try {
    const foreignKeyProblems = sqliteRows(raw, 'PRAGMA foreign_key_check');
    if (foreignKeyProblems.length) {
      const sample = foreignKeyProblems.slice(0, 5).map((row) => `${row.table}:${row.rowid}→${row.parent}`).join(', ');
      fail(`源数据库存在 ${foreignKeyProblems.length} 个外键问题（${sample}），请先修复源库`);
    }

    const tables = sourceTables(raw);
    if (!tables.length) fail('源数据库中没有可导入的业务表');
    const order = sortTablesByDependencies(raw, tables);
    const connection = await makeMysqlConnection();

    try {
      await connection.query("SET time_zone = '+00:00'");
      const [databaseRows] = await connection.query('SELECT DATABASE() AS database_name');
      if (!databaseRows[0]?.database_name) fail('MySQL 连接未选择 database；请检查 MYSQL_URL 或 MYSQL_DATABASE');

      const targetColumnsByTable = await mysqlTargetColumns(connection, order);
      const targetKeysByTable = await mysqlTargetUniqueKeys(connection, order);
      const tablePlans = order.map((table) => makeTablePlan(raw, table, targetColumnsByTable.get(table), targetKeysByTable.get(table)));
      const targetCounts = await getTargetCounts(connection, tablePlans);
      printPlan(tablePlans, targetCounts);

      for (const tablePlan of tablePlans) await ensureNoIdentityCollision(connection, tablePlan);

      if (!options.apply) {
        console.log('\n[Import] dry-run 预检通过，未写入 MySQL。确认无误后加 --apply 执行导入。');
        return;
      }

      await connection.beginTransaction();
      try {
        if (options.replace) {
          console.log('[Import] 已确认 --replace：正在按外键逆序清空本次导入表...');
          await clearTables(connection, tablePlans);
        }
        for (const tablePlan of tablePlans) {
          await insertTableRows(connection, tablePlan, options.batchSize);
          console.log(`[Import] 已导入 ${tablePlan.table}: ${tablePlan.rows.length} 行`);
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }

      const afterCounts = await getTargetCounts(connection, tablePlans);
      if (options.replace) {
        for (const tablePlan of tablePlans) {
          if (afterCounts.get(tablePlan.table) !== tablePlan.rows.length) {
            fail(`导入后的 ${tablePlan.table} 行数校验失败：期望 ${tablePlan.rows.length}，实际 ${afterCounts.get(tablePlan.table)}。数据已写入，请先保留现场并检查日志`);
          }
        }
      }
      await adjustAutoIncrement(connection, tablePlans);

      console.log('\n[Import] ✅ 导入完成。');
      printPlan(tablePlans, afterCounts);
    } finally {
      await connection.end();
    }
  } finally {
    raw?.close();
  }
}

main().catch((error) => {
  console.error(`\n[Import] 失败：${error.message}`);
  process.exitCode = 1;
});
