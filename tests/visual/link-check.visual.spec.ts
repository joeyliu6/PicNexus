import { test } from '@playwright/test';
import { captureVisualState } from './helpers';

const states = [
  'empty',
  'skeleton',
  'mixed-results',
  'phase2-loading',
  'service-menu',
  'overflow-menu',
  'recheck-result',
  'running',
  'paused',
  'bulk-select',
];

test.describe('link check visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'link-check', state);
    });
  }
});
