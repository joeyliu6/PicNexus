/* global $, $$, browser, describe, expect, it */

async function waitForVisible(selector, timeout = 60_000) {
  const element = await $(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}

async function waitForElementCount(selector, count, timeout = 30_000) {
  await browser.waitUntil(async () => {
    const elements = await $$(selector);
    return elements.length === count;
  }, {
    timeout,
    timeoutMsg: `Expected ${selector} to match ${count} elements`,
  });
}

async function waitForElementCountAtLeast(selector, minCount, timeout = 30_000) {
  await browser.waitUntil(async () => {
    const elements = await $$(selector);
    return elements.length >= minCount;
  }, {
    timeout,
    timeoutMsg: `Expected ${selector} to match at least ${minCount} elements`,
  });
}

async function waitForAnyVisible(selectors, timeout = 30_000) {
  let matchedSelector = '';

  await browser.waitUntil(async () => {
    for (const selector of selectors) {
      const element = await $(selector);
      if (await element.isExisting() && await element.isDisplayed()) {
        matchedSelector = selector;
        return true;
      }
    }

    return false;
  }, {
    timeout,
    timeoutMsg: `Expected one of these selectors to be visible: ${selectors.join(', ')}`,
  });

  return matchedSelector;
}

async function waitForMainLayout() {
  await waitForVisible('#app .main-layout');
  await waitForVisible('.titlebar .app-title');
}

async function expectNavCount(count) {
  await browser.waitUntil(async () => {
    const navButtons = await $$('.sidebar .nav-btn');
    return navButtons.length === count;
  }, {
    timeout: 30_000,
    timeoutMsg: `Expected ${count} main navigation buttons`,
  });
}

async function openNav(index, expectedSelector) {
  await expectNavCount(4);
  const navButtons = await $$('.sidebar .nav-btn');
  await navButtons[index].waitForClickable({ timeout: 30_000 });
  await navButtons[index].click();
  await waitForVisible(expectedSelector);
}

async function clickIndexed(selector, index) {
  const elements = await $$(selector);
  if (elements.length <= index) {
    throw new Error(`Expected ${selector} to have an element at index ${index}, found ${elements.length}`);
  }

  await elements[index].waitForClickable({ timeout: 30_000 });
  await elements[index].click();
}

async function expectRenderable(selector, minVisibleDescendants = 1) {
  await waitForVisible(selector);

  const metrics = await browser.execute((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) return { exists: false };

    const rect = element.getBoundingClientRect();
    const visibleDescendants = Array.from(element.querySelectorAll('*'))
      .filter((node) => {
        const style = window.getComputedStyle(node);
        const nodeRect = node.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && nodeRect.width > 0
          && nodeRect.height > 0;
      })
      .length;

    return {
      exists: true,
      width: rect.width,
      height: rect.height,
      textLength: (element.textContent ?? '').trim().length,
      visibleDescendants,
    };
  }, selector);

  if (
    !metrics.exists
    || metrics.width <= 0
    || metrics.height <= 0
    || metrics.visibleDescendants < minVisibleDescendants
  ) {
    throw new Error(`Expected ${selector} to render visible content, got ${JSON.stringify(metrics)}`);
  }
}

describe('PicNexus real Tauri desktop smoke', () => {
  beforeEach(async () => {
    await browser.setWindowSize(1280, 900);
    await waitForMainLayout();
  });

  it('starts the real desktop shell and switches between main navigation views', async () => {
    const title = await $('.titlebar .app-title');
    await expect(await title.getText()).toBe('PicNexus');

    await expectNavCount(4);
    await waitForVisible('.upload-view');

    await openNav(1, '.history-view');
    await openNav(2, '.link-check-view');
    await openNav(3, '.settings-layout');
    await openNav(0, '.upload-view');
  });

  it('opens settings and renders key controls without changing native state', async () => {
    await openNav(3, '.settings-layout');
    await waitForVisible('.settings-layout .general-settings-panel');

    await waitForElementCount('.settings-layout .settings-sidebar .nav-item', 5);
    await waitForElementCount('.settings-layout .theme-card', 3);
    await waitForElementCountAtLeast('.settings-layout .toggle-row', 5);
    await waitForElementCountAtLeast('.settings-layout .p-toggleswitch', 5);
    await waitForElementCountAtLeast('.settings-layout .format-card', 3);
    await expectRenderable('.settings-layout', 20);
  });

  it('opens history and switches local view shells without relying on saved rows', async () => {
    await openNav(1, '.history-view');

    await waitForVisible('.history-view .dashboard-strip');
    await waitForElementCount('.history-view .dashboard-strip .tab-btn', 3);
    await waitForVisible('.history-view .filter-chip');
    await waitForVisible('.history-view .search-field-input');
    await waitForVisible('.history-view .stat-badge');
    await expectRenderable('.history-view', 10);

    await clickIndexed('.history-view .dashboard-strip .tab-btn', 1);
    await waitForVisible('.history-view .timeline-view');
    await expectRenderable('.history-view .timeline-view');

    await clickIndexed('.history-view .dashboard-strip .tab-btn', 2);
    await waitForVisible('.history-view .favorites-view');
    await expectRenderable('.history-view .favorites-view');

    await clickIndexed('.history-view .dashboard-strip .tab-btn', 0);
    await waitForVisible('.history-view .table-view-container');
  });

  it('opens link maintenance tabs without starting file or network workflows', async () => {
    await openNav(2, '.link-check-view');

    await waitForElementCount('.link-check-view .lc-tab', 3);
    await waitForVisible('.link-check-view .monitor-panel');
    await expectRenderable('.link-check-view', 8);

    await clickIndexed('.link-check-view .lc-tab', 1);
    await waitForVisible('.link-check-view .md-rescue');
    await waitForVisible('.link-check-view .idle-zone');
    await waitForElementCountAtLeast('.link-check-view .subfolder-option-row', 2);
    await expectRenderable('.link-check-view .md-rescue', 6);

    await clickIndexed('.link-check-view .lc-tab', 2);
    await waitForVisible('.link-check-view .migrate-panel');
    await waitForAnyVisible([
      '.link-check-view .migrate-panel .sk-layout',
      '.link-check-view .migrate-panel .split-layout',
      '.link-check-view .migrate-panel .empty-state',
    ]);
    await expectRenderable('.link-check-view .migrate-panel', 3);

    await clickIndexed('.link-check-view .lc-tab', 0);
    await waitForVisible('.link-check-view .monitor-panel');
  });
});
