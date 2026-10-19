import { expect, test, type Page } from '@playwright/test';
import { openApp } from '../redesign/helpers';

// 新手引导（交接说明 8.7，O01–O03）：引导里选的图床与格式，和首页「上传到 / 复制为」、托盘是同一份配置；
// 勾选京东即视为确认公共图床风险，不再弹确认框。

/** 新装应用第一次启动：没完成引导、没加京东、没确认风险（与 src/config/defaults.ts 一致） */
const FIRST_RUN = {
  onboardingCompleted: false,
  publicServiceRiskAccepted: false,
  availableServices: ['r2', 'smms', 'github', 'imgur', 'tencent', 'aliyun', 'qiniu', 'upyun'],
  enabledServices: [],
};

async function trayDetail(page: Page, label: string): Promise<string | undefined> {
  return page.evaluate((name) => {
    const calls = globalThis.__PICNEXUS_E2E__?.calls ?? [];
    const last = [...calls].reverse().find((call) => call.type === 'tray.setMenu') as { items: Array<{ text?: string }> } | undefined;
    const entry = last?.items.find((item) => item.text?.split(/\t| · /)[0] === name);
    return entry?.text?.split(/\t| · /)[1];
  }, label);
}

const dialog = (page: Page) => page.getByRole('dialog', { name: '新手引导' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('first run: picks go into the same config as home and tray, without a second risk prompt', async ({ page }) => {
  await openApp(page, { config: FIRST_RUN });
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: '上一步' })).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: '下一步' })).toBeFocused();

  // 回到第 1 步时「上一步」消失，焦点留在弹窗里的「下一步」
  await dialog(page).getByRole('button', { name: '下一步' }).click();
  await dialog(page).getByRole('button', { name: '上一步' }).click();
  await expect(dialog(page).getByRole('button', { name: '下一步' })).toBeFocused();

  await dialog(page).getByRole('button', { name: '下一步' }).click();
  await expect(dialog(page).getByRole('checkbox', { name: /京东/ })).toHaveAttribute('aria-checked', 'true');
  await dialog(page).getByRole('checkbox', { name: /七鱼/ }).click();
  await dialog(page).getByRole('button', { name: '下一步' }).click();

  await dialog(page).getByRole('group', { name: '默认链接格式' }).getByRole('button', { name: 'Markdown' }).click();
  await dialog(page).getByRole('button', { name: '开始使用' }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('启用公共图床？')).toHaveCount(0);
  await expect(page.locator('.home')).toBeVisible();
  await expect.poll(() => trayDetail(page, '上传到')).toBe('2 个图床');
  await expect.poll(() => trayDetail(page, '复制为')).toBe('Markdown');
  await expect(page.locator('.first-use__format')).toHaveText('Markdown');
});

test('skip keeps hosts and format untouched and does not ask again', async ({ page }) => {
  await openApp(page, { config: FIRST_RUN });
  await dialog(page).getByRole('button', { name: '下一步' }).click();
  await dialog(page).getByRole('button', { name: '跳过' }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('尚未启用图床')).toBeVisible();
  await expect.poll(() => trayDetail(page, '上传到')).toBe('未选择');
});

test('reopened from 设置 › 关于: shows the current picks, unchecking stops a host and lands on home', async ({ page }) => {
  await openApp(page);
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: /关于/ }).click();
  await page.getByRole('button', { name: /重新查看新手引导/ }).click();

  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: '下一步' }).click();
  await expect(dialog(page).getByRole('checkbox', { name: /京东/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog(page).getByRole('checkbox', { name: /七鱼/ })).toHaveAttribute('aria-checked', 'false');
  await dialog(page).getByRole('checkbox', { name: /京东/ }).click();
  await dialog(page).getByRole('checkbox', { name: /七鱼/ }).click();
  await dialog(page).getByRole('button', { name: '下一步' }).click();
  await dialog(page).getByRole('button', { name: '开始使用' }).click();

  await expect(page.locator('.home')).toBeVisible();
  await expect.poll(() => trayDetail(page, '上传到')).toBe('七鱼');
});

test('after skipping a restore, the long notice waits until onboarding closes so it never covers the dialog buttons', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.addInitScript(() => {
    sessionStorage.setItem('picnexus-startup-notice', JSON.stringify({ kind: 'skipped', file: 'picnexus-encrypted-settings-20261019-083404.json' }));
  });
  await openApp(page, { config: FIRST_RUN });
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.pn-toast')).toHaveCount(0);

  await dialog(page).getByRole('button', { name: '跳过' }).click();
  await expect(page.locator('.pn-toast', { hasText: '已使用默认配置启动' })).toContainText('picnexus-encrypted-settings-20261019-083404.json');
});
