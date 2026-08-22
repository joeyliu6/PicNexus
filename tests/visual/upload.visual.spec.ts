import { test } from '@playwright/test';
import { captureVisualState } from './helpers';
import { VISUAL_STATES } from './states';

const states = VISUAL_STATES.upload;

test.describe('upload visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'upload', state);
    });
  }
});
