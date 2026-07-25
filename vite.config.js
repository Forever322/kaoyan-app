import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
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
  },
});
