// 院校照片渲染 - 优先预存CDN，无预存时生成百度图片搜索卡片

import { UNI_PHOTOS } from './data/uni-photos.js';
import { escapeHtml } from './utils.js';

/** 渲染院校照片（4张），优先用预存CDN，不足时显示搜索卡片 */
export function renderPhotos(name, color) {
  const container = document.getElementById('detailPhotos');
  if (!container) return;

  // 先获取预存照片
  let urls = [];
  if (UNI_PHOTOS && UNI_PHOTOS[name]) {
    urls = UNI_PHOTOS[name];
  }

  // 渲染照片
  let html = '';
  const displayUrls = urls.slice(0, 4);

  for (const url of displayUrls) {
    html += `<div class="photo-item">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"
           referrerpolicy="no-referrer"
           onerror="this.parentElement.innerHTML='<div style=\\'background:${color}22;display:flex;align-items:center;justify-content:center;height:100%;font-size:1.5rem\\'>📷</div>'">
    </div>`;
  }

  // 不够4张补搜索卡片
  const searchQueries = [`${name}校园`, `${name}大学`, `${name}校门`, `${name}图书馆`];
  for (let i = displayUrls.length; i < 4; i++) {
    const q = searchQueries[i] || `${name}校园`;
    const searchUrl = `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent(q)}`;
    html += `<div class="photo-item photo-search-link"
                  style="background:${color}22;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:1.8rem"
                  onclick="window.open('${searchUrl}','_blank')" title="搜索：${q}">
               🔍
             </div>`;
  }

  container.innerHTML = html;
}
