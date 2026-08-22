import { test } from '@playwright/test';
import { captureVisualState } from './helpers';
import { VISUAL_STATES } from './states';

const states = VISUAL_STATES['batch-migrate'];

test.describe('batch migrate visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'batch-migrate', state);
    });
  }
});
