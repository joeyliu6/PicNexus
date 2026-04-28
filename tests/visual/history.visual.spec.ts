import { test } from '@playwright/test';
import { captureVisualState } from './helpers';

const states = ['empty', 'populated', 'bulk-select', 'lightbox'];

test.describe('history visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'history', state);
    });
  }
});
