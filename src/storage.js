// 本地存储管理：自定义院校数据、缓存、导入导出

import { UNIVERSITIES } from './data/universities.js';
import { ADMISSION_SCORES } from './data/admission-scores.js';
import { UNI_REQUIREMENTS } from './data/uni-requirements.js';

const STORAGE_KEYS = {
  CUSTOM_UNIVERSITIES: 'kaoyan_custom_universities',
  CUSTOM_SCORES: 'kaoyan_custom_scores',
  CUSTOM_REQUIREMENTS: 'kaoyan_custom_requirements',
  LAST_SEARCH: 'kaoyan_last_search',
};

/** 获取用户自定义院校列表 */
export function getCustomUniversities() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_UNIVERSITIES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** 保存用户自定义院校 */
function saveCustomUniversities(list) {
  localStorage.setItem(STORAGE_KEYS.CUSTOM_UNIVERSITIES, JSON.stringify(list));
}

/** 添加自定义院校 */
export function addCustomUniversity(uni) {
  const list = getCustomUniversities();
  // 检查是否已存在
  const existing = list.findIndex((u) => u.name === uni.name);
  if (existing >= 0) {
    list[existing] = { ...list[existing], ...uni };
  } else {
    list.push(uni);
  }
  saveCustomUniversities(list);

  // 同时更新内存中的 UNIVERSITIES 和 ADMISSION_SCORES
  const memIdx = UNIVERSITIES.findIndex((u) => u.name === uni.name);
  if (memIdx >= 0) {
    UNIVERSITIES[memIdx] = {
      ...UNIVERSITIES[memIdx],
      name: uni.name,
      province: uni.province,
      city: uni.city || uni.province,
      zone: uni.zone,
      level: uni.level,
    };
  } else {
    UNIVERSITIES.push({
      name: uni.name,
      province: uni.province,
      city: uni.city || uni.province,
      zone: uni.zone,
      level: uni.level,
      type: uni.type || '综合',
    });
  }

  // 保存录取分数
  if (uni.scores) {
    const allScores = getCustomScores();
    allScores[uni.name] = uni.scores;
    saveCustomScores(allScores);
    // 更新内存
    ADMISSION_SCORES[uni.name] = uni.scores;
  }

  return true;
}

/** 删除自定义院校 */
export function removeCustomUniversity(name) {
  let list = getCustomUniversities();
  list = list.filter((u) => u.name !== name);
  saveCustomUniversities(list);

  // 从内存中移除
  const memIdx = UNIVERSITIES.findIndex((u) => u.name === name);
  if (memIdx >= 0) {
    UNIVERSITIES.splice(memIdx, 1);
  }
  delete ADMISSION_SCORES[name];

  // 从自定义分数中移除
  const scores = getCustomScores();
  delete scores[name];
  saveCustomScores(scores);
}

/** 获取用户自定义录取分数 */
function getCustomScores() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_SCORES);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 保存用户自定义录取分数 */
function saveCustomScores(scores) {
  localStorage.setItem(STORAGE_KEYS.CUSTOM_SCORES, JSON.stringify(scores));
}

/** 获取所有院校（内置 + 自定义）的完整列表用于编辑 */
export function getAllUniversitiesForEdit() {
  const builtIn = UNIVERSITIES.map((u) => ({
    ...u,
    isCustom: false,
    scores: ADMISSION_SCORES[u.name] || null,
  }));

  // 标记自定义的
  const customNames = new Set(getCustomUniversities().map((u) => u.name));
  for (const u of builtIn) {
    if (customNames.has(u.name)) u.isCustom = true;
  }

  return builtIn;
}

/** 保存上次搜索条件 */
export function saveLastSearch(params) {
  localStorage.setItem(STORAGE_KEYS.LAST_SEARCH, JSON.stringify(params));
}

