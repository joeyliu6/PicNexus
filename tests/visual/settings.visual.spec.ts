import { test } from '@playwright/test';
import { captureVisualState } from './helpers';

const states = ['default', 'custom-template', 'connection-testing', 'error', 'dark-theme'];

test.describe('settings visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'settings', state);
    });
  }
});
