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

// 回归：「今天 / 昨天」只在打开页面时算一次，外壳的 KeepAlive 让图库一直不重建，过了午夜标题还写「今天」
test('day headings follow the date past midnight', async ({ page }) => {
  await openApp(page, { historyRows: [historyRow(1, '上午传的.png', 10)] });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  const heading = page.locator('.gallery .grid__day-title').first();
  await expect(heading).toHaveText('今天');

  await page.clock.fastForward('14:00:00');
  await expect(heading).toHaveText('昨天');
});

// 回归：列表点表头排序后整屏只剩骨架条，滚一下才出数据（只在可见行范围变化时取页）
test('sorting the list refills the visible rows at once', async ({ page }) => {
  const rows = Array.from({ length: 30 }, (_, i) => historyRow(i + 1, `img-${String(i).padStart(2, '0')}.png`, i * 60));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  await page.locator('.gallery').getByLabel('列表', { exact: true }).click();
  const firstRow = page.locator('.list__row').first();
  await expect(firstRow).toContainText('img-00.png');

  await page.locator('.list__sort').filter({ hasText: '文件名' }).click();
  await expect(firstRow).toContainText(/img-(00|29)\.png/);
  await page.locator('.list__sort').filter({ hasText: '文件名' }).click();
  await expect(firstRow).toContainText(/img-(00|29)\.png/);
});

// 回归：网格的快捷键只排除了输入框——焦点在详情的「复制」上按空格，按钮照常复制，灯箱也跟着打开
test('space on a focused button does its own thing, not the grid\'s', async ({ page }) => {
  const rows = Array.from({ length: 4 }, (_, i) => historyRow(i + 1, `第${i + 1}张.png`, i * 30));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  await page.locator('.gallery .tile[aria-label="第1张.png"]').click();
  await page.locator('.detail .detail__copy').focus();

  await page.keyboard.press(' ');
  await expect(page.locator('.detail .detail__copy')).toContainText('已复制');
  await expect(page.locator('.pswp--open')).toHaveCount(0);
});

// 回归：菜单开着时按 Esc，网格先收了一层（清空多选），菜单再关一层
test('escape in an open menu closes only the menu', async ({ page }) => {
  const rows = Array.from({ length: 4 }, (_, i) => historyRow(i + 1, `第${i + 1}张.png`, i * 30));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  await page.locator('.gallery .tile[aria-label="第1张.png"]').click({ modifiers: ['Control'] });
  const bar = page.locator('.selection-bar');
  await expect(bar).toContainText('已选 1 张');

  await bar.getByRole('button', { name: /复制链接/ }).click();
  await expect(page.locator('.pn-menu[data-state="open"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pn-menu[data-state="open"]')).toHaveCount(0);
  await expect(bar).toContainText('已选 1 张');
});

// 回归：在「没有匹配的图片」点「清除筛选」，新统计回来前按「没有条件 + 0 张」判成了「暂无图片」，闪一下首页同款背景
test('clearing filters goes straight back to the pictures without flashing the empty gallery', async ({ page }) => {
  const rows = Array.from({ length: 4 }, (_, i) => historyRow(i + 1, `第${i + 1}张.png`, i * 30));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  const gallery = page.locator('.gallery');
  await gallery.getByPlaceholder('搜索文件名').fill('找不到的名字');
  await expect(gallery.getByText('没有匹配的图片')).toBeVisible();

  await page.evaluate(() => {
    const flags = window as unknown as { __sawEmptyGallery?: boolean };
    flags.__sawEmptyGallery = false;
    new MutationObserver(() => {
      if (document.querySelector('.gallery')?.textContent?.includes('暂无图片')) flags.__sawEmptyGallery = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await gallery.getByRole('button', { name: '清除筛选' }).click();
  await expect(gallery.locator('.tile').first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __sawEmptyGallery?: boolean }).__sawEmptyGallery)).toBe(false);
});

// 回归：双击 = 两次单击 + dblclick。第二下单击把刚打开的详情又收起，网格宽度来回变
test('double-clicking a picture opens it in the lightbox and keeps its details', async ({ page }) => {
  const rows = Array.from({ length: 6 }, (_, i) => historyRow(i + 1, `第${i + 1}张.png`, i * 30));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();

  await page.locator('.gallery .tile[aria-label="第2张.png"]').dblclick();
  await expect(page.locator('.pswp--open')).toHaveCount(1);
  await expect(page.locator('.lightbox-chrome')).toContainText('第2张.png');
  await expect(page.locator('.detail')).toContainText('第2张.png');
});

// 双击稍慢时，第一下打开的详情已让网格变窄重排，第二下落在了别的图上：灯箱仍开第一下那张
test('a slow double-click still opens the picture the first click hit', async ({ page }) => {
  const rows = Array.from({ length: 6 }, (_, i) => historyRow(i + 1, `第${i + 1}张.png`, i * 30));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();

  await page.locator('.gallery .tile[aria-label="第2张.png"]').click();
  await expect(page.locator('.detail')).toContainText('第2张.png');
  const other = page.locator('.gallery .tile[aria-label="第3张.png"]');
  await other.dispatchEvent('click', { detail: 2 });
  await other.dispatchEvent('dblclick', { detail: 2 });
  await expect(page.locator('.lightbox-chrome')).toContainText('第2张.png');
});

// 回归：Ctrl/⌘ A 只选了已经加载出来的那几天；G04 要的是「全选当前结果」
test('ctrl+A selects every picture in the current results', async ({ page }) => {
  const DAY = 24 * 60;
  const rows = Array.from({ length: 40 }, (_, i) => historyRow(i + 1, `第${i + 1}张.png`, i * 9 * DAY));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  await expect(page.locator('.gallery .tile').first()).toBeVisible();

  await page.keyboard.press('Control+A');
  await expect(page.locator('.selection-bar')).toContainText('已选 40 张');
});

// 回归：列表里打开的灯箱按上传时间翻页、「3 / 21」也按网格算；列表按文件名排着，← → 应按文件名走
test('the lightbox opened from the list pages in list order', async ({ page }) => {
  // 文件名与上传时间反着排：最新的叫 n-29，最旧的叫 n-00
  const rows = Array.from({ length: 30 }, (_, i) => historyRow(i + 1, `n-${String(29 - i).padStart(2, '0')}.png`, i * 60));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  await page.locator('.gallery').getByLabel('列表', { exact: true }).click();
  await page.locator('.list__sort').filter({ hasText: '文件名' }).click();
  const firstRow = page.locator('.list__row').first();
  await expect(firstRow).toContainText('n-00.png');

  await firstRow.dblclick();
  const chrome = page.locator('.lightbox-chrome');
  await expect(chrome).toContainText('n-00.png');
  await page.keyboard.press('ArrowRight');
  await expect(chrome).toContainText('n-01.png');
  await expect(chrome).toContainText('2 / 30');
});
