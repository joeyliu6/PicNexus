import { defineConfig } from '@playwright/test';

// 新界面的像素基准（tests/redesign）：跑真应用 + e2e 的原生接口模拟（tests/e2e/mocks），端口与冒烟测试的 1422 分开。
// 每张图自己定窗口尺寸（宽 1400×900 / 窄 800×600）。跨引擎（WebKit）这一层由 e2e 的 webkit project 承担。
const redesignBaseUrl = 'http://127.0.0.1:1423';

export default defineConfig({
  testDir: './tests/redesign',
  testMatch: /.*\.visual\.spec\.ts/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: redesignBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [
    {
      name: 'redesign-light',
      use: { browserName: 'chromium', colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Asia/Shanghai' },
    },
    {
      name: 'redesign-dark',
      use: { browserName: 'chromium', colorScheme: 'dark', locale: 'zh-CN', timezoneId: 'Asia/Shanghai' },
    },
  ],
  webServer: [
    {
      command: 'npx vite --config tests/e2e/vite.config.ts --host 127.0.0.1 --port 1423',
      url: redesignBaseUrl,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
