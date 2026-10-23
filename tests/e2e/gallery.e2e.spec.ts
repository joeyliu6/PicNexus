import { expect, test, type Locator, type Page } from '@playwright/test';
import { historyRow, openApp } from '../redesign/helpers';
import type { E2ESeed } from './mocks/state';

/**
 * 换筛选时网格的每一次变化（LoadingRules ①「切换直接显示内容」）：DOM 每变一次查一遍，记下不该出现的画面——
 * 有日期标题却没有一张图、没有字的日期标题、灰色占位块、加载过的缩略图又从透明淡入。
 */
async function watchGridFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gridProblems: Set<string>; __gridWatch?: MutationObserver; __seenThumbs: Set<string> };
    const seen = w.__seenThumbs;
    w.__gridProblems = new Set();
    const main = document.querySelector('.gallery__main')!;
    const check = () => {
      const grid = main.querySelector<HTMLElement>('.grid');
      if (!grid || !grid.offsetParent) return;
      const days = [...grid.querySelectorAll('.grid__day:not(.grid__day--sticky)')];
      if (days.length > 0 && !grid.querySelector('.tile')) w.__gridProblems.add('day headings without pictures');
      if (days.some((day) => !day.textContent?.trim())) w.__gridProblems.add('a day heading without its title');
      if (grid.querySelector('.grid__slot')) w.__gridProblems.add('grey placeholder blocks');
      for (const img of grid.querySelectorAll<HTMLImageElement>('.tile img:not([data-checked])')) {
        img.dataset.checked = '';
        if (seen.has(img.src) && !img.classList.contains('tile__img--loaded')) w.__gridProblems.add('a picture seen before fades in again');
      }
    };
    w.__gridWatch?.disconnect();
    w.__gridWatch = new MutationObserver(check);
    w.__gridWatch.observe(main, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  });
}

const gridProblems = (page: Page) => page.evaluate(() => [...(window as unknown as { __gridProblems: Set<string> }).__gridProblems]);

/** 屏幕上的格子都有了结果（图显示出来或判了失败），没有灰色占位块 */
async function settleGrid(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const grid = document.querySelector('.gallery .grid');
    if (!grid || grid.querySelector('.grid__slot') || !grid.querySelector('.tile')) return false;
    return [...grid.querySelectorAll('.tile')].every((tile) => tile.querySelector('.tile__broken')
      || tile.querySelector('img.tile__img--loaded'));
  })).toBe(true);
}

/** 30 张图，隔一天一张；每 3 张收藏一张，每 5 张有一张查出失效 */
function filterRows(): Record<string, unknown>[] {
  const DAY = 24 * 60;
  return Array.from({ length: 30 }, (_, i) => ({
    ...historyRow(i + 1, `第${i + 1}张.png`, i * 2 * DAY),
    is_favorited: i % 3 === 0 ? 1 : 0,
    ...(i % 5 === 0 ? { link_check_status: JSON.stringify({ jd: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx', statusCode: 404 } }) } : {}),
  }));
}

/** 列表视图的每一次变化：屏幕上的行不该先变成骨架条 */
async function watchListFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __listProblems: Set<string>; __listWatch?: MutationObserver };
    w.__listProblems = new Set();
    const main = document.querySelector('.gallery__main')!;
    const check = () => {
      if (main.querySelector('.list__row[aria-busy="true"]')) w.__listProblems.add('skeleton rows');
    };
    w.__listWatch?.disconnect();
    w.__listWatch = new MutationObserver(check);
    w.__listWatch.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
  });
}

const listProblems = (page: Page) => page.evaluate(() => [...(window as unknown as { __listProblems: Set<string> }).__listProblems]);

/** 列表屏幕上的行都读回来了（没有骨架条） */
async function settleList(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => !!document.querySelector('.list__row')
    && !document.querySelector('.list__row[aria-busy="true"]'))).toBe(true);
}

/** 图库开着时用命令面板「上传剪贴板图片」传一张（剪贴板里有图由种子的 clipboard_has_image 给出） */
async function pasteUpload(page: Page): Promise<void> {
  await page.keyboard.press('Control+K');
  await page.locator('.command-palette__input').fill('上传剪贴板');
  await expect(page.locator('.command-palette')).toContainText('上传剪贴板图片');
  await page.keyboard.press('Enter');
}

const CLIPBOARD_IMAGE: E2ESeed = { invokeOverrides: { clipboard_has_image: { result: true } } };

