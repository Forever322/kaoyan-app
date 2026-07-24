/**
 * Service Worker - 考研择校助手
 * 提供离线缓存和PWA能力
 */

const CACHE_NAME = 'kaoyan-app-v1';

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
  'js/data/admission-scores.js'
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

// 请求拦截: 缓存优先策略
self.addEventListener('fetch', (event) => {
  // 只拦截 GET 请求
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // 缓存命中: 返回缓存
      if (cached) return cached;

      // 缓存未命中: 网络请求并缓存
      return fetch(event.request).then((response) => {
        // 只缓存成功的同源请求
        if (!response || response.status !== 200) return response;

        const url = new URL(event.request.url);
        if (url.origin === self.location.origin) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, cloned);
          });
        }

        return response;
      }).catch(() => {
        // 网络失败: 返回离线页面（对于HTML请求）
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('index.html');
        }
        // 其他资源静默失败
      });
    })
  );
});
