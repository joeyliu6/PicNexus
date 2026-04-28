/* global $, $$, browser, describe, expect, it */

async function waitForVisible(selector, timeout = 60_000) {
  const element = await $(selector);
  await element.waitForDisplayed({ timeout });
  return element;
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
  const navButtons = await $$('.sidebar .nav-btn');
  await navButtons[index].click();
  await waitForVisible(expectedSelector);
}

describe('PicNexus real Tauri desktop smoke', () => {
  it('starts the real desktop shell and switches between main navigation views', async () => {
    await browser.setWindowSize(1280, 900);
    await waitForMainLayout();

    const title = await $('.titlebar .app-title');
    await expect(await title.getText()).toBe('PicNexus');

    await expectNavCount(4);
    await waitForVisible('.upload-view');

    await openNav(1, '.history-view');
    await openNav(2, '.link-check-view');
    await openNav(3, '.settings-layout');
    await openNav(0, '.upload-view');
  });
});
