import { expect, test, type Page, type Route } from '@playwright/test';

type E2EState = {
  calls: Array<{ type: string; command?: string; event?: string; path?: string }>;
  dialogOpenResult?: string[] | string | null;
  failWriteTextFile?: Record<string, string>;
};

const SETTINGS_PATH = '/mock/appdata/.settings.dat';
const externalNetworkPattern = /^https?:\/\/(?!(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$))/;

async function fulfillExternalRequest(route: Route): Promise<void> {
  const request = route.request();
  const accept = request.headers().accept ?? '';

  if (request.resourceType() === 'image' || accept.includes('image/')) {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#dbeafe"/></svg>',
    });
    return;
  }

  if (request.method() === 'HEAD') {
    await route.fulfill({
      status: 204,
      headers: { 'access-control-allow-origin': '*' },
    });
    return;
  }

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: '{}',
  });
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app .main-layout')).toBeVisible();
}

async function getE2EState(page: Page): Promise<E2EState> {
  return page.evaluate(() => {
    return (window as Window & { __PICNEXUS_E2E__?: E2EState }).__PICNEXUS_E2E__ ?? { calls: [] };
  });
}

async function setDialogOpenResult(page: Page, result: string[] | string | null): Promise<void> {
  await page.evaluate((value) => {
    const state = (window as Window & { __PICNEXUS_E2E__?: E2EState }).__PICNEXUS_E2E__;
    if (!state) throw new Error('E2E state was not initialized');
    state.dialogOpenResult = value;
  }, result);
}

async function failNextSettingsWrite(page: Page, message: string): Promise<void> {
  await page.evaluate(({ path, failure }) => {
    const state = (window as Window & { __PICNEXUS_E2E__?: E2EState }).__PICNEXUS_E2E__;
    if (!state) throw new Error('E2E state was not initialized');
    state.failWriteTextFile ??= {};
    state.failWriteTextFile[path] = failure;
  }, { path: SETTINGS_PATH, failure: message });
}

test.describe('PicNexus Tauri smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
        const isExternal = /^https?:\/\//.test(url)
          && !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(url);

        if (isExternal) {
          return Promise.resolve(new Response(init?.method === 'HEAD' ? null : '{}', {
            status: 200,
            headers: {
              'access-control-allow-origin': '*',
              'content-type': 'application/json',
            },
          }));
        }

        return nativeFetch(input, init);
      };
    });
    await page.route(externalNetworkPattern, fulfillExternalRequest);
  });

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

    await page
      .locator('.settings-layout .toggle-row')
      .filter({ hasText: '开机自启动' })
      .locator('.p-toggleswitch')
      .click();

    await expect.poll(async () => {
      const state = await getE2EState(page);
      return state.calls.some((call) => call.type === 'invoke' && call.command === 'plugin:autostart|enable')
        && state.calls.some((call) => call.type === 'fs.writeTextFile' && call.path === SETTINGS_PATH);
    }).toBe(true);
  });

  test('file dialog and clipboard boundaries are mocked and stable', async ({ page }) => {
    await openApp(page);

    await page.locator('.drop-zone').click({ position: { x: 24, y: 24 } });
    await page.locator('.drop-zone .paste-link').first().click();

    const state = await getE2EState(page);
    expect(state.calls.some((call) => call.type === 'dialog.open')).toBe(true);
    expect(state.calls.some((call) => call.type === 'clipboard.readText' || call.command === 'get_clipboard_image')).toBe(true);
  });

  test('upload entry sends a selected file through mocked services into the queue', async ({ page }) => {
    await openApp(page);
    await setDialogOpenResult(page, ['/mock/files/release-smoke.png']);

    await page.locator('.drop-zone').click({ position: { x: 24, y: 24 } });

    const queueCard = page.locator('.queue-card').filter({ hasText: 'release-smoke.png' });
    await expect(queueCard).toBeVisible();
    await expect(queueCard).toContainText('全部完成', { timeout: 15_000 });

    const state = await getE2EState(page);
    expect(state.calls.some((call) => call.type === 'dialog.open')).toBe(true);
    expect(state.calls.some((call) => call.type === 'invoke' && call.command === 'get_image_metadata')).toBe(true);
    expect(state.calls.some((call) => call.type === 'invoke' && call.command === 'upload_to_jd')).toBe(true);
  });

  test('history entry keeps empty-state navigation stable on mocked SQLite', async ({ page }) => {
    await openApp(page);
    await page.locator('.sidebar .nav-btn').nth(1).click();

    await expect(page.locator('.history-view .dashboard-strip')).toBeVisible();
    await expect(page.locator('.history-view').getByText('暂无上传记录')).toBeVisible();

    await page.locator('.history-view .tab-btn').filter({ hasText: '时间轴' }).click();
    await expect(page.locator('.history-view .tab-btn.active')).toContainText('时间轴');
    await expect(page.locator('.history-view').getByText('暂无上传记录')).toBeVisible();

    await page.locator('.history-view .tab-btn').filter({ hasText: '收藏' }).click();
    await expect(page.locator('.history-view .tab-btn.active')).toContainText('收藏');
    await expect(page.locator('.history-view').getByText('暂无收藏')).toBeVisible();

    await page.locator('.history-view .tab-btn').filter({ hasText: '表格' }).click();
    await expect(page.locator('.history-view .tab-btn.active')).toContainText('表格');
    await expect(page.locator('.history-view').getByText('暂无上传记录')).toBeVisible();
  });

  test('settings save failure rolls back autostart through mocked native calls', async ({ page }) => {
    await openApp(page);
    await page.locator('.sidebar .nav-btn').nth(3).click();
    await expect(page.locator('.settings-layout')).toBeVisible();

    const autoStartSwitch = page
      .locator('.settings-layout .toggle-row')
      .filter({ hasText: '开机自启动' })
      .locator('.p-toggleswitch');

    await failNextSettingsWrite(page, 'mock settings disk full');
    await autoStartSwitch.click();

    await expect.poll(async () => {
      const calls = (await getE2EState(page)).calls;
      const enableIndex = calls.findIndex(
        (call) => call.type === 'invoke' && call.command === 'plugin:autostart|enable',
      );
      const disableIndex = calls.findIndex(
        (call, index) => index > enableIndex
          && call.type === 'invoke'
          && call.command === 'plugin:autostart|disable',
      );
      return enableIndex >= 0 && disableIndex > enableIndex;
    }).toBe(true);

    await expect(autoStartSwitch).not.toHaveClass(/p-toggleswitch-checked/);
    await expect(page.locator('.p-toast-message-error').filter({ hasText: '保存失败' })).toBeVisible();
  });

  test('link check page loads with monitor controls available', async ({ page }) => {
    await openApp(page);
    await page.locator('.sidebar .nav-btn').nth(2).click();

    await expect(page.locator('.link-check-view')).toBeVisible();
    await expect(page.locator('.link-check-view .lc-tab')).toHaveCount(3);
    await expect(page.locator('.link-check-view button').first()).toBeEnabled();
  });
});
