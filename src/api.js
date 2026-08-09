// 统一数据访问层 — 支持本地静态数据与云端 API 自动切换
// 策略：优先云端数据库，网络不可用时回退到本地静态数据与 IndexedDB 缓存。
// 生产环境使用同源 /api（由 Nginx 代理）；开发环境可用 VITE_API_BASE 覆盖。
// 仍保留本地数据兜底，便于离线阅读与后端临时不可用时继续使用。

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const USE_REMOTE_API = import.meta.env.VITE_OFFLINE_DATA !== 'true';

// ---------- 内部：IndexedDB 缓存 ----------
function openCache() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('kaoyan-api-cache', 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('cache')) {
                db.createObjectStore('cache', { keyPath: 'key' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function cacheGet(key) {
    const db = await openCache();
    return new Promise((resolve) => {
        const tx = db.transaction('cache', 'readonly');
        const req = tx.objectStore('cache').get(key);
        req.onsuccess = () => resolve(req.result?.value ?? null);
        req.onerror = () => resolve(null);
    });
}

async function cacheSet(key, value, ttlMs = 3600000) {
    const db = await openCache();
    const expires = Date.now() + ttlMs;
    return new Promise((resolve) => {
        const tx = db.transaction('cache', 'readwrite');
        tx.objectStore('cache').put({ key, value, expires });
        tx.oncomplete = () => resolve();
    });
}

// ---------- 核心：双模式数据访问 ----------

/**
 * 获取院校列表
 * @param {Object} filters - { zone, province, level, keyword }
 * @returns {Promise<Array>}
 */
export async function getUniversities(filters = {}) {
    // 1. 尝试云端
    if (USE_REMOTE_API) {
        try {
            const params = new URLSearchParams(filters);
            const res = await fetch(`${API_BASE}/api/universities?${params}`);
            if (res.ok) {
                const { data } = await res.json();
                cacheSet('universities:' + JSON.stringify(filters), data);
                return data;
            }
        } catch { /* fallback */ }
    }

    // 2. 缓存
    const cached = await cacheGet('universities:' + JSON.stringify(filters));
    if (cached) return cached;

    // 3. 本地静态数据
    const { UNIVERSITIES, findUniversity, getUniversitiesByZone } = await import('./data/universities.js');
    if (filters.zone) return getUniversitiesByZone(filters.zone);
    if (filters.keyword) {
        const u = findUniversity(filters.keyword);
        return u ? [u] : [];
    }
    return UNIVERSITIES;
}

/**
 * 获取国家线
 * @param {Object} filters - { year, degree, category, zone }
 * @returns {Promise<Array>}
 */
export async function getNationalLines(filters = {}) {
    if (USE_REMOTE_API) {
        try {
            const params = new URLSearchParams(filters);
            const res = await fetch(`${API_BASE}/api/national-lines?${params}`);
            if (res.ok) {
                const { data } = await res.json();
                return data;
            }
        } catch { /* fallback */ }
    }

    // 本地：使用现有函数
    const { getAllYearLines, getLatestNationalLine, getNationalLine } = await import('./data/national-lines.js');

    if (filters.year && filters.degree && filters.category && filters.zone) {
        return [{ score: getNationalLine(filters.degree, filters.category, filters.zone, filters.year) }];
    }
    if (filters.degree && filters.category && filters.zone) {
        return getAllYearLines(filters.degree, filters.category, filters.zone);
    }
    if (filters.degree && filters.category && filters.zone) {
        return [{ score: getLatestNationalLine(filters.degree, filters.category, filters.zone) }];
    }
    // 返回全部时用原始数据
    const { NATIONAL_LINES } = await import('./data/national-lines.js');
    const result = [];
    for (const [degree, categories] of Object.entries(NATIONAL_LINES)) {
        for (const [category, zones] of Object.entries(categories)) {
            for (const [zone, years] of Object.entries(zones)) {
                for (const [year, score] of Object.entries(years)) {
                    result.push({ year: Number(year), degree, category, zone, score });
                }
            }
        }
    }
    return result;
}

/**
 * 智能匹配
 * @param {Object} params - { score, degree, category, zone }
 * @returns {Promise<Object>}
 */
export async function getMatchResults(params) {
    if (USE_REMOTE_API) {
        try {
            const qs = new URLSearchParams(params);
            const res = await fetch(`${API_BASE}/api/match?${qs}`);
            if (res.ok) return res.json();
        } catch { /* fallback */ }
    }

    // 本地匹配
    const [{ matchUniversities, sortResults }, { getUniversitiesByZone }] = await Promise.all([
        import('./matcher.js'),
        import('./data/universities.js'),
    ]);

    const universities = getUniversitiesByZone(params.zone || 'A');
    const results = matchUniversities(universities, {
        score: Number(params.score),
        degree: params.degree,
        category: params.category,
        zone: params.zone,
    });

    sortResults(results);
    return { total: results.length, data: results };
}

/**
 * 获取院校详情
 */
export async function getUniversityDetail(name) {
    if (USE_REMOTE_API) {
        try {
            const res = await fetch(`${API_BASE}/api/universities?keyword=${encodeURIComponent(name)}`);
            if (res.ok) {
                const { data } = await res.json();
                if (data[0]) {
                    const detailRes = await fetch(`${API_BASE}/api/universities/${data[0].id}`);
                    if (detailRes.ok) return detailRes.json();
                }
            }
        } catch { /* fallback */ }
    }

    const [{ getUniversityDetail: local }, { getUniversityPhotos }, { getRequirements }] = await Promise.all([
        import('./data/uni-details.js'),
        import('./data/uni-photos.js'),
        import('./data/uni-requirements.js'),
    ]);

    return {
        detail: local(name),
        photos: getUniversityPhotos(name),
        requirements: getRequirements(name),
    };
}

// 导出标志：是否连接了后端
export async function isBackendAvailable() {
    if (!USE_REMOTE_API) return false;
    try {
        const res = await fetch(`${API_BASE}/api/health`);
        return res.ok;
    } catch {
        return false;
    }
}
