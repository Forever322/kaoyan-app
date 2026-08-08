import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const DB_PATH = join(DATA_DIR, 'kaoyan.db');

// 顶层 await：整个模块加载时完成 WASM 初始化，
// 后续所有 getDB() / migrate() 调用都是同步的
const SQL = await initSqlJs();

let _db = null; // { raw, prepare, exec, transaction }

function saveRawDB(raw) {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DB_PATH, Buffer.from(raw.export()));
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
    saveRawDB(db.raw);
    console.log('[DB] 迁移完成');
    return db;
}

export function reset() {
    const db = getDB();
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
