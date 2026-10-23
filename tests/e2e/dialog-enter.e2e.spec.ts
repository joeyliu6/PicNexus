import { expect, test, type Page } from '@playwright/test';
import { openApp } from '../redesign/helpers';

// 弹窗里单行输入框按 Enter = 点主按钮（同系统对话框的默认按钮），按一次只提交一次；
// 用拼音输入法打英文时，Enter 是把字母上屏，这一下归输入法，不算提交（ui-patterns.md「弹窗」）

async function openAddTemplate(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openApp(page, { config: { availableServices: ['weibo'], enabledServices: ['weibo'], services: { weibo: { cookie: 'SUB=x' } } } });
  await page.getByRole('navigation').getByRole('link', { name: '图床', exact: true }).click();
  await page.getByRole('button', { name: '添加模板…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('名称').fill('我的反代');
  await dialog.getByLabel('模板').fill('https://img.example.com/{pid}.jpg');
  return dialog;
}

const added = (page: Page) => page.locator('.host-templates__name', { hasText: '我的反代' });

test('Enter in any field of a dialog presses its main button, once', async ({ page }) => {
  const dialog = await openAddTemplate(page);
  await dialog.getByLabel('名称').press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(added(page)).toHaveCount(1);
});

test('the Enter that puts IME text in place does not submit the dialog', async ({ page }) => {
  const dialog = await openAddTemplate(page);
  // WebKit 报上屏的那一下 Enter：键名照旧是 Enter，keyCode 是 229（输入法在处理）
  await dialog.getByLabel('名称').evaluate((field) => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  await expect(dialog).toBeVisible();
  await expect(added(page)).toHaveCount(0);

  await dialog.getByLabel('名称').press('Enter');
  await expect(added(page)).toHaveCount(1);
});
