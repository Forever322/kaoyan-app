// 院校照片渲染与获取

import { UNI_PHOTOS } from './data/uni-photos.js';
import { escapeHtml } from './utils.js';

/** 渲染院校照片（4张），优先用预存CDN，不足时实时搜索补充 */
export async function renderPhotos(name, color) {
  const container = document.getElementById('detailPhotos');
  container.innerHTML = [1, 2, 3, 4]
    .map(
      () =>
        `<div class="photo-item"><div class="photo-loading" style="background:${color}22;display:flex;align-items:center;justify-content:center;height:100%;color:${color};font-size:2rem">📷</div></div>`,
    )
    .join('');

  let urls;
  if (typeof UNI_PHOTOS !== 'undefined' && UNI_PHOTOS[name]) {
    urls = UNI_PHOTOS[name];
  } else {
    urls = await fetchBaiduPhotos(name);
  }

  container.innerHTML = urls
    .map(
      (url) =>
        `<div class="photo-item"><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.style.display='none'"></div>`,
    )
    .join('');

  // 不够4张用搜索链接补
  while (container.children.length < 4) {
    const d = document.createElement('div');
    d.className = 'photo-item photo-search-link';
    d.style.cssText = `background:${color}22;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:2rem`;
    d.textContent = '🔍';
    const searchUrl = `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent(name + ' 校园')}`;
    d.onclick = () => {
      window.open(searchUrl, '_blank');
    };
    container.appendChild(d);
  }
}

/** 从百度图片搜索API获取真实校园照片（国内CDN，秒开） */
async function fetchBaiduPhotos(name) {
  try {
    const results = [];
    const queries = [name + '校园', name + '大学校门', name + '图书馆', name + '校园风景'];
    for (const q of queries) {
      const apiUrl = `https://image.baidu.com/search/acjson?tn=resultjson_com&word=${encodeURIComponent(q)}&pn=0&rn=3`;
      const resp = await fetch(apiUrl);
      const text = await resp.text();
      const thumbMatches = text.matchAll(/"thumbURL":"(https:[^"]+)"/g);
      for (const m of thumbMatches) {
        const thumbUrl = m[1].replace(/\\\//g, '/');
        if (thumbUrl && !results.includes(thumbUrl)) results.push(thumbUrl);
        if (results.length >= 4) return results;
      }
    }
    return results;
  } catch {
    return [];
  }
}
