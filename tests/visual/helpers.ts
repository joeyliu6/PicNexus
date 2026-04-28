import { expect, type Page } from '@playwright/test';

export async function captureVisualState(page: Page, visualPage: string, state: string): Promise<void> {
  await page.goto(`/?page=${visualPage}&state=${state}`);
  const root = page.locator('[data-visual-root]');
  await expect(root).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(root).toHaveScreenshot(`${visualPage}-${state}.png`, {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
}
