import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp } from '../redesign/helpers';

// 页面一直开着（KeepAlive）：切到别的页面再回来，停在原处。浏览器把摘下来的元素滚动位置清零，useKeepScroll 放回去

const nav = (page: Page, name: string) => page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
const scrollTop = (el: Locator) => el.evaluate((node) => node.scrollTop);

/** 用滚轮往下滚一段，等停稳，返回停在哪 */
async function wheelDown(page: Page, el: Locator, dy: number): Promise<number> {
  await el.hover();
  await page.mouse.wheel(0, dy);
  let last = -1;
  await expect.poll(async () => {
    const now = await scrollTop(el);
    const settled = now === last && now > 0;
    last = now;
    return settled;
  }, { intervals: [100] }).toBe(true);
  return last;
}

test('settings is where you left it after visiting another page', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openApp(page, {});
  await nav(page, '设置');
  await page.getByRole('button', { name: '编辑器与命令行' }).click();
  const scroller = page.locator('.settings__scroll');
  const top = await wheelDown(page, scroller, 120);

  await nav(page, '快传');
  await nav(page, '设置');
  await expect.poll(() => scrollTop(scroller)).toBe(top);
});
