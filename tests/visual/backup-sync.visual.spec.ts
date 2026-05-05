import { test } from '@playwright/test';
import { captureVisualState } from './helpers';

const states = [
  'default',
  'local-backing-up',
  'local-success',
  'cloud-syncing',
  'webdav-unavailable',
  'password-dialog',
  'error',
  'webdav-expanded',
  'webdav-testing',
  'overwrite-menu-open',
  'overwrite-confirm-dialog',
  'download-needs-refresh',
  'password-set-dialog',
  'password-change-dialog',
  'password-disable-dialog',
  'restore-password-error',
  'operation-history-empty',
];

test.describe('backup sync visual states', () => {
  for (const state of states) {
    test(state, async ({ page }) => {
      await captureVisualState(page, 'backup-sync', state);
    });
  }
});