/** 获取上次搜索条件 */
export function getLastSearch() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LAST_SEARCH);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 导出全部数据 */
export function exportAllData() {
  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    customUniversities: getCustomUniversities(),
    customScores: getCustomScores(),
    customRequirements: getCustomRequirements(),
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kaoyan-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 导入数据 */
export function importData(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (!data.version) throw new Error('无效的数据格式');

    let importCount = 0;

    // 导入院校
    if (Array.isArray(data.customUniversities)) {
      saveCustomUniversities(data.customUniversities);
      for (const uni of data.customUniversities) {
        const memIdx = UNIVERSITIES.findIndex((u) => u.name === uni.name);
        if (memIdx >= 0) {
          UNIVERSITIES[memIdx] = {
            ...UNIVERSITIES[memIdx],
            name: uni.name,
            province: uni.province,
            city: uni.city || uni.province,
            zone: uni.zone,
            level: uni.level,
            type: uni.type || '综合',
          };
        } else {
          UNIVERSITIES.push({
            name: uni.name,
            province: uni.province,
            city: uni.city || uni.province,
            zone: uni.zone,
            level: uni.level,
            type: uni.type || '综合',
          });
        }
        importCount++;
      }
    }

    // 导入分数
    if (data.customScores && typeof data.customScores === 'object') {
      const existing = getCustomScores();
      const merged = { ...existing, ...data.customScores };
      saveCustomScores(merged);
      Object.assign(ADMISSION_SCORES, data.customScores);
    }

    // 导入硬性要求
    if (data.customRequirements && typeof data.customRequirements === 'object') {
      const existing = getCustomRequirements();
      const merged = { ...existing, ...data.customRequirements };
      saveCustomRequirements(merged);
      for (const [name, req] of Object.entries(data.customRequirements)) {
        if (UNI_REQUIREMENTS[name]) {
          Object.assign(UNI_REQUIREMENTS[name], req);
        } else {
          UNI_REQUIREMENTS[name] = req;
        }
      }
    }

    return { success: true, count: importCount };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** 获取用户自定义硬性要求 */
export function getCustomRequirements() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_REQUIREMENTS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 保存自定义硬性要求 */
function saveCustomRequirements(reqs) {
  localStorage.setItem(STORAGE_KEYS.CUSTOM_REQUIREMENTS, JSON.stringify(reqs));
}

/** 更新某院校硬性要求 */
export function updateCustomRequirements(universityName, reqData) {
  const all = getCustomRequirements();
  all[universityName] = { ...(all[universityName] || {}), ...reqData };
  saveCustomRequirements(all);
  // 同步更新内存
  if (UNI_REQUIREMENTS[universityName]) {
    Object.assign(UNI_REQUIREMENTS[universityName], reqData);
  } else {
    UNI_REQUIREMENTS[universityName] = reqData;
  }
}

/** 初始化: 从 localStorage 加载用户自定义数据到内存 */
export function initStorage() {
  // 加载自定义分数到 ADMISSION_SCORES
  const customScores = getCustomScores();
  for (const [name, scores] of Object.entries(customScores)) {
    ADMISSION_SCORES[name] = scores;
  }

  // 加载自定义院校（如果不在 UNIVERSITIES 中则添加）
  const customUnis = getCustomUniversities();
  for (const uni of customUnis) {
    const exists = UNIVERSITIES.find((u) => u.name === uni.name);
    if (!exists) {
      UNIVERSITIES.push({
        name: uni.name,
        province: uni.province,
        city: uni.city || uni.province,
        zone: uni.zone,
        level: uni.level,
        type: uni.type || '综合',
      });
    }
  }

  // 加载自定义硬性要求到内存
  const customReqs = getCustomRequirements();
  for (const [name, req] of Object.entries(customReqs)) {
    if (UNI_REQUIREMENTS[name]) {
      Object.assign(UNI_REQUIREMENTS[name], req);
    } else {
      UNI_REQUIREMENTS[name] = req;
    }
  }
}
