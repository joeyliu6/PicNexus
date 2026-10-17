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
  settings: [
    'default',
    'custom-template',
    'connection-testing',
    'error',
    'dark-theme',
  ],
  dialogs: [
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
