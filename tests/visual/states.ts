/**
 * harness 状态清单的唯一真相源。
 *
 * 像素快照 spec（*.visual.spec.ts）与跨引擎布局哨兵（cross-engine/*.probe.spec.ts）
 * 共用这一份。分成两份的话，新增状态时很容易只加了截图、漏了哨兵，
 * 而哨兵恰恰是唯一能替我们看 macOS / Linux 的东西。
 *
 * 新增状态的步骤：
 *   1. 在 harness（tests/visual/harness/src/VisualHarness.vue）里实现该状态
 *   2. 在下面对应的页面数组里加一项
 *   3. 跑 `npm run test:visual:update` 生成像素基准
 *   4. 跑 `npm run test:visual -- --project=layout-chromium` 确认哨兵不报警
 */
export const VISUAL_STATES = {
  upload: [
    'empty',
    'no-services',
    'uploading',
    'failed',
    'success',
    'compression-menu',
  ],
  history: [
    'empty',
    'populated',
    'service-menu',
    'bulk-select',
    'lightbox',
  ],
  favorites: [
    'empty',
    'populated',
    'bulk-select',
    'lightbox',
    'image-fallback',
    'initial-loading',
    'loading-more',
    'no-results',
    'scroll-middle',
    'mixed-services',
  ],
  timeline: [
    'loading',
    'empty',
    'populated',
    'image-fallback',
    'lightbox',
    'scroll-restored',
    'indicator-visible',
    'fast-scroll',
    'layout-calculating',
    'favorites-only-empty',
    'bulk-select',
    'month-jump-skeleton',
  ],
  'backup-sync': [
    'default',
    'local-backing-up',
    'local-success',
    'cloud-syncing',
    'webdav-unavailable',
    'password-dialog',
    'error',
    'webdav-expanded',
    'webdav-testing',
    'overwrite-menu-open',
    'overwrite-confirm-dialog',
    'download-needs-refresh',
    'password-set-dialog',
    'password-change-dialog',
    'password-disable-dialog',
    'restore-password-error',
    'operation-history-empty',
  ],
  'link-check': [
    'empty',
    'skeleton',
    'mixed-results',
    'phase2-loading',
    'service-menu',
    'overflow-menu',
    'recheck-result',
    'running',
    'paused',
    'bulk-select',
  ],
  'markdown-repair': [
    'empty',
    'scanning',
    'bad-link-groups',
    'repair-confirm-dialog',
    'fixing',
    'complete',
    'partial-failed',
  ],
  'batch-migrate': [
    'skeleton',
    'source-selection',
    'target-selection',
    'migrating',
    'paused',
    'partial-failed',
    'skipped-success-mixed',
    'complete',
  ],
  settings: [
    'default',
    'custom-template',
    'connection-testing',
    'error',
    'dark-theme',
  ],
  dialogs: [
    'url-download-idle',
    'url-download-downloading',
    'wechat-qr',
    'onboarding-welcome',
    'onboarding-upload',
    'onboarding-services',
  ],
} as const satisfies Record<string, readonly string[]>;

export type VisualPageName = keyof typeof VISUAL_STATES;

/** 拍平成 { page, state } 列表，供哨兵逐个遍历 */
export const ALL_VISUAL_STATES: ReadonlyArray<{ page: VisualPageName; state: string }> =
  Object.entries(VISUAL_STATES).flatMap(([page, states]) =>
    states.map((state) => ({ page: page as VisualPageName, state })));
