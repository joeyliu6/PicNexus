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
  // 两个引擎跑同一套冒烟：Windows 的 WebView2 是 Chromium，
  // macOS 的 WKWebView 与 Linux 的 WebKitGTK 都是 WebKit。
  // 这里没有任何截图断言，所以加引擎不产生基准图，纯赚覆盖。
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npx vite --config tests/e2e/vite.config.ts --host 127.0.0.1 --port 1422',
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
