import { expect, test, type Page } from '@playwright/test';
import { capture, openApp, SIZES } from './helpers';

/**
 * 新手引导三步的像素基准，名字前缀对应设计画板（docs/design/redesign/handoff/states/STATES.md O01–O03）。
 * 新装应用第一次启动：没完成引导、没加京东；设计稿画的是开着全局快捷键、格式选 Markdown 的样子。
 */

const FIRST_RUN = {
  onboardingCompleted: false,
  publicServiceRiskAccepted: false,
  availableServices: ['r2', 'smms', 'github', 'imgur', 'tencent', 'aliyun', 'qiniu', 'upyun'],
  enabledServices: [],
  globalShortcut: { enabled: true, uploadClipboard: 'CommandOrControl+Shift+C', uploadFromFile: 'CommandOrControl+Shift+O' },
};

const next = (page: Page) => page.getByRole('dialog', { name: '新手引导' }).getByRole('button', { name: '下一步' }).click();

const STATES: Record<string, (page: Page) => Promise<void>> = {
  'O01-welcome': async () => {},
  'O02-pick-host': async (page) => {
    await next(page);
    await expect(page.getByRole('checkbox', { name: /京东/ })).toHaveAttribute('aria-checked', 'true');
  },
  'O03-how-to': async (page) => {
    await next(page);
    await next(page);
    await page.getByRole('group', { name: '默认链接格式' }).getByRole('button', { name: 'Markdown' }).click();
    await expect(page.getByRole('button', { name: '开始使用' })).toBeVisible();
  },
};

for (const size of SIZES) {
  test.describe(`新手引导 · ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const [name, act] of Object.entries(STATES)) {
      test(name, async ({ page }) => {
        await openApp(page, { config: FIRST_RUN });
        await expect(page.getByRole('dialog', { name: '新手引导' })).toBeVisible();
        await act(page);
        // 焦点环跟着「下一步」走，基准里不画它
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await capture(page, `onboarding-${name}-${size.name}`);
      });
    }
  });
}
