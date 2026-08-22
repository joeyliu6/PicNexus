import { defineConfig } from '@playwright/test';

const visualBaseUrl = 'http://127.0.0.1:1421';
const desktopViewport = { width: 1280, height: 800 };

// 跨引擎哨兵用 .probe.spec.ts 后缀与像素快照的 .visual.spec.ts 分开。
// Playwright 的 project 级 testMatch 是「覆盖」而非「取交集」语义，
// 所以下面两个 layout-* 只收 probe 文件，desktop-* 继承顶层 testMatch 只收
// visual 文件 —— 两边互不干扰，现有 172 张基准图零影响。
const layoutProbeMatch = /.*\.probe\.spec\.ts/;

export default defineConfig({
  testDir: './tests/visual',
  testMatch: /.*\.visual\.spec\.ts/,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html'], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: visualBaseUrl,
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
      name: 'desktop-light',
      use: { browserName: 'chromium', viewport: desktopViewport, colorScheme: 'light' },
    },
    {
      name: 'desktop-dark',
      use: { browserName: 'chromium', viewport: desktopViewport, colorScheme: 'dark' },
    },
    // 参照引擎：它必须先绿，否则 cross-engine/exemptions.ts 里登记的豁免就不诚实
    {
      name: 'layout-chromium',
      testMatch: layoutProbeMatch,
      use: { browserName: 'chromium', viewport: desktopViewport, colorScheme: 'light' },
    },
    // 目标引擎：近似 macOS 的 WKWebView 与 Linux 的 WebKitGTK
    {
      name: 'layout-webkit',
      testMatch: layoutProbeMatch,
      use: { browserName: 'webkit', viewport: desktopViewport, colorScheme: 'light' },
    },
  ],
  webServer: {
    command: 'npx vite --config tests/visual/vite.config.ts --host 127.0.0.1 --port 1421',
    url: visualBaseUrl,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
