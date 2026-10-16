import { expect, test, type Page } from '@playwright/test';
import type { E2ESeed } from '../e2e/mocks/state';
import { capture, freezeTime, historyRow, openApp, SIZES, untilIdle, untilVisible, type OpenOptions } from './helpers';

/**
 * 快传（首页）各状态的像素基准，名字前缀对应设计画板（docs/design/redesign/handoff/states/STATES.md）。
 * H17「侧栏收起」由每张图的 narrow 尺寸覆盖；HB1–HB3 的背景装饰在 H01 / H04 里。
 */

const OLDER = [
  historyRow(1, '系统架构图.png', 42),
  historyRow(2, '登录页设计稿.png', 180),
  historyRow(3, '季度报表截图.png', 60 * 26),
  historyRow(4, 'logo-dark.png', 60 * 24 * 3),
];

/** Rust 侧真实的超时报错 */
const TIMEOUT = '请求超时，请检查网络连接';
const JD_OK = { upload_to_jd: { urlPrefix: 'https://mock.cdn/jd/' } };
const SINGLE = ['C:/Pictures/夏日海边.png'];
const BATCH = Array.from({ length: 12 }, (_, i) => `C:/Pictures/截图-${String(i + 1).padStart(2, '0')}.png`);

interface HomeState {
  seed?: E2ESeed;
  options?: OpenOptions;
  act?: (page: Page) => Promise<void>;
}

const pick = (page: Page) => page.locator('.drop-bar__pick').click();
const optionTrigger = (page: Page, key: string) => page.locator('.home-options__trigger').filter({ hasText: key });

const STATES: Record<string, HomeState> = {
  'H01-first-use': {},
  'H02-no-host': {
    seed: { config: { availableServices: [], enabledServices: [] } },
  },
  'H03-uploading': {
    seed: { historyRows: OLDER, dialogOpenResult: SINGLE, invokeOverrides: { upload_to_jd: { hang: true } } },
    act: async (page) => {
      await pick(page);
      await expect(page.locator('.focus-card')).toHaveAttribute('aria-label', '正在上传');
      await freezeTime(page);
    },
  },
  'H04-just-copied': {
    seed: { historyRows: OLDER, dialogOpenResult: SINGLE, invokeOverrides: JD_OK },
    act: async (page) => {
      await pick(page);
      await expect(page.locator('.focus-card__pill')).toContainText('已复制');
      await untilIdle(page);
    },
  },
  'H05-partial': {
    seed: {
      config: { enabledServices: ['jd', 'qiyu'] },
      historyRows: OLDER,
      dialogOpenResult: SINGLE,
      invokeOverrides: { ...JD_OK, check_chrome_installed: { result: true }, upload_to_qiyu: { error: TIMEOUT } },
    },
    act: async (page) => {
      await pick(page);
      await untilVisible(page, page.locator('.focus-card__failure'));
      await expect(page.locator('.focus-card__pill')).toContainText('已复制');
      await untilIdle(page);
    },
  },
  'H06-all-failed': {
    seed: { historyRows: OLDER, dialogOpenResult: SINGLE, invokeOverrides: { upload_to_jd: { error: TIMEOUT } } },
    act: async (page) => {
      await pick(page);
      await untilVisible(page, page.locator('.focus-card[aria-label="上传失败"]'));
      await untilIdle(page);
    },
  },
  'H07-drag-over': {
    seed: { historyRows: OLDER },
    act: async (page) => {
      await page.evaluate(() => {
        const state = (window as unknown as { __PICNEXUS_E2E__: { dragDropHandler?: (e: { payload: unknown }) => void } }).__PICNEXUS_E2E__;
        state.dragDropHandler?.({ payload: { type: 'enter', paths: ['C:/a.png', 'C:/b.png', 'C:/notes.zip'] } });
      });
      await expect(page.locator('.drop-overlay')).toBeVisible();
    },
  },
  'H08-batch-uploading': {
    seed: { historyRows: OLDER, dialogOpenResult: BATCH, invokeOverrides: { upload_to_jd: { hang: true } } },
    act: async (page) => {
      await pick(page);
      await expect(page.locator('.batch-card')).toBeVisible();
      await freezeTime(page);
    },
  },
  'H09-batch-done': {
    seed: {
      historyRows: OLDER,
      dialogOpenResult: BATCH,
      invokeOverrides: { upload_to_jd: { urlPrefix: 'https://mock.cdn/jd/', failFor: ['截图-04.png', '截图-09.png'], error: TIMEOUT } },
    },
    act: async (page) => {
      await pick(page);
      await untilVisible(page, page.locator('.batch-card').getByRole('button', { name: '重试 2 张' }));
      await untilIdle(page);
    },
  },
  'H10-url-dialog': {
    seed: { historyRows: OLDER },
    act: async (page) => {
      await page.locator('.drop-bar__more').click();
      await page.locator('.pn-menu').getByText('从 URL 下载…').click();
      await expect(page.locator('.url-dialog__input')).toBeVisible();
    },
  },
  'H11-menu-upload-to': {
    seed: { historyRows: OLDER },
    act: async (page) => {
      await optionTrigger(page, '上传到').click();
      await expect(page.locator('.pn-popover')).toBeVisible();
    },
  },
  'H12-menu-copy-as': {
    seed: { historyRows: OLDER },
    act: async (page) => {
      await optionTrigger(page, '复制为').click();
      await expect(page.locator('.pn-menu')).toBeVisible();
    },
  },
  'H13-menu-compress': {
    seed: { historyRows: OLDER },
    act: async (page) => {
      await optionTrigger(page, '压缩').click();
      await expect(page.locator('.pn-menu')).toBeVisible();
    },
  },
  'H14-transfer': {
    seed: { historyRows: OLDER, dialogOpenResult: BATCH, invokeOverrides: { upload_to_jd: { hang: true } } },
    act: async (page) => {
      await pick(page);
      await page.getByRole('button', { name: '传输中心' }).click();
      await expect(page.locator('.transfer-center')).toBeVisible();
      await freezeTime(page);
    },
  },
  'H15-palette-empty': {
    seed: { historyRows: OLDER },
    act: async (page) => {
      await page.keyboard.press('Control+k');
      await expect(page.locator('.command-palette')).toBeVisible();
    },
  },
  'H16-palette-search': {
    seed: { historyRows: OLDER },
    act: async (page) => {
      await page.keyboard.press('Control+k');
      await page.locator('.command-palette input').fill('架构');
      await expect(page.locator('.command-palette')).toContainText('系统架构图.png');
    },
  },
  'H18-hint': {
    seed: { historyRows: OLDER, dialogOpenResult: SINGLE, invokeOverrides: JD_OK },
    options: { hintShown: false },
    act: async (page) => {
      await pick(page);
      await expect(page.locator('.fast-hint')).toBeVisible();
      await expect(page.locator('.focus-card__pill')).toContainText('已复制');
      await untilIdle(page);
      await freezeTime(page);
    },
  },
};

for (const size of SIZES) {
  test.describe(`快传 · ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const [name, state] of Object.entries(STATES)) {
      test(name, async ({ page }) => {
        await openApp(page, state.seed, state.options);
        await expect(page.locator('.home')).toBeVisible();
        await state.act?.(page);
        await capture(page, `home-${name}-${size.name}`);
      });
    }
  });
}
