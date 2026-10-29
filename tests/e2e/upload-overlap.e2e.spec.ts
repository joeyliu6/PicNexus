import { expect, test, type Page } from '@playwright/test';
import { mockObjectName } from './mocks/core';
import { historyRow, openApp } from '../redesign/helpers';

/**
 * 几次上传同时进行（upload-flow.md 图 1）：上一次还有图床在传（慢、重试、等超时）时再拖入，
 * 这一次立即开始，不再弹「请稍候」把它丢掉；剪贴板里是最新那张的链接。
 */

async function drop(page: Page, paths: string[]): Promise<void> {
  await page.evaluate((files) => {
    const state = (window as unknown as { __PICNEXUS_E2E__: { dragDropHandler?: (e: { payload: unknown }) => void } }).__PICNEXUS_E2E__;
    state.dragDropHandler?.({ payload: { type: 'enter', paths: files } });
    state.dragDropHandler?.({ payload: { type: 'drop', paths: files } });
  }, paths);
}

const clipboardText = (page: Page) => page.evaluate(() => (window as unknown as { __PICNEXUS_E2E__: { clipboardText: string } }).__PICNEXUS_E2E__.clipboardText);

test('a picture dropped while a slow host is still uploading starts at once and its link is copied', async ({ page }) => {
  await openApp(page, {
    config: { enabledServices: ['jd', 'qiyu'] },
    historyRows: [historyRow(1, '系统架构图.png', 42)],
    // 京东马上传完，七鱼一直不返回：第一张一直算「上传中」
    invokeOverrides: { upload_to_jd: { urlPrefix: 'https://mock.cdn/jd/' }, check_chrome_installed: { result: true }, upload_to_qiyu: { hang: true } },
  });
  const focusCard = page.locator('.home .focus-card');
  const pill = focusCard.locator('.focus-card__pill');

  await drop(page, ['C:/Pictures/第一张.png']);
  await expect(focusCard).toContainText('第一张.png');
  await page.clock.runFor(1000);
  await expect(pill).toContainText('已复制');

  await drop(page, ['C:/Pictures/第二张.png']);
  await expect(focusCard).toContainText('第二张.png');
  await page.clock.runFor(1000);
  await expect(pill).toContainText('已复制');
  await expect.poll(() => clipboardText(page)).toBe(`https://mock.cdn/jd/${mockObjectName('第二张.png')}`);
  await expect(page.locator('.pn-toaster')).not.toContainText('请稍候');
  // 第一张还在传（七鱼），列在「最近上传」里
  await expect(page.locator('.recent-row', { hasText: '第一张.png' })).toBeVisible();
});
