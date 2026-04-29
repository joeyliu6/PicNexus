import { test } from '@playwright/test';
import { captureVisualState } from './helpers';

const states = [
  'empty',
  'populated',
  'bulk-select',
  'lightbox',
  'image-fallback',
  'initial-loading',
  'loading-more',
  'no-results',
  'scroll-middle',
  'mixed-services',
];

test.describe('favorites visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'favorites', state);
    });
  }
});
