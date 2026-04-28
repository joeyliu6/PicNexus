import { expect, test, type Page } from '@playwright/test';

type E2EState = {
  calls: Array<{ type: string; command?: string; event?: string }>;
};

async function openApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app .main-layout')).toBeVisible();
}

async function getE2EState(page: Page): Promise<E2EState> {
  return page.evaluate(() => {
    return (window as Window & { __PICNEXUS_E2E__?: E2EState }).__PICNEXUS_E2E__ ?? { calls: [] };
  });
}

test.describe('PicNexus Tauri smoke', () => {
  test('starts without a blank screen', async ({ page }) => {
    await openApp(page);

    await expect(page.locator('.titlebar .app-title')).toHaveText('PicNexus');
    await expect(page.locator('.upload-view')).toBeVisible();
  });

  test('switches between the main navigation views', async ({ page }) => {
    await openApp(page);

    const nav = page.locator('.sidebar .nav-btn');
    await expect(nav).toHaveCount(4);

    await nav.nth(1).click();
    await expect(page.locator('.history-view')).toBeVisible();

    await nav.nth(2).click();
    await expect(page.locator('.link-check-view')).toBeVisible();

    await nav.nth(3).click();
    await expect(page.locator('.settings-layout')).toBeVisible();

    await nav.nth(0).click();
    await expect(page.locator('.upload-view')).toBeVisible();
  });

  test('settings save path reaches mocked native calls without crashing', async ({ page }) => {
    await openApp(page);
    await page.locator('.sidebar .nav-btn').nth(3).click();
    await expect(page.locator('.settings-layout')).toBeVisible();

    await page.locator('.settings-layout .p-toggleswitch').first().click();
    await page.waitForTimeout(650);

    const state = await getE2EState(page);
    expect(state.calls.some((call) => call.type === 'invoke' && call.command === 'plugin:autostart|enable')).toBe(true);
    expect(state.calls.some((call) => call.type === 'fs.writeTextFile')).toBe(true);
  });

  test('file dialog and clipboard boundaries are mocked and stable', async ({ page }) => {
    await openApp(page);

    await page.locator('.drop-zone').click({ position: { x: 24, y: 24 } });
    await page.locator('.drop-zone .paste-link').first().click();

    const state = await getE2EState(page);
    expect(state.calls.some((call) => call.type === 'dialog.open')).toBe(true);
    expect(state.calls.some((call) => call.type === 'clipboard.readText' || call.command === 'get_clipboard_image')).toBe(true);
  });

  test('link check page loads with monitor controls available', async ({ page }) => {
    await openApp(page);
    await page.locator('.sidebar .nav-btn').nth(2).click();

    await expect(page.locator('.link-check-view')).toBeVisible();
    await expect(page.locator('.link-check-view .lc-tab')).toHaveCount(3);
    await expect(page.locator('.link-check-view button').first()).toBeEnabled();
  });
});
