import { test } from '@playwright/test';
import { captureVisualState } from './helpers';
import { VISUAL_STATES } from './states';

const states = VISUAL_STATES['markdown-repair'];

test.describe('markdown repair visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'markdown-repair', state);
    });
  }
});
