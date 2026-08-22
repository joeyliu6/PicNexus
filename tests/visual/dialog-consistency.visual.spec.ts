import { test, expect, type Page } from '@playwright/test';
import { SHELL, BUTTON, CASES } from './dialogSpec';

/**
 * 弹窗规格一致性守卫 —— 直接量尺寸，不走像素比对。
 *
 * 为什么需要它：像素快照有 1% 容差（playwright.config.ts 的 maxDiffPixelRatio），
 * 一个按钮从 34px 变成 40px 只占整页 0.4%，快照会"通过"。而弹窗统一恰恰
 * 靠的就是这些数值，所以这里逐项断言，任何一个弹窗脱队都会直接失败。
 *
 * 规格定义在 src/styles/app.css 第 3 节「弹窗统一外壳」，常量在 ./dialogSpec.ts。
 *
 * 这份**只在 chromium 跑**（desktop-light / desktop-dark）：它用精确值锁死规格，
 * 而 40px 按钮高来自 line-height: normal 的字体行盒，跨引擎会差 1px。
 * 跨引擎那半边由 cross-engine/dialog-shell.probe.spec.ts 负责，两者共用同一份常量。
 */

async function readDialogMetrics(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('.p-dialog');
    if (!dialog) throw new Error('页面上找不到 .p-dialog');

    const styleOf = (selector: string) => {
      const element = dialog.querySelector(selector);
      return element ? getComputedStyle(element) : null;
    };

    const header = styleOf('.p-dialog-header');
    const content = styleOf('.p-dialog-content');
    const footer = styleOf('.p-dialog-footer');
    const footerElement = dialog.querySelector('.p-dialog-footer');

    return {
      rootClass: dialog.className,
      borderRadius: getComputedStyle(dialog).borderRadius,
      headerPadding: header?.padding ?? null,
      headerBorderBottom: header?.borderBottomWidth ?? null,
      contentPadding: content?.padding ?? null,
      footerPadding: footer?.padding ?? null,
      footerJustify: footer?.justifyContent ?? null,
      footerGap: footer?.gap ?? null,
      buttons: [...(footerElement?.querySelectorAll('button') ?? [])].map((button) => {
        const style = getComputedStyle(button);
        return {
          label: button.textContent?.trim().slice(0, 20) ?? '',
          // 用 offsetHeight 而非 getBoundingClientRect：后者会算进弹窗入场动画的
          // scale 变换，量到 38 而不是 40，导致断言随时序抖动
          height: (button as HTMLElement).offsetHeight,
          borderRadius: style.borderRadius,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          padding: style.padding,
        };
      }),
    };
  });
}

test.describe('弹窗规格一致性', () => {
  for (const dialogCase of CASES) {
    test(dialogCase.name, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/?page=${dialogCase.page}&state=${dialogCase.state}`);
      await expect(page.locator('[data-visual-root]')).toHaveAttribute('data-visual-ready', 'true');
      if (dialogCase.open) await dialogCase.open(page);
      await expect(page.locator('.p-dialog')).toBeVisible();

      const metrics = await readDialogMetrics(page);

      // ---- 外壳 ----
      expect(metrics.rootClass, '每个弹窗都必须挂上 app-dialog（ConfirmDialog 用 p-confirmdialog）')
        .toMatch(/\b(app-dialog|p-confirmdialog)\b/);
      expect(metrics.borderRadius).toBe(SHELL.borderRadius);
      expect(metrics.headerPadding).toBe(SHELL.headerPadding);
      expect(metrics.headerBorderBottom).toBe(SHELL.headerBorderBottom);
      expect(metrics.contentPadding)
        .toBe(dialogCase.contentPaddingOverride?.value ?? SHELL.contentPadding);

      // ---- 底栏与按钮 ----
      if (dialogCase.noFooter) {
        expect(metrics.buttons).toHaveLength(0);
        return;
      }

      expect(metrics.footerPadding).toBe(SHELL.footerPadding);
      expect(metrics.footerJustify).toBe(SHELL.footerJustify);
      expect(metrics.footerGap).toBe(SHELL.footerGap);
      expect(metrics.buttons.length).toBeGreaterThan(0);

      for (const button of metrics.buttons) {
        expect(button.height, `「${button.label}」按钮高度`).toBe(BUTTON.height);
        expect(button.borderRadius, `「${button.label}」按钮圆角`).toBe(BUTTON.borderRadius);
        expect(button.fontSize, `「${button.label}」按钮字号`).toBe(BUTTON.fontSize);
        expect(button.fontWeight, `「${button.label}」按钮字重`).toBe(BUTTON.fontWeight);
        expect(button.padding, `「${button.label}」按钮内边距`).toBe(BUTTON.padding);
      }
    });
  }
});
