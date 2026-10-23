import { expect, test, type Locator, type Page } from '@playwright/test';
import { historyRow, openApp } from '../redesign/helpers';

// 桌面应用不像网页（decisions/home.md「外壳」）：右键不弹浏览器菜单，界面文字不随鼠标变蓝，缩略图和导航项拖不起来；
// 输入框和要拿去别处粘贴的内容（链接、路径）照常能选中、能右键复制。

const ROWS = Array.from({ length: 4 }, (_, i) => historyRow(i + 1, `第${i + 1}张.png`, i * 30));

/** 真按一次右键，返回浏览器自己的菜单会不会弹出来（应用没拦下 contextmenu 就会弹） */
async function nativeMenuOn(page: Page, target: Locator): Promise<boolean> {
  await page.evaluate(() => {
    const w = window as unknown as { __nativeMenu?: boolean };
    delete w.__nativeMenu;
    // 挂在应用自己的监听之后：看到的是应用处理完的结果
    window.addEventListener('contextmenu', (event) => { w.__nativeMenu = !event.defaultPrevented; }, { once: true });
  });
  await target.click({ button: 'right' });
  return page.evaluate(() => (window as unknown as { __nativeMenu?: boolean }).__nativeMenu ?? false);
}

const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString().trim() ?? '');

/** 按住鼠标拖 40px：浏览器会不会开始拖这个元素（缩略图拖成半透明的图、导航项拖成一个链接） */
async function startsDrag(page: Page, target: Locator): Promise<boolean> {
  await page.evaluate(() => {
    const w = window as unknown as { __dragStarted?: boolean };
    w.__dragStarted = false;
    document.addEventListener('dragstart', () => { w.__dragStarted = true; }, { once: true });
  });
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  return page.evaluate(() => (window as unknown as { __dragStarted?: boolean }).__dragStarted ?? false);
}

const navItem = (page: Page, label: string) => page.locator('.app-sidebar__item').filter({ hasText: label });

test('right-clicking the interface shows no browser menu', async ({ page }) => {
  await openApp(page, { historyRows: ROWS });
  await expect(page.locator('.recent-row')).toHaveCount(4);

  expect(await nativeMenuOn(page, page.locator('.home'))).toBe(false);
  expect(await nativeMenuOn(page, page.locator('.recent-row__thumb img').first())).toBe(false);
  expect(await nativeMenuOn(page, navItem(page, '图库'))).toBe(false);
});

// 弹出来的菜单会吃掉下一次点击（WebKit 里真的弹），所以每条测试在弹出菜单之后就结束
test('text boxes keep the menu for cut, copy and paste', async ({ page }) => {
  await openApp(page, { historyRows: ROWS });
  await navItem(page, '图库').click();
  expect(await nativeMenuOn(page, page.locator('.toolbar__search-input'))).toBe(true);
});

test('links can be selected and keep the menu for copying', async ({ page }) => {
  await openApp(page, { historyRows: ROWS });
  await navItem(page, '图库').click();

  // 链接是要拿去别处粘贴的内容：双击能选中一段，选中的字上右键照常弹出「复制」
  await page.locator('.gallery .tile[aria-label="第2张.png"]').click();
  const link = page.locator('.detail .link-block');
  await link.dblclick();
  expect(await selectedText(page)).not.toBe('');
  expect(await nativeMenuOn(page, link)).toBe(true);
});

test('select-all and double-clicks leave the interface text alone', async ({ page }) => {
  await openApp(page, { historyRows: ROWS });
  await expect(page.locator('.recent-row')).toHaveCount(4);

  await page.locator('.home').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selectedText(page)).toBe('');

  await page.locator('.recent-row__name').first().dblclick();
  expect(await selectedText(page)).toBe('');
  await navItem(page, '链接健康').dblclick();
  expect(await selectedText(page)).toBe('');
});

test('thumbnails and nav items cannot be dragged away', async ({ page }) => {
  await openApp(page, { historyRows: ROWS });
  await expect(page.locator('.recent-row')).toHaveCount(4);

  expect(await startsDrag(page, page.locator('.recent-row__thumb img').first())).toBe(false);
  expect(await startsDrag(page, navItem(page, '图床'))).toBe(false);
});
