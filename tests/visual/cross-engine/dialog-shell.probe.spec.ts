import { test, expect } from '@playwright/test';
import { gotoVisualState } from '../helpers';
import {
  SHELL, BUTTON, CASES, expandPadding,
} from '../dialogSpec';

/**
 * 弹窗外壳的跨引擎守卫 —— 与 dialog-consistency.visual.spec.ts 分工明确。
 *
 * 那一份用精确值锁死规格（40px 高、'10px 24px' 内边距），只在 chromium 跑；
 * 这一份只断言「引擎无关量」与「不变式」，chromium 与 webkit 都要过。
 * 两份共用 ../dialogSpec.ts 的同一套常量，不会漂移。
 *
 * 为什么不能把那一份直接挂到 webkit 上：
 *
 *   按钮 40px 高 = 10+10 内边距 + 1+1 边框 + 14px 字号在 line-height: normal 下的
 *   18px 行盒。app.css 与 PrimeUIX 的 .p-button 都没设 line-height，浏览器 UA
 *   样式表对 <button> 用 font: 简写把它重置成了 normal —— 而 normal 行盒高度由
 *   引擎自己对字体 ascent/descent 的取整决定，WebKit 会差 1px。
 *
 *   同理，getComputedStyle 的 padding / gap / borderRadius **简写**序列化跨引擎
 *   不保证一致，所以这里一律读长写。
 *
 * 于是按钮高度不锁 40，改锁设计真正要的那件事：底栏按钮下沿对齐、没换行。
 */

/** 目标 40px，留 ±2 给引擎的行盒取整 */
const BUTTON_HEIGHT_RANGE = { min: BUTTON.height - 2, max: BUTTON.height + 2 } as const;

async function readShellMetrics(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('.p-dialog');
    if (!dialog) throw new Error('页面上找不到 .p-dialog');

    const longhandPadding = (selector: string) => {
      const element = dialog.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        top: style.paddingTop,
        right: style.paddingRight,
        bottom: style.paddingBottom,
        left: style.paddingLeft,
      };
    };

    const footerElement = dialog.querySelector('.p-dialog-footer');
    const footerStyle = footerElement ? getComputedStyle(footerElement) : null;
    const dialogStyle = getComputedStyle(dialog);

    return {
      rootClass: dialog.className,
      // 四角分开读：borderRadius 简写的序列化跨引擎不保证一致
      radius: [
        dialogStyle.borderTopLeftRadius,
        dialogStyle.borderTopRightRadius,
        dialogStyle.borderBottomRightRadius,
        dialogStyle.borderBottomLeftRadius,
      ],
      headerPadding: longhandPadding('.p-dialog-header'),
      headerBorderBottom: (() => {
        const header = dialog.querySelector('.p-dialog-header');
        return header ? getComputedStyle(header).borderBottomWidth : null;
      })(),
      contentPadding: longhandPadding('.p-dialog-content'),
      footerPadding: longhandPadding('.p-dialog-footer'),
      footerJustify: footerStyle?.justifyContent ?? null,
      footerRowGap: footerStyle?.rowGap ?? null,
      footerColumnGap: footerStyle?.columnGap ?? null,
      buttons: [...(footerElement?.querySelectorAll('button') ?? [])].map((button) => ({
        label: button.textContent?.trim().slice(0, 20) ?? '',
        // offsetHeight/offsetTop 是布局量，不受入场动画的 scale 影响
        height: (button as HTMLElement).offsetHeight,
        top: (button as HTMLElement).offsetTop,
      })),
    };
  });
}

test.describe('弹窗外壳跨引擎一致性', () => {
  for (const dialogCase of CASES) {
    test(dialogCase.name, async ({ page }) => {
      await gotoVisualState(page, dialogCase.page, dialogCase.state);
      await expect(page.locator('.p-dialog')).toBeVisible();

      const metrics = await readShellMetrics(page);

      // ---- 外壳：全是纯 CSS px，跨引擎必然一致 ----
      expect.soft(metrics.rootClass, '每个弹窗都必须挂上 app-dialog（ConfirmDialog 用 p-confirmdialog）')
        .toMatch(/\b(app-dialog|p-confirmdialog)\b/);
      expect.soft(metrics.radius, '弹窗四角圆角')
        .toEqual(Array(4).fill(SHELL.borderRadius));
      expect.soft(metrics.headerPadding, '标题栏内边距')
        .toEqual(expandPadding(SHELL.headerPadding));
      expect.soft(metrics.headerBorderBottom, '标题栏不画分割线')
        .toBe(SHELL.headerBorderBottom);
      expect.soft(metrics.contentPadding, '正文内边距')
        .toEqual(expandPadding(dialogCase.contentPaddingOverride?.value ?? SHELL.contentPadding));

      if (dialogCase.noFooter) {
        expect.soft(metrics.buttons, '纯展示型弹窗不该有底栏按钮').toHaveLength(0);
        return;
      }

      expect.soft(metrics.footerPadding, '底栏内边距')
        .toEqual(expandPadding(SHELL.footerPadding));
      expect.soft(metrics.footerJustify, '底栏按钮靠右').toBe(SHELL.footerJustify);
      expect.soft(metrics.footerRowGap, '底栏行间距').toBe(SHELL.footerGap);
      expect.soft(metrics.footerColumnGap, '底栏列间距').toBe(SHELL.footerGap);
      expect.soft(metrics.buttons.length, '底栏至少要有一个按钮').toBeGreaterThan(0);

      // ---- 按钮：锁「不变式」而非绝对值 ----
      const heights = [...new Set(metrics.buttons.map((button) => button.height))];
      expect.soft(heights, '底栏按钮高度必须一致（下沿对齐是这套外壳的设计诉求）')
        .toHaveLength(1);
      for (const button of metrics.buttons) {
        expect.soft(button.height, `「${button.label}」按钮高度偏离 ${BUTTON.height}px 过多`)
          .toBeGreaterThanOrEqual(BUTTON_HEIGHT_RANGE.min);
        expect.soft(button.height, `「${button.label}」按钮高度偏离 ${BUTTON.height}px 过多`)
          .toBeLessThanOrEqual(BUTTON_HEIGHT_RANGE.max);
      }

      const tops = [...new Set(metrics.buttons.map((button) => button.top))];
      expect.soft(tops, '底栏按钮不在同一行 —— 空间不够换行了').toHaveLength(1);
    });
  }
});
