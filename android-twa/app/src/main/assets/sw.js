/**
 * Service Worker - 考研择校助手
 * 提供离线缓存和PWA能力
 */

const CACHE_NAME = 'kaoyan-app-v4';

// 需要缓存的静态资源
const STATIC_ASSETS = [
  '.',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/app.js',
  'js/matcher.js',
  'js/storage.js',
  'js/data/national-lines.js',
  'js/data/universities.js',
  'js/data/admission-scores.js',
  'js/data/uni-photos.js',
  'js/data/uni-details.js'
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

// 请求拦截: 网络优先策略（HTML/JS），保证实时更新
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isPageOrScript = url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  if (isPageOrScript) {
    // HTML/JS: 网络优先，失败时回退缓存
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.status === 200 && url.origin === self.location.origin) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
  } else {
    // CSS/图片/字体等: 缓存优先
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200 && url.origin === self.location.origin) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          }
          return response;
        });
      })
    );
  }
});
});
