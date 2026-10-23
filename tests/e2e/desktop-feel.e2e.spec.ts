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

// 光标照设计稿（Controls 给按钮写的 cursor: default）：按钮、行用箭头；设计稿里是链接的（侧栏搜索）才是小手。
// 侧栏导航本身是 <a>，小手由浏览器给（WebKit 算出来是 auto，指到链接上才换成小手），这里不量
test('buttons and rows show the arrow, links show the hand', async ({ page }) => {
  await openApp(page, { historyRows: ROWS });
  await expect(page.locator('.recent-row')).toHaveCount(4);
  const cursor = (target: Locator) => target.evaluate((el) => getComputedStyle(el).cursor);

  for (const target of [page.locator('.drop-bar__pick'), page.locator('.drop-bar__more'), page.locator('.recent__more').first(), page.locator('.app-sidebar__collapse')]) {
    expect(await cursor(target)).not.toBe('pointer');
  }
  expect(await cursor(page.locator('.sidebar-search'))).toBe('pointer');
});

// 被省略号截断的文件名，悬停时用系统提示补全名；放得下的名字不出提示（同资源管理器）
test('a cut-off file name shows its full name on hover, a short one does not', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const long = '微信图片_20261023152233_一张名字特别特别特别特别长的截图_1234567890abcdef.png';
  await openApp(page, { historyRows: [historyRow(1, long, 30), historyRow(2, '短名字.png', 60)] });
  await navItem(page, '图库').click();
  await page.locator('.gallery').getByLabel('列表', { exact: true }).click();
  const name = (text: string) => page.locator('.list__name', { hasText: text });

  await name('短名字.png').hover();
  await expect(name('短名字.png')).not.toHaveAttribute('title');
  await name('微信图片').hover();
  await expect(name('微信图片')).toHaveAttribute('title', long);
});

test('a long host name in the hosts list shows in full on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const long = '家里 NAS（客厅那台群晖，照片和截图都备份在这里，别动）';
  const nas = { id: 'nas', name: long, url: 'https://nas.example.com/dav', username: 'me', passwordEncrypted: 'mock-encrypted', remotePath: '/picnexus', publicDomain: 'https://nas.example.com/picnexus', publicUrlTemplate: '{domain}/{path}', uniqueFileName: true };
  await openApp(page, { config: { availableServices: ['jd', 'webdav:nas'], enabledServices: ['jd', 'webdav:nas'], webdav_profiles: [nas] } });
  await navItem(page, '图床').click();
  const name = (text: string) => page.locator('.hosts-list__name', { hasText: text });

  await name('京东').hover();
  await expect(name('京东')).not.toHaveAttribute('title');
  await name('家里 NAS').hover();
  await expect(name('家里 NAS')).toHaveAttribute('title', long);
});
