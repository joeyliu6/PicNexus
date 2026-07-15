import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.spec.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'src/utils/**',
        'src/services/**',
        'src/core/**',
        'src/composables/**',
        'src/uploaders/**',
        'src/components/UploadQueue.vue',
        'src/components/upload/**',
        'src/components/views/UploadView.vue',
        'src/components/views/upload/**',
        'src/components/views/SettingsView.vue',
        'src/components/settings/**',
        'src/components/views/HistoryView.vue',
        'src/components/views/history/**',
        'src/components/views/LinkCheckView.vue',
        'src/components/views/linkcheck/**',
      ],
      exclude: [
        'tests/unit/**',
        '**/*.d.ts',
        '**/types.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 80,
        statements: 70,
        'src/{utils,services,core,composables,uploaders}/**': {
          lines: 70,
          functions: 80,
          branches: 80,
          statements: 70,
        },
        'src/components/{UploadQueue.vue,upload/**,views/UploadView.vue,views/upload/**}': {
          lines: 80,
          functions: 60,
          branches: 70,
          statements: 80,
        },
        'src/components/{views/SettingsView.vue,settings/**}': {
          lines: 90,
          functions: 45,
          branches: 75,
          statements: 90,
        },
        'src/components/settings/{BackupSyncPanel.vue,backup/**}': {
          lines: 90,
          functions: 70,
          branches: 70,
          statements: 90,
        },
        'src/components/{views/HistoryView.vue,views/history/**}': {
          lines: 80,
          functions: 55,
          branches: 80,
          statements: 80,
        },
        'src/components/{views/LinkCheckView.vue,views/linkcheck/**}': {
          lines: 80,
          functions: 55,
          branches: 75,
          statements: 80,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
