// 院校照片渲染 - 优先使用项目内置图集，再按需在线搜索

import { getUniversityPhotos } from './data/uni-photos.js';
import { escapeHtml } from './utils.js';

/** 渲染院校照片（4张），实时从百度图片获取 */
export async function renderPhotos(name, color) {
  const container = document.getElementById('detailPhotos');
  if (!container) return;

  // 加载中占位
  container.innerHTML = [1, 2, 3, 4].map(() =>
    `<div class="photo-item" style="background:${color}22;display:flex;align-items:center;justify-content:center;font-size:1.5rem;aspect-ratio:1.6">📷</div>`
  ).join('');

  // 内置图集覆盖了有预存照片的院校；没有时才使用在线搜索补齐。
  const storedUrls = getUniversityPhotos(name);
  const urls = storedUrls.length > 0 ? storedUrls : await fetchBaiduPhotos(name);

  if (urls.length > 0) {
    container.innerHTML = urls.map(url =>
      `<div class="photo-item">
        <img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"
             referrerpolicy="no-referrer"
             onerror="this.parentElement.style.cssText='background:${color}22;display:flex;align-items:center;justify-content:center;font-size:1.5rem;aspect-ratio:1.6';this.parentElement.innerHTML=\\'📷\\''">
      </div>`
    ).join('');

    // 百度百科 CDN 偶尔会返回 200×200 的“参数错误”占位图；避免把它误当作校园照片。
    container.querySelectorAll('img').forEach((image) => {
      image.addEventListener('load', () => {
        if (image.naturalWidth <= 240 && image.naturalHeight <= 240) {
          showPhotoFallback(image.parentElement, color);
        }
      });
    });
  }

  // 不够4张补搜索卡片
  const searchQueries = [name + '校园', name + '大学校门', name + '图书馆', name + '校园风景'];
  while (container.children.length < 4) {
    const idx = container.children.length;
    const searchUrl = `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent(searchQueries[idx] || name + '校园')}`;
    const card = document.createElement('div');
    card.className = 'photo-item';
    card.style.cssText = `background:${color}22;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:1.8rem;aspect-ratio:1.6`;
    card.textContent = '🔍';
    card.title = '点击搜索更多照片';
    card.onclick = () => window.open(searchUrl, '_blank');
    container.appendChild(card);
  }
}

function showPhotoFallback(item, color) {
  item.replaceChildren();
  item.style.cssText = `background:${color}22;display:flex;align-items:center;justify-content:center;font-size:1.5rem;aspect-ratio:1.6`;
  item.textContent = '📷';
}

/** 从百度图片搜索实时获取照片 */
async function fetchBaiduPhotos(name) {
  const results = [];
  const queries = [name + '校园', name + '大学', name + '校门', name + '图书馆'];
  for (const q of queries) {
    if (results.length >= 4) break;
    try {
      const apiUrl = `https://image.baidu.com/search/acjson?tn=resultjson_com&ipn=rj&ct=201326592&fp=result&word=${encodeURIComponent(q)}&pn=0&rn=5`;
      const resp = await fetch(apiUrl, {
        headers: { 'Referer': 'https://image.baidu.com/' }
      });
      const text = await resp.text();
      // 匹配JSONP中的thumbURL（处理转义斜杠）
      const re = /"thumbURL"\s*:\s*"(https?:\\?\/\\?\/[^"]+)"/g;
      for (const m of text.matchAll(re)) {
        const url = m[1].replace(/\\\//g, '/');
        if (url && url.startsWith('http') && !results.includes(url)) {
          results.push(url);
          if (results.length >= 4) return results;
        }
      }
    } catch { /* skip failed query */ }
  }
  return results;
}
