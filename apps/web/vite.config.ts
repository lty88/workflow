import { defineConfig } from 'vite';
import VueRouter from 'vue-router/vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
export default defineConfig({
  plugins: [VueRouter({ routesFolder: 'src/pages', dts: 'src/typed-router.d.ts' }), vue(), vueJsx()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false } },
  },
});
