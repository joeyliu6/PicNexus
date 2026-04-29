import { test } from '@playwright/test';
import { captureVisualState } from './helpers';

const states = [
  'loading',
  'empty',
  'populated',
  'image-fallback',
  'lightbox',
  'scroll-restored',
  'indicator-visible',
  'fast-scroll',
  'layout-calculating',
  'favorites-only-empty',
  'bulk-select',
  'month-jump-skeleton',
];

test.describe('timeline visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'timeline', state);
    });
  }
});
