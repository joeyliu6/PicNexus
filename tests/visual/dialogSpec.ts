import type { Page } from '@playwright/test';

/**
 * 弹窗统一外壳的规格 —— 全项目唯一标准值。
 *
 * 规格定义在 src/styles/app.css 第 3 节「弹窗统一外壳」，这里是它的可执行版本。
 * 改规格时同步改这里。
 *
 * 两份消费者，分工不同：
 *   dialog-consistency.visual.spec.ts  用精确值锁死规格，只在 chromium 跑
 *   cross-engine/dialog-shell.probe.*  只断言引擎无关量，chromium 与 webkit 都要过
 */

/** 全项目弹窗外壳的唯一标准值 */
export const SHELL = {
  borderRadius: '16px', // var(--radius-xl)
  headerPadding: '24px 24px 0px', // var(--space-xl) 三面
  headerBorderBottom: '0px', // 标题栏不画分割线
  contentPadding: '20px 24px 24px',
  footerPadding: '8px 24px 24px',
  footerJustify: 'flex-end',
  footerGap: '12px', // var(--space-md)
} as const;

/** 底栏按钮的唯一标准值 */
export const BUTTON = {
  height: 40,
  borderRadius: '8px', // var(--radius-md)
  fontSize: '14px', // var(--text-base)
  fontWeight: '600', // var(--weight-semibold)
  padding: '10px 24px', // var(--space-sm-md) var(--space-xl)
} as const;

export interface DialogCase {
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

export const CASES: DialogCase[] = [
  {
    name: 'MdRepairDialog 链接修复策略',
    page: 'markdown-repair',
    state: 'repair-confirm-dialog',
    open: async (page) => {
      await page.locator('.visual-native-body .bottom-actions .btn-primary').click();
    },
  },
  {
    name: 'BackupPasswordDialog 设置密码', page: 'backup-sync', state: 'password-set-dialog',
  },
  {
    name: 'BackupPasswordDialog 修改密码', page: 'backup-sync', state: 'password-change-dialog',
  },
  {
    name: 'BackupPasswordDialog 关闭密码', page: 'backup-sync', state: 'password-disable-dialog',
  },
  {
    name: 'BackupPasswordDialog 恢复失败', page: 'backup-sync', state: 'restore-password-error',
  },
  {
    name: 'ConfirmDialog 覆盖确认', page: 'backup-sync', state: 'overwrite-confirm-dialog',
  },
  {
    name: 'UrlDownloadDialog 空闲', page: 'dialogs', state: 'url-download-idle',
  },
  {
    name: 'UrlDownloadDialog 下载中', page: 'dialogs', state: 'url-download-downloading',
  },
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

/**
 * 把 padding 简写摊成四条长写。
 *
 * 为什么需要：getComputedStyle 的**简写**序列化跨引擎不保证一致，
 * 有的引擎对某些简写直接返回空串。长写是纯 CSS px，两个引擎必然一样。
 */
export function expandPadding(shorthand: string): {
  top: string; right: string; bottom: string; left: string;
} {
  const parts = shorthand.trim().split(/\s+/);
  const [top, right = top, bottom = top, left = right] = parts;
  return {
    top, right, bottom, left,
  };
}
