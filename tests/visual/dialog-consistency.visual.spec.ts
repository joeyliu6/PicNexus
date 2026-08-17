import { test, expect, type Page } from '@playwright/test';

/**
 * 弹窗规格一致性守卫 —— 直接量尺寸，不走像素比对。
 *
 * 为什么需要它：像素快照有 1% 容差（playwright.config.ts 的 maxDiffPixelRatio），
 * 一个按钮从 34px 变成 40px 只占整页 0.4%，快照会"通过"。而弹窗统一恰恰
 * 靠的就是这些数值，所以这里逐项断言，任何一个弹窗脱队都会直接失败。
 *
 * 规格定义在 src/styles/app.css 第 3 节「弹窗统一外壳」。
 * 改规格时请同步改这里的常量 —— 这份断言就是规格的可执行版本。
 */

/** 全项目弹窗外壳的唯一标准值 */
const SHELL = {
  borderRadius: '16px',            // var(--radius-xl)
  headerPadding: '24px 24px 0px',  // var(--space-xl) 三面
  headerBorderBottom: '0px',       // 标题栏不画分割线
  contentPadding: '20px 24px 24px',
  footerPadding: '8px 24px 24px',
  footerJustify: 'flex-end',
  footerGap: '12px',               // var(--space-md)
} as const;

/** 底栏按钮的唯一标准值 */
const BUTTON = {
  height: 40,
  borderRadius: '8px',             // var(--radius-md)
  fontSize: '14px',                // var(--text-base)
  fontWeight: '600',               // var(--weight-semibold)
  padding: '10px 24px',            // var(--space-sm-md) var(--space-xl)
} as const;

interface DialogCase {
  name: string;
  page: string;
  state: string;
  /** 打开弹窗需要的额外交互 */
  open?: (page: Page) => Promise<void>;
  /** 该弹窗没有底栏按钮（如纯展示型） */
  noFooter?: boolean;
  /** 有意为之的外壳差异，写明原因；未登记的差异一律判失败 */
  contentPaddingOverride?: { value: string; reason: string };
}

const CASES: DialogCase[] = [
  {
    name: 'MdRepairDialog 链接修复策略',
    page: 'markdown-repair',
    state: 'repair-confirm-dialog',
    open: async (page) => {
      await page.locator('.visual-native-body .bottom-actions .btn-primary').click();
    },
  },
  { name: 'BackupPasswordDialog 设置密码', page: 'backup-sync', state: 'password-set-dialog' },
  { name: 'BackupPasswordDialog 修改密码', page: 'backup-sync', state: 'password-change-dialog' },
  { name: 'BackupPasswordDialog 关闭密码', page: 'backup-sync', state: 'password-disable-dialog' },
  { name: 'BackupPasswordDialog 恢复失败', page: 'backup-sync', state: 'restore-password-error' },
  { name: 'ConfirmDialog 覆盖确认', page: 'backup-sync', state: 'overwrite-confirm-dialog' },
  { name: 'UrlDownloadDialog 空闲', page: 'dialogs', state: 'url-download-idle' },
  { name: 'UrlDownloadDialog 下载中', page: 'dialogs', state: 'url-download-downloading' },
  {
    name: 'WechatQrDialog 公众号',
    page: 'dialogs',
    state: 'wechat-qr',
    noFooter: true,
    contentPaddingOverride: {
      value: '8px 24px 24px',
      reason: '自定义 header 已含图标块，标题与二维码之间不需要默认的 20px 上留白',
    },
  },
  {
    name: 'OnboardingDialog 步骤 1',
    page: 'dialogs',
    state: 'onboarding-welcome',
    contentPaddingOverride: { value: '0px 24px', reason: '引导正文自带上下留白且需自行滚动' },
  },
  {
    name: 'OnboardingDialog 步骤 3',
    page: 'dialogs',
    state: 'onboarding-services',
    contentPaddingOverride: { value: '0px 24px', reason: '引导正文自带上下留白且需自行滚动' },
  },
];

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
