import { test } from '@playwright/test';
import { captureVisualState } from './helpers';

const states = [
  'empty',
  'scanning',
  'bad-link-groups',
  'repair-confirm-dialog',
  'fixing',
  'complete',
  'partial-failed',
];

test.describe('markdown repair visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'markdown-repair', state);
    });
  }
});
