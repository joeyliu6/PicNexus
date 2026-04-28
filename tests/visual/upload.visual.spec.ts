import { test } from '@playwright/test';
import { captureVisualState } from './helpers';

const states = ['empty', 'uploading', 'failed', 'success', 'compression-menu'];

test.describe('upload visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'upload', state);
    });
  }
});
