import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/test/**/*.spec.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      include: [
        'src/utils/**',
        'src/services/**',
        'src/core/**',
        'src/composables/**',
        'src/uploaders/**',
      ],
      exclude: [
        'src/test/**',
        '**/*.d.ts',
        '**/types.ts',
      ],
      thresholds: {
        lines: 60,
        functions: 75,
        branches: 80,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
