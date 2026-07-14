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

async function clickElement(element, label) {
  try {
    await element.waitForClickable({ timeout: 5_000 });
    await element.click();
    return;
  } catch {
    // GitHub's Windows WebView2 runner can report visible sidebar buttons as
    // non-clickable even though the app is ready. Fall back to a DOM click
    // after checking the element is genuinely interactable.
  }

  const clicked = await browser.execute((target, targetLabel) => {
    if (!target) {
      return { ok: false, reason: `${targetLabel} was not found` };
    }

    const style = window.getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    if (
      style.display === 'none'
      || style.visibility === 'hidden'
      || style.pointerEvents === 'none'
      || rect.width <= 0
      || rect.height <= 0
      || target.disabled
      || target.getAttribute('aria-disabled') === 'true'
    ) {
      return {
        ok: false,
        reason: `${targetLabel} is not interactable: ${JSON.stringify({
          display: style.display,
          visibility: style.visibility,
          pointerEvents: style.pointerEvents,
          width: rect.width,
          height: rect.height,
          disabled: Boolean(target.disabled),
          ariaDisabled: target.getAttribute('aria-disabled'),
        })}`,
      };
    }

    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    return { ok: true };
  }, element, label);

  if (!clicked.ok) {
    throw new Error(clicked.reason);
  }
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
  await waitForVisible(`.sidebar .nav-btn:nth-child(${index + 1})`);
  await clickElement(navButtons[index], `.sidebar .nav-btn[${index}]`);
  await waitForVisible(expectedSelector);
}

async function clickIndexed(selector, index) {
  const elements = await $$(selector);
  if (elements.length <= index) {
    throw new Error(`Expected ${selector} to have an element at index ${index}, found ${elements.length}`);
  }

  await clickElement(elements[index], `${selector}[${index}]`);
}

async function waitForHistoryTabActive(index, timeout = 30_000) {
  const selector = '.history-view .dashboard-strip .tab-btn';

  await browser.waitUntil(async () => {
    const tabs = await $$(selector);
    if (tabs.length <= index) return false;

    let activeCount = 0;
    let targetIsActive = false;
    for (let tabIndex = 0; tabIndex < tabs.length; tabIndex += 1) {
      const classNames = (await tabs[tabIndex].getAttribute('class')).split(/\s+/);
      if (classNames.includes('active')) {
        activeCount += 1;
        targetIsActive = tabIndex === index || targetIsActive;
      }
    }
    return targetIsActive && activeCount === 1;
  }, {
    timeout,
    timeoutMsg: `Expected ${selector}[${index}] to become active`,
  });
}

async function waitForText(selector, expectedText, timeout = 30_000) {
  await browser.waitUntil(async () => {
    const element = await $(selector);
    return await element.isExisting()
      && await element.isDisplayed()
      && await element.getText() === expectedText;
  }, {
    timeout,
    timeoutMsg: `Expected ${selector} to display ${JSON.stringify(expectedText)}`,
  });
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

async function expectHistorySurface(viewSelector, emptyStateTitle) {
  const emptyStateSelector = '.history-view .history-empty-state-wrapper';
  const matchedSelector = await waitForAnyVisible([
    viewSelector,
    emptyStateSelector,
  ]);

  await expectRenderable(matchedSelector);
  if (matchedSelector === emptyStateSelector) {
    await waitForText(`${emptyStateSelector} .empty-state__title`, emptyStateTitle);
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

  it('opens history and keeps local view switching stable with or without saved rows', async () => {
    await openNav(1, '.history-view');

    await waitForVisible('.history-view .dashboard-strip');
    await waitForElementCount('.history-view .dashboard-strip .tab-btn', 3);
    await waitForVisible('.history-view .filter-chip');
    await waitForVisible('.history-view .search-field-input');
    await waitForVisible('.history-view .stat-badge');
    await expectRenderable('.history-view', 10);

    await waitForHistoryTabActive(0);
    await expectHistorySurface('.history-view .table-view-container', '暂无上传记录');

    await clickIndexed('.history-view .dashboard-strip .tab-btn', 1);
    await waitForHistoryTabActive(1);
    await expectHistorySurface('.history-view .timeline-view', '暂无上传记录');

    await clickIndexed('.history-view .dashboard-strip .tab-btn', 2);
    await waitForHistoryTabActive(2);
    await expectHistorySurface('.history-view .favorites-view', '暂无收藏');

    await clickIndexed('.history-view .dashboard-strip .tab-btn', 0);
    await waitForHistoryTabActive(0);
    await expectHistorySurface('.history-view .table-view-container', '暂无上传记录');
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