async function openFilterGallery(page: Page, seed: E2ESeed = {}): Promise<void> {
  await openApp(page, { historyRows: filterRows(), ...seed });
  // 记下加载出来过的缩略图（换回来时它们应当直接显示）
  await page.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { __seenThumbs: Set<string> }).__seenThumbs = seen;
    document.addEventListener('load', (event) => {
      if (event.target instanceof HTMLImageElement && event.target.closest('.tile')) seen.add(event.target.src);
    }, true);
  });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  await settleGrid(page);
}

// 回归：换筛选时先出一帧只有日期标题的空网格、再出整屏灰色占位块，图才淡入；新结果停在旧的滚动位置上
test('changing a filter swaps in the new pictures at once, from the top', async ({ page }) => {
  await openFilterGallery(page);
  const gallery = page.locator('.gallery');
  await page.locator('.gallery__scroll').evaluate((el) => { el.scrollTop = 1500; });
  await settleGrid(page);

  await watchGridFrames(page);
  await gallery.getByRole('button', { name: '★ 收藏' }).click();
  await expect(gallery.getByText('找到 10 张')).toBeVisible();
  await settleGrid(page);
  expect(await gridProblems(page)).toEqual([]);
  await expect(page.locator('.gallery__scroll')).toHaveJSProperty('scrollTop', 0);
  await expect(gallery.locator('.tile[aria-label="第1张.png"]')).toBeInViewport();

  await watchGridFrames(page);
  await gallery.getByPlaceholder('搜索文件名').fill('第1');
  await expect(gallery.getByText('找到 5 张')).toBeVisible();
  await settleGrid(page);
  expect(await gridProblems(page)).toEqual([]);
});

// 已经加载过的缩略图换回来时直接显示，不再从占位色淡入；离开屏幕久了（超过几秒）也一样
test('pictures seen before show at once when a filter is cleared', async ({ page }) => {
  await openFilterGallery(page);
  const gallery = page.locator('.gallery');
  await gallery.getByRole('button', { name: '★ 收藏' }).click();
  await expect(gallery.getByText('找到 10 张')).toBeVisible();
  await settleGrid(page);
  await page.clock.runFor(5000);

  await watchGridFrames(page);
  await gallery.getByText('清除全部').click();
  await expect(gallery.getByText('共 30 张')).toBeVisible();
  await settleGrid(page);
  expect(await gridProblems(page)).toEqual([]);
});

// 回归：图库开着时上传一张，今天那一行先整行变成灰色占位块，新记录读回来才又出图
test('an upload while the grid is open keeps today\'s pictures on screen', async ({ page }) => {
  await openFilterGallery(page, CLIPBOARD_IMAGE);
  const gallery = page.locator('.gallery');

  await watchGridFrames(page);
  await pasteUpload(page);
  await expect(gallery.getByText('共 31 张')).toBeVisible();
  await expect(gallery.locator('.tile[aria-label="clipboard.png"]')).toBeVisible();
  await settleGrid(page);
  expect(await gridProblems(page)).toEqual([]);
});

// 回归：列表点表头排序 / 换筛选时整屏的行先变成骨架条一帧，新的才出来；新结果从最上面看起
test('the list swaps in a new sort or filter at once, from the top', async ({ page }) => {
  // 150 行：滚到第二页（每页 100 行）再换，换上的新结果只有第一页，旧位置上没有可画的行
  const rows = Array.from({ length: 150 }, (_, i) => ({ ...historyRow(i + 1, `第${i + 1}张.png`, i * 30), is_favorited: i % 15 === 0 ? 1 : 0 }));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  const gallery = page.locator('.gallery');
  await gallery.getByLabel('列表', { exact: true }).click();
  await settleList(page);
  await page.locator('.list__scroll').evaluate((el) => { el.scrollTop = 6500; });
  await expect(page.locator('.list__row[data-index="121"]')).toBeVisible();
  await settleList(page);

  await watchListFrames(page);
  await page.locator('.list__sort').filter({ hasText: '文件名' }).click();
  await expect(page.locator('.list__head [aria-sort="ascending"]')).toBeVisible();
  await settleList(page);
  expect(await listProblems(page)).toEqual([]);
  await expect(page.locator('.list__scroll')).toHaveJSProperty('scrollTop', 0);
  await expect(page.locator('.list__row[data-index="0"]')).toBeInViewport();

  await watchListFrames(page);
  await gallery.getByRole('button', { name: '★ 收藏' }).click();
  await expect(gallery.getByText('找到 10 张')).toBeVisible();
  await expect(page.locator('.list')).toHaveAttribute('aria-rowcount', '11');
  await settleList(page);
  expect(await listProblems(page)).toEqual([]);
});

