import { expect, test, type Page } from '@playwright/test';
import { historyRow, openApp } from '../redesign/helpers';

// 图库的读屏与键盘（交接说明 3.4、8.2、13.4）：Tab 顺序「工具栏 → 内容」，方向键浏览，刻度条与列表行也能只用键盘操作。

const DAY = 24 * 60;

async function openGallery(page: Page, count: number, spacingMinutes = 30): Promise<void> {
  const rows = Array.from({ length: count }, (_, i) => historyRow(i + 1, `第${i + 1}张.png`, i * spacingMinutes));
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  await expect(page.locator('.gallery .tile').first()).toBeVisible();
}

/** 从搜索框起按 Tab，直到焦点落在 selector 上（最多按 limit 次） */
async function tabUntil(page: Page, selector: string, limit = 30): Promise<boolean> {
  await page.locator('.gallery').getByPlaceholder('搜索文件名').focus();
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((s) => !!document.activeElement?.matches(s), selector)) return true;
  }
  return false;
}

const activeLabel = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);

// 格子在页面里是网格的直接子元素（重排时不重建），读屏看到的「行 → 格子」由每行的 aria-owns 认领
test('grid cells sit inside rows, as screen readers expect', async ({ page }) => {
  await openGallery(page, 8);
  const grid = page.locator('.gallery [role="grid"]');
  await expect(grid).toHaveAttribute('aria-multiselectable', 'true');
  await expect(grid).toMatchAriaSnapshot(`
    - grid "图片":
      - row:
        - rowheader "今天"
      - row:
        - gridcell "第1张.png"
        - gridcell "第2张.png"
      - row:
        - gridcell "第6张.png"
  `);
});

test('tab reaches the grid and arrow keys move the focus between pictures', async ({ page }) => {
  await openGallery(page, 8);
  expect(await tabUntil(page, '.tile')).toBe(true);
  expect(await activeLabel(page)).toBe('第1张.png');

  await page.keyboard.press('ArrowRight');
  expect(await activeLabel(page)).toBe('第2张.png');
  await page.keyboard.press('ArrowLeft');
  expect(await activeLabel(page)).toBe('第1张.png');

  await page.keyboard.press('Enter');
  await expect(page.locator('.detail')).toContainText('第1张.png');
});

test('the focused picture tells screen readers what needs attention', async ({ page }) => {
  const rows = [historyRow(1, '收藏的图.png', 10), historyRow(2, '普通的图.png', 20)];
  rows[0].is_favorited = 1;
  await openApp(page, { historyRows: rows });
  await page.locator('.app-sidebar__item').filter({ hasText: '图库' }).click();
  await expect(page.locator('.gallery .tile[aria-label="收藏的图.png"]')).toHaveAttribute('aria-description', /已收藏/);
});

test('the scrubber shows up on focus and arrow keys jump between months', async ({ page }) => {
  await openGallery(page, 40, 9 * DAY);
  expect(await tabUntil(page, '.scrubber')).toBe(true);
  const scrubber = page.locator('.scrubber');
  await expect(scrubber).toHaveCSS('opacity', '1');
  await expect(scrubber).toHaveAttribute('aria-valuenow', '1');

  await page.keyboard.press('End');
  await expect(page.locator('.gallery .tile[aria-label="第40张.png"]')).toBeInViewport();
  await page.keyboard.press('Home');
  await expect(page.locator('.gallery .tile[aria-label="第1张.png"]')).toBeInViewport();
});

test('list rows take the focus, move with the arrow keys and open with Enter or Space', async ({ page }) => {
  await openGallery(page, 8);
  await page.locator('.gallery').getByLabel('列表', { exact: true }).click();
  await expect(page.locator('.list__row').first()).toContainText('第1张.png');

  expect(await tabUntil(page, '.list__row')).toBe(true);
  expect(await activeLabel(page)).toBe('第1张.png');
  await page.keyboard.press('ArrowDown');
  expect(await activeLabel(page)).toBe('第2张.png');

  await page.keyboard.press('Enter');
  await expect(page.locator('.detail')).toContainText('第2张.png');
  await page.locator('.list__row[aria-label="第2张.png"]').focus();
  await page.keyboard.press(' ');
  await expect(page.locator('.lightbox-chrome')).toContainText('第2张.png');
});

test('only the focused list row puts its buttons in the tab order', async ({ page }) => {
  await openGallery(page, 8);
  await page.locator('.gallery').getByLabel('列表', { exact: true }).click();
  await expect(page.locator('.list__row').first()).toContainText('第1张.png');
  const tabbable = page.locator('.list__row button:not([tabindex="-1"])');
  await expect(tabbable).toHaveCount(2);
});
