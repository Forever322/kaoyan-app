/**
 * 考研择校助手 - IndexedDB 本地数据库
 * 存储所有院校、专业、录取分数数据
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

/** 获取数据库实例 */
export function getDB() { return db; }

// ==================== 院校操作 ====================

/** 插入/更新院校 */
export function upsertUniversity(uni) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('universities', 'readwrite');
    tx.objectStore('universities').put(uni);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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

/** 获取所有院校 */
export function getAllUniversities() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('universities', 'readonly');
    const req = tx.objectStore('universities').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 按省份筛选院校 */
export function getUniversitiesByProvince(province) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('universities', 'readonly');
    const index = tx.objectStore('universities').index('province');
    const req = index.getAll(province);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 按分区筛选院校 */
export function getUniversitiesByZone(zone) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('universities', 'readonly');
    if (zone === 'all') {
      const req = tx.objectStore('universities').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } else {
      const index = tx.objectStore('universities').index('zone');
      const req = index.getAll(zone);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }
  });
}

/** 搜索院校 */
export function searchUniversities(query) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('universities', 'readonly');
    const req = tx.objectStore('universities').getAll();
    req.onsuccess = () => {
      const q = query.toLowerCase();
      const results = req.result.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.province.toLowerCase().includes(q) ||
        (u.city && u.city.toLowerCase().includes(q))
      ).slice(0, 20);
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

// ==================== 分数操作 ====================

/** 获取某院校某门类的录取分数 */
export function getAdmissionScores(universityName, category, degree, major = null) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readonly');
    const index = tx.objectStore('scores').index('uniCat');
    const lower = [universityName, category, degree, major || ''];
    const upper = [universityName, category, degree, major || '￿'];
    const range = IDBKeyRange.bound(lower, upper);
    const req = index.getAll(range);

    req.onsuccess = () => {
      const rows = req.result;
      if (rows.length === 0 && major) {
        // 回退：查大类（无major限制）
        const req2 = index.getAll(IDBKeyRange.bound(
          [universityName, category, degree, ''],
          [universityName, category, degree, '￿']
        ));
        req2.onsuccess = () => {
          resolve(req2.result.map(r => ({ year: r.year, score: r.score })));
        };
        req2.onerror = () => resolve([]);
        return;
      }
      resolve(rows.map(r => ({ year: r.year, score: r.score })));
    };
    req.onerror = () => reject(req.error);
  });
}

/** 批量查询：获取多个院校在同一门类下的分数 */
export function batchGetAdmissionScores(universityNames, category, degree, major = null) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readonly');
    const store = tx.objectStore('scores');
    const index = store.index('uniCat');
    const results = {};
    let pending = universityNames.length;

    if (pending === 0) { resolve(results); return; }

    universityNames.forEach(name => {
      const lower = [name, category, degree, major || ''];
      const upper = [name, category, degree, major || '￿'];
      const req = index.getAll(IDBKeyRange.bound(lower, upper));

      req.onsuccess = () => {
        if (req.result.length > 0) {
          results[name] = req.result.map(r => ({ year: r.year, score: r.score }));
        }
        pending--;
        if (pending === 0) resolve(results);
      };
      req.onerror = () => { pending--; if (pending === 0) resolve(results); };
    });
  });
}

/** 插入/更新录取分数 */
export function upsertScore(score) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('scores', 'readwrite');
    const store = tx.objectStore('scores');

    // 先查是否已存在（同院校+门类+学位+专业+年份）
    const index = store.index('uniCat');
    const lower = [score.universityName, score.category, score.degree, score.major || ''];
    const upper = [score.universityName, score.category, score.degree, score.major || '￿'];
    const req = index.getAll(IDBKeyRange.bound(lower, upper));

    req.onsuccess = () => {
      const existing = req.result.find(r => r.year === score.year);
      if (existing) {
        existing.score = score.score;
        existing.studyMode = score.studyMode || '全日制';
        store.put(existing);
      } else {
        store.add({ ...score, major: score.major || '' });
      }
      tx.oncomplete = () => resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

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

/** 获取所有分数数据 */
export function getAllScores() {
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

/** 导出全部数据为JSON */
export async function exportDB() {
  const unis = await getAllUniversities();
  const scores = await getAllScores();
  return { universities: unis, scores: scores };
}

/** 清空并导入数据 */
export async function importDB(data) {
  await clearDB();
  if (data.universities && data.universities.length > 0) {
    await bulkInsertUniversities(data.universities);
  }
  if (data.scores && data.scores.length > 0) {
    await bulkInsertScores(data.scores);
  }
}

/** 清空数据库 */
function clearDB() {
  return new Promise((resolve, reject) => {
    const tx1 = db.transaction('universities', 'readwrite');
    tx1.objectStore('universities').clear();
    tx1.oncomplete = () => {
      const tx2 = db.transaction('scores', 'readwrite');
      tx2.objectStore('scores').clear();
      tx2.oncomplete = () => resolve();
      tx2.onerror = () => reject(tx2.error);
    };
    tx1.onerror = () => reject(tx1.error);
  });
}