// 回归：列表开着时上传一张，整屏的行先变成骨架条再读回来
test('an upload while the list is open keeps its rows on screen', async ({ page }) => {
  await openFilterGallery(page, CLIPBOARD_IMAGE);
  const gallery = page.locator('.gallery');
  await gallery.getByLabel('列表', { exact: true }).click();
  await settleList(page);

  await watchListFrames(page);
  await pasteUpload(page);
  await expect(gallery.getByText('共 31 张')).toBeVisible();
  await expect(page.locator('.list__row').first()).toContainText('clipboard.png');
  await settleList(page);
  expect(await listProblems(page)).toEqual([]);
});

// 只筛「失效」时网格换成两组（不按天），换进、换出也一次换好
test('switching to and from the two 失效 groups swaps the grid at once', async ({ page }) => {
  await openFilterGallery(page);
  const gallery = page.locator('.gallery');

  await watchGridFrames(page);
  await gallery.getByRole('button', { name: '状态' }).click();
  await page.locator('.pn-menu').getByText('失效', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(gallery.locator('.grid__day-title').first()).toHaveText('失效 · 无可用备份');
  await settleGrid(page);
  expect(await gridProblems(page)).toEqual([]);

  await watchGridFrames(page);
  await gallery.getByText('清除全部').click();
  await expect(gallery.getByText('共 30 张')).toBeVisible();
  await settleGrid(page);
  expect(await gridProblems(page)).toEqual([]);
});

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

// 双击在第二次按下时就算（同 Windows）：第一下打开详情后列表、网格随之重排，第二下的按下与松开可能落在
// 不同的元素上，WebKit 就既不发 click 也不发 dblclick，这一下双击就丢了
async function secondPress(page: Page, down: Locator, up: Locator): Promise<void> {
  const from = (await down.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down({ clickCount: 2 });
  const to = (await up.boundingBox())!;
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
  await page.mouse.up({ clickCount: 2 });
}

const NAMED = Array.from({ length: 30 }, (_, i) => historyRow(i + 1, `n-${String(29 - i).padStart(2, '0')}.png`, i * 60));

test('a double-click on a list row opens the lightbox even if the layout shifts under the second press', async ({ page }) => {
  await openApp(page, { historyRows: NAMED });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  await page.locator('.gallery').getByLabel('列表', { exact: true }).click();
  const firstRow = page.locator('.list__row').first();
  await firstRow.locator('.list__name').click();
  await expect(page.locator('.detail')).toBeVisible();

  await secondPress(page, firstRow.locator('.list__name'), page.locator('.list__row').nth(1).locator('.list__thumb'));
  await expect(page.locator('.lightbox-chrome')).toContainText(await firstRow.getAttribute('aria-label') ?? '');
});

test('a double-click on a tile opens the lightbox even if the layout shifts under the second press', async ({ page }) => {
  await openApp(page, { historyRows: NAMED });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  const tile = page.locator('.gallery .tile[aria-label="n-29.png"]');
  await tile.click();
  await expect(page.locator('.detail')).toBeVisible();

  await secondPress(page, tile, page.locator('.gallery .tile[aria-label="n-28.png"]'));
  await expect(page.locator('.lightbox-chrome')).toContainText('n-29.png');
});

test('double-clicking a button on a tile does not open the lightbox', async ({ page }) => {
  await openApp(page, { historyRows: NAMED });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  const tile = page.locator('.gallery .tile[aria-label="n-29.png"]');
  await tile.hover();
  await tile.locator('.tile__star').dblclick();
  await page.waitForTimeout(300);
  await expect(page.locator('.lightbox-chrome')).toHaveCount(0);
});

// 回归：动图停在第一帧时原图只是隐藏、仍占着位置，画第一帧的 canvas 被挤到格子下面看不见，GIF 格子一片空白
test('a GIF shows its first frame inside its tile', async ({ page }) => {
  const url = 'https://mock.cdn/ratio/jd/1-480x360.gif';
  const row = { ...historyRow(1, '加载动画.gif', 10), format: 'gif', width: 480, height: 360, aspect_ratio: 480 / 360, generated_link: url, results: JSON.stringify([{ serviceId: 'jd', status: 'success', result: { serviceId: 'jd', fileKey: url, url } }]) };
  await openApp(page, { historyRows: [row] });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  const tile = page.locator('.gallery .tile[aria-label="加载动画.gif"]');
  const frame = tile.locator('canvas');
  await expect(frame).toBeVisible();

  const [tileBox, frameBox] = await Promise.all([tile.boundingBox(), frame.boundingBox()]);
  expect(frameBox?.y).toBeCloseTo(tileBox!.y, 0);
  expect(frameBox?.height).toBeCloseTo(tileBox!.height, 0);
});
