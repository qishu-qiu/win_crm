import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // 开发期把 /api 代理到后端（后端 nest 默认 3000，Swagger 在 /api）
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
