import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // 支持 describe/it/expect 全局写法（与 jest 风格一致）
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
