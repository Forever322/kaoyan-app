import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = join(__dirname, '..', '..', 'data');
// 支持测试或运维把数据库放到指定位置；未配置时仍兼容原有 server/data/kaoyan.db。
const DB_PATH = process.env.KAOYAN_DB_PATH
    ? resolve(process.env.KAOYAN_DB_PATH)
    : join(DEFAULT_DATA_DIR, 'kaoyan.db');
const DATA_DIR = dirname(DB_PATH);

// 顶层 await：整个模块加载时完成 WASM 初始化，
// 后续所有 getDB() / migrate() 调用都是同步的
const SQL = await initSqlJs();

let _db = null; // { raw, prepare, exec, transaction }

function saveRawDB(raw) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DB_PATH, Buffer.from(raw.export()));
}

function columnNames(db, table) {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function ensureColumn(db, table, name, definition) {
    if (!columnNames(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

const APP_MIGRATIONS = [
    {
        version: '2026-08-09-agent-plan-revision-and-audit',
        up(db) {
            // 老库的 CREATE TABLE IF NOT EXISTS 不会补字段，因此在这里显式升级。
            ensureColumn(db, 'user_admission_plans', 'revision', 'INTEGER NOT NULL DEFAULT 0');
            ensureColumn(db, 'user_study_plans', 'revision', 'INTEGER NOT NULL DEFAULT 0');
            ensureColumn(db, 'agent_proposals', 'base_revision', 'INTEGER NOT NULL DEFAULT 0');
            ensureColumn(db, 'agent_proposals', 'expires_at', 'TEXT');
            ensureColumn(db, 'agent_proposals', 'model', "TEXT NOT NULL DEFAULT ''");
        },
    },
];

function runAppMigrations(db) {
    for (const migration of APP_MIGRATIONS) {
        const applied = db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(migration.version);
        if (applied) continue;
        db.transaction(() => {
            migration.up(db);
            db.prepare('INSERT INTO schema_migrations(version) VALUES(?)').run(migration.version);
        })();
        console.log(`[DB] 已应用迁移 ${migration.version}`);
    }
}

export function getDB() {
    if (!_db) {
        const raw = existsSync(DB_PATH)
            ? new SQL.Database(readFileSync(DB_PATH))
            : new SQL.Database();
        raw.run('PRAGMA foreign_keys = ON');

        _db = {
            raw,
            exec(sql) { raw.run(sql); },
            prepare(sql) {
                // 静态 prepare：每次调用返回全新 stmt + 数据
                // 注意：sql.js prepare 后 stmt 不会随着新 prepare 重置
                return {
                    run(...params) { raw.run(sql, params); return this; },
                    get(...params) {
                        const stmt = raw.prepare(sql);
                        if (params.length) stmt.bind(params);
                        const row = stmt.step() ? stmt.getAsObject() : null;
                        stmt.free();
                        return row;
                    },
                    all(...params) {
                        const stmt = raw.prepare(sql);
                        if (params.length) stmt.bind(params);
                        const rows = [];
                        while (stmt.step()) rows.push(stmt.getAsObject());
                        stmt.free();
                        return rows;
                    },
                };
            },
            transaction(fn) {
                return () => {
                    raw.run('BEGIN');
                    try { fn(); raw.run('COMMIT'); } catch (e) { raw.run('ROLLBACK'); throw e; }
                };
            },
        };
    }
    return _db;
}

export function migrate() {
    const db = getDB();
    const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    db.exec(sql);
    runAppMigrations(db);
    saveRawDB(db.raw);
    console.log('[DB] 迁移完成');
    return db;
}

export function reset() {
    const db = getDB();
    db.exec('DROP TABLE IF EXISTS auth_tokens');
    db.exec('DROP TABLE IF EXISTS agent_runs');
    db.exec('DROP TABLE IF EXISTS agent_proposals');
    db.exec('DROP TABLE IF EXISTS user_study_plans');
    db.exec('DROP TABLE IF EXISTS user_admission_plans');
    db.exec('DROP TABLE IF EXISTS agent_memories');
    db.exec('DROP TABLE IF EXISTS agent_messages');
    db.exec('DROP TABLE IF EXISTS agent_conversations');
    db.exec('DROP TABLE IF EXISTS study_sessions');
    db.exec('DROP TABLE IF EXISTS user_favorites');
    db.exec('DROP TABLE IF EXISTS users');
    db.exec('DROP TABLE IF EXISTS schema_migrations');
    db.exec('DROP TABLE IF EXISTS uni_requirements');
    db.exec('DROP TABLE IF EXISTS admission_scores');
    db.exec('DROP TABLE IF EXISTS uni_photos');
    db.exec('DROP TABLE IF EXISTS uni_details');
    db.exec('DROP TABLE IF EXISTS national_lines');
    db.exec('DROP TABLE IF EXISTS universities');
    saveRawDB(db.raw);
    console.log('[DB] 已清除所有表');
    return migrate();
}

// seed 后手动调用
export function save() {
    if (_db) saveRawDB(_db.raw);
}
