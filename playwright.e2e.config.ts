import { defineConfig } from '@playwright/test';

const e2eBaseUrl = 'http://127.0.0.1:1422';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.e2e\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: e2eBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npx vite --config tests/e2e/vite.config.ts --host 127.0.0.1 --port 1422',
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
