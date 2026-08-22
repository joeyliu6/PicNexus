import { test } from '@playwright/test';
import { captureVisualState } from './helpers';
import { VISUAL_STATES } from './states';

const states = VISUAL_STATES.history;

test.describe('history visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'history', state);
    });
  }
});
