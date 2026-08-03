/**
 * Service Worker - 考研择校助手
 * 提供离线缓存和PWA能力
 */

const CACHE_NAME = 'kaoyan-app-v7';
const IS_LOCAL_DEV = ['localhost', '127.0.0.1', '::1'].includes(self.location.hostname);

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
  // 本地 Vite 开发不使用 PWA 缓存，避免旧页面覆盖刚更新的界面。
  if (IS_LOCAL_DEV) {
    self.skipWaiting();
    return;
  }
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
  // 让已经被旧 Service Worker 接管的本地页面恢复到网络上的最新 Vite 页面。
  if (IS_LOCAL_DEV) {
    event.waitUntil((async () => {
      await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: 'window' });
      await Promise.all(windows.map((client) => client.navigate(client.url)));
    })());
    return;
  }
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
  if (IS_LOCAL_DEV) return;
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
