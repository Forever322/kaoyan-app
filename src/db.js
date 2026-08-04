/**
 * 考研择校助手 - IndexedDB 本地数据库
 * 仅保留种子化（seed.js）所需的核心操作
 */

const DB_NAME = 'kaoyan_app';
const DB_VERSION = 1;

let db = null;

/** 打开数据库 */
export function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // 院校表
      if (!db.objectStoreNames.contains('universities')) {
        const uniStore = db.createObjectStore('universities', { keyPath: 'name' });
        uniStore.createIndex('province', 'province');
        uniStore.createIndex('zone', 'zone');
        uniStore.createIndex('level', 'level');
        uniStore.createIndex('type', 'type');
      }

      // 录取分数表
      if (!db.objectStoreNames.contains('scores')) {
        const scoreStore = db.createObjectStore('scores', { keyPath: 'id', autoIncrement: true });
        scoreStore.createIndex('uniCat', ['universityName', 'category', 'degree', 'major']);
        scoreStore.createIndex('universityName', 'universityName');
        scoreStore.createIndex('category', 'category');
        scoreStore.createIndex('degree', 'degree');
        scoreStore.createIndex('year', 'year');
      }
    };

    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

// ==================== 院校操作 ====================

/** 批量插入院校 */
export function bulkInsertUniversities(list) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('universities', 'readwrite');
    const store = tx.objectStore('universities');
    list.forEach(uni => store.put(uni));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 获取所有院校（内部使用） */
function getAllUniversities() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('universities', 'readonly');
    const req = tx.objectStore('universities').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ==================== 分数操作 ====================

/** 批量插入分数 */
export function bulkInsertScores(list) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readwrite');
    const store = tx.objectStore('scores');
    list.forEach(s => store.add({ ...s, major: s.major || '' }));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 获取所有分数数据（内部使用） */
function getAllScores() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readonly');
    const req = tx.objectStore('scores').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 获取数据库统计信息 */
export async function getDBStats() {
  const unis = await getAllUniversities();
  const scores = await getAllScores();
  const uniSet = new Set(scores.map(s => s.universityName));
  return {
    totalUniversities: unis.length,
    universitiesWithScores: uniSet.size,
    totalScores: scores.length
  };
}