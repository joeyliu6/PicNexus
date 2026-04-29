import { expect, type Page, type Route } from '@playwright/test';

const fixedNow = new Date('2026-04-28T10:00:00.000Z').getTime();
const visualImageRoute = /https:\/\/(?:img\.example|wsrv\.nl)\//;

function visualImageSvg(label: string): string {
  const safeLabel = label.replace(/[<>&]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#60a5fa"/><stop offset="0.55" stop-color="#22c55e"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="160" height="120" fill="url(#g)"/><circle cx="122" cy="28" r="18" fill="rgba(255,255,255,.38)"/><path d="M0 92 38 55l24 22 24-31 74 48v26H0z" fill="rgba(15,23,42,.4)"/><text x="10" y="24" fill="white" font-family="Arial" font-size="12" font-weight="700">${safeLabel}</text></svg>`;
}

async function fulfillVisualImage(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  const label = url.hostname === 'wsrv.nl'
    ? 'proxy'
    : url.pathname.split('/').filter(Boolean).slice(-2).join('/');

  await route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: visualImageSvg(label || 'fixture'),
  });
}

async function prepareVisualPage(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(visualImageRoute, fulfillVisualImage);
  await page.addInitScript((now) => {
    Date.now = () => now;
  }, fixedNow);
}

async function waitForVisualAssets(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;

    const root = document.querySelector('[data-visual-root]');
    if (!root) return;

    const images = [...root.querySelectorAll('img')];
    await Promise.all(images.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });
    }));

    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function openStatefulUi(page: Page, visualPage: string, state: string): Promise<void> {
  if (visualPage === 'history' && state === 'service-menu') {
    await page.locator('.visual-history .service-filter .filter-chip').click();
  }
  if (visualPage === 'favorites' && state === 'scroll-middle') {
    await page.locator('.visual-favorites-scroll').evaluate((element) => {
      element.scrollTop = 520;
    });
  }
  if (visualPage === 'timeline' && state === 'scroll-restored') {
    await page.locator('.visual-timeline-scroll').evaluate((element) => {
      element.scrollTop = 360;
    });
  }
  if (visualPage === 'timeline' && state === 'indicator-visible') {
    await expect(page.locator('.visual-timeline-indicator-shell .timeline-indicator')).toBeVisible();
  }
  if (visualPage === 'backup-sync' && (state === 'webdav-expanded' || state === 'webdav-testing')) {
    await page.locator('.visual-backup-sync .webdav-collapsible .card-header').click();
    await expect(page.locator('.visual-backup-sync .webdav-collapsible .simple-form')).toBeVisible();
  }
  if (visualPage === 'backup-sync' && state === 'overwrite-menu-open') {
    await page.locator('.visual-backup-sync .dropdown-wrapper button').first().click();
    await expect(page.locator('.visual-backup-sync .dropdown-menu')).toBeVisible();
  }
  if (visualPage === 'backup-sync' && state === 'overwrite-confirm-dialog') {
    await expect(page.locator('.p-confirmdialog')).toBeVisible();
  }
  if (visualPage === 'backup-sync' && ['password-dialog', 'password-set-dialog', 'restore-password-error'].includes(state)) {
    await expect(page.locator('.p-dialog')).toBeVisible();
  }
  if (visualPage === 'backup-sync' && state === 'restore-password-error') {
    await expect(page.locator('.backup-password-dialog .error-box')).toBeVisible();
  }
  if (visualPage === 'markdown-repair' && state === 'repair-confirm-dialog') {
    await page.locator('.visual-native-body .bottom-actions .btn-primary').click();
    await expect(page.locator('.p-dialog')).toBeVisible();
  }
}

export async function captureVisualState(page: Page, visualPage: string, state: string): Promise<void> {
  await prepareVisualPage(page);
  await page.goto(`/?page=${visualPage}&state=${state}`);
  const root = page.locator('[data-visual-root]');
  await expect(root).toBeVisible();
  await expect(root).toHaveAttribute('data-visual-ready', 'true');
  await openStatefulUi(page, visualPage, state);
  await waitForVisualAssets(page);
  const screenshotTarget = (visualPage === 'markdown-repair' && state === 'repair-confirm-dialog')
    || (visualPage === 'backup-sync' && ['password-dialog', 'password-set-dialog', 'restore-password-error', 'overwrite-confirm-dialog'].includes(state))
    ? page
    : root;
  await expect(screenshotTarget).toHaveScreenshot(`${visualPage}-${state}.png`, {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
}
