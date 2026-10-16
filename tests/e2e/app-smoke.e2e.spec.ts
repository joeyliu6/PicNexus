import { expect, test, type Page, type Route } from '@playwright/test';

type E2EState = {
  calls: Array<{ type: string; command?: string; event?: string; path?: string; text?: string }>;
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
  await expect(page.locator('#app .app-shell')).toBeVisible();
}

/** 1280 宽的窗口侧栏是展开的（窄于 1000 才收成图标栏） */
function navItem(page: Page, label: string) {
  return page.locator('.app-sidebar .app-sidebar__item').filter({ hasText: label });
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

    // 不断言 Logo 行的「PicNexus」：WebKit 按 macOS 画，那一行让给系统红绿灯
    await expect(navItem(page, '快传')).toHaveAttribute('aria-current', 'page');
    // 模拟数据里没有上传记录：首页是「第一次使用」
    await expect(page.locator('.home .first-use')).toBeVisible();
  });

  test('switches between the main navigation views', async ({ page }) => {
    await openApp(page);

    await expect(page.locator('.app-sidebar .app-sidebar__item')).toHaveCount(6);

    await navItem(page, '图库').click();
    await expect(page.locator('.history-view')).toBeVisible();

    await navItem(page, '链接健康').click();
    await expect(page.locator('.link-check-view')).toBeVisible();

    await navItem(page, '图床').click();
    await expect(page.locator('.settings-layout')).toBeVisible();

    await navItem(page, '设置').click();
    await expect(page.locator('.settings-layout .settings-sidebar')).toBeVisible();

    await navItem(page, '快传').click();
    await expect(page.locator('.home')).toBeVisible();
  });

  test('settings save path reaches mocked native calls without crashing', async ({ page }) => {
    await openApp(page);
    await navItem(page, '设置').click();
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

    await page.locator('.first-use').getByRole('button', { name: '选择文件' }).click();
    await page.locator('body').press('Control+v');

    await expect.poll(async () => {
      const state = await getE2EState(page);
      return state.calls.some((call) => call.type === 'dialog.open')
        && state.calls.some((call) => call.type === 'invoke' && call.command === 'clipboard_has_image');
    }).toBe(true);
  });

  test('upload entry sends a selected file through mocked services and copies its link', async ({ page }) => {
    await openApp(page);
    await setDialogOpenResult(page, ['/mock/files/release-smoke.png']);

    await page.locator('.first-use').getByRole('button', { name: '选择文件' }).click();

    const focusCard = page.locator('.home .focus-card').filter({ hasText: 'release-smoke.png' });
    await expect(focusCard).toBeVisible();
    // 单张上传：第一个图床传完就复制（交接说明第 4 节）
    await expect(focusCard.locator('.focus-card__pill')).toContainText('已复制', { timeout: 15_000 });

    const state = await getE2EState(page);
    expect(state.calls.some((call) => call.type === 'dialog.open')).toBe(true);
    expect(state.calls.some((call) => call.type === 'invoke' && call.command === 'get_image_metadata')).toBe(true);
    expect(state.calls.some((call) => call.type === 'invoke' && call.command === 'upload_to_jd')).toBe(true);
    expect(state.calls.some((call) => call.type === 'clipboard.writeText' && !!call.text)).toBe(true);
  });

  test('history entry keeps empty-state navigation stable on mocked SQLite', async ({ page }) => {
    await openApp(page);
    await navItem(page, '图库').click();

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
    await navItem(page, '设置').click();
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
    const failure = page.locator('.pn-toast').filter({ hasText: '保存失败' });
    await expect(failure).toBeVisible();
    await expect(failure.locator('.pn-toast__glyph--error')).toBeVisible();
  });

  test('link check page loads with monitor controls available', async ({ page }) => {
    await openApp(page);
    await navItem(page, '链接健康').click();

    await expect(page.locator('.link-check-view')).toBeVisible();
    await expect(page.locator('.link-check-view .lc-tab')).toHaveCount(3);
    await expect(page.locator('.link-check-view button').first()).toBeEnabled();
  });
});
