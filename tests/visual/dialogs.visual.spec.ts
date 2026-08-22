import { test } from '@playwright/test';
import { captureVisualState } from './helpers';
import { VISUAL_STATES } from './states';

/**
 * 独立弹窗的视觉回归：这些弹窗不隶属于任何业务页面，
 * 由 harness 的 `dialogs` 页集中摆出来拍照。
 *
 * 覆盖目的是守住「全项目弹窗外壳统一」这条线 —— 外壳规格定义在
 * src/styles/app.css 第 3 节，任何一个弹窗脱队都会在这里显形。
 *
 * 未覆盖：CompressionPreviewDialog（打开即调用 Tauri 文件选择器，
 * 需要 e2e 那套 mock 才能驱动，见 tests/e2e/mocks/dialog.ts）。
 */
const states = VISUAL_STATES.dialogs;

test.describe('dialog visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'dialogs', state);
    });
  }
});
