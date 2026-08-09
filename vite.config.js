import { defineConfig } from 'vite';
import process from 'node:process';

const backendProxyTarget = process.env.VITE_BACKEND_PROXY || 'http://127.0.0.1:3000';

export default defineConfig({
  root: '.',
  base: process.env.DEPLOY_PAGES ? '/kaoyan-app/' : './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/data/')) {
            return 'data';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
    // 本地开发也保持与生产一致：前端请求 /api，由 Vite 转发给后端。
    // 当明确代理到线上后端时，移除浏览器的 localhost Origin；请求由开发代理
    // 发起，生产 CORS 白名单无需为了本地预览而额外放宽。
    proxy: {
      '/api': {
        target: backendProxyTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest) => {
            if (process.env.VITE_BACKEND_PROXY) proxyRequest.removeHeader('origin');
          });
        },
      },
    },
  },
});
