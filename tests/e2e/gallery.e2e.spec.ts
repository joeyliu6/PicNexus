import { expect, test } from '@playwright/test';
import { historyRow, openApp } from '../redesign/helpers';

// 命令面板选中图片按 Ctrl+Enter「在图库中定位」（交接说明 8.1）：
// 打开图库、跳到那张图所在的那一天、选中它并打开详情。目标放在最旧的一天，首屏看不到。
test('command palette Ctrl+Enter locates the image in the gallery', async ({ page }) => {
  const DAY = 24 * 60;
  const rows = Array.from({ length: 40 }, (_, i) => historyRow(i + 1, i === 39 ? '远处的目标.png' : `第${i + 1}张.png`, i * 9 * DAY));
  await openApp(page, { historyRows: rows });

  await page.keyboard.press('Control+K');
  await page.locator('.command-palette__input').fill('远处的目标');
  await expect(page.locator('.command-palette')).toContainText('远处的目标.png');
  await page.keyboard.press('Control+Enter');

  const gallery = page.locator('.gallery');
  await expect(gallery).toBeVisible();
  await expect(page.locator('.detail')).toContainText('远处的目标.png');
  await expect(gallery.locator('.tile[aria-label="远处的目标.png"]')).toBeInViewport();
});

// 图库正开着会把它筛掉的条件（这里是搜索词）：先清掉筛选再定位，否则那一天根本不在结果里
test('locating clears gallery filters that would hide the image', async ({ page }) => {
  const DAY = 24 * 60;
  const rows = Array.from({ length: 40 }, (_, i) => historyRow(i + 1, i === 39 ? '远处的目标.png' : `第${i + 1}张.png`, i * 9 * DAY));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  const gallery = page.locator('.gallery');
  await gallery.getByPlaceholder('搜索文件名').fill('第1张');
  await expect(gallery.getByText('清除全部')).toBeVisible();

  await page.keyboard.press('Control+K');
  await page.locator('.command-palette__input').fill('远处的目标');
  await expect(page.locator('.command-palette')).toContainText('远处的目标.png');
  await page.keyboard.press('Control+Enter');

  await expect(gallery.getByPlaceholder('搜索文件名')).toHaveValue('');
  await expect(page.locator('.detail')).toContainText('远处的目标.png');
  await expect(gallery.locator('.tile[aria-label="远处的目标.png"]')).toBeInViewport();
});

// 设计稿的详情面板没有关闭按钮：除了 Esc，再点一次同一张也能收起（鼠标也关得掉）
test('clicking the open image again closes its details', async ({ page }) => {
  const rows = Array.from({ length: 6 }, (_, i) => historyRow(i + 1, `第${i + 1}张.png`, i * 30));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  const tile = page.locator('.gallery .tile[aria-label="第2张.png"]');

  await tile.click();
  await expect(page.locator('.detail')).toContainText('第2张.png');
  await tile.click();
  await expect(page.locator('.detail')).toBeHidden();
});
