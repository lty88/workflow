import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import VueRouter from 'vue-router/vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  plugins: [VueRouter({ routesFolder: 'src/pages', dts: 'src/typed-router.d.ts' }), vue(), vueJsx()],
  build: {
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        feedback: resolve(import.meta.dirname, 'feedback.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false } },
  },
});
