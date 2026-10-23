import { expect, test, type Page } from '@playwright/test';
import { historyRow, openApp } from '../redesign/helpers';

// 弹窗关掉后焦点回到打开它的地方（交接说明 3.4「焦点与键盘」）：PnDialog 由代码开关、没有 Reka 的触发按钮，
// 不处理的话焦点掉到 body，用键盘的人要从头 Tab。从菜单项打开的，菜单项那时已经没了，回到菜单的按钮上。

const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  return el && el !== document.body ? `${el.className} ${el.textContent?.trim() || el.getAttribute('aria-label')}` : 'body';
});

test('a dialog opened from a menu gives focus back to the menu button', async ({ page }) => {
  await openApp(page, { historyRows: [historyRow(1, '系统架构图.png', 42)] });
  await page.locator('.drop-bar__more').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: /从 URL 下载/ })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.url-dialog__input')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.locator('.pn-dialog')).toHaveCount(0);
  await expect.poll(() => focused(page)).toContain('drop-bar__more');
});

test('a dialog opened by a button gives focus back to that button', async ({ page }) => {
  await openApp(page, { historyRows: [historyRow(1, '系统架构图.png', 42)] });
  await page.getByRole('navigation').getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '上传与链接' }).click();
  const edit = page.locator('.upload__edit');
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.pn-dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.pn-dialog')).toHaveCount(0);
  await expect(edit).toBeFocused();
});
