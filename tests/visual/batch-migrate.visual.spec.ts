import { test } from '@playwright/test';
import { captureVisualState } from './helpers';

const states = [
  'skeleton',
  'source-selection',
  'target-selection',
  'migrating',
  'paused',
  'partial-failed',
  'skipped-success-mixed',
  'complete',
];

test.describe('batch migrate visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'batch-migrate', state);
    });
  }
});
