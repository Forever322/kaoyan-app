/**
 * Service Worker - 考研择校助手
 * 提供离线缓存和PWA能力
 */

const CACHE_NAME = 'kaoyan-app-v6';

// 预缓存的静态资源（Vite 会将 CSS 注入到 JS 中，所以不需要单独缓存 CSS）
const STATIC_ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

// 安装: 预缓存静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] 缓存静态资源');
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] 部分资源缓存失败（不影响离线使用）:', err);
      });
    })
  );
  // 立即激活
  self.skipWaiting();
});

// 激活: 清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 请求拦截: 网络优先策略（HTML/JS/CSS），保证实时更新
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // 只处理同源请求
  if (url.origin !== self.location.origin) return;

  const isPageOrScript = url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  if (isPageOrScript) {
    // HTML/JS/CSS: 网络优先，失败时回退缓存
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
  } else {
    // 图片/字体等: 缓存优先
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          }
          return response;
        });
      })
    );
  }
});
