/* global $, $$, browser, beforeEach, describe, it */

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

async function waitForMainLayout() {
  await waitForVisible('#app .app-shell');
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

/**
 * 主导航按钮按名字找：宽窗口是展开的侧栏（按钮文字就是名字），
 * 本机若按 Ctrl+\ 收起过则是图标栏（名字在 aria-label）。两种都认。
 */
async function findNavButton(label) {
  let match;
  await browser.waitUntil(async () => {
    const buttons = await $$('.app-sidebar .app-sidebar__item, .nav-rail .nav-rail__item');
    for (const button of buttons) {
      const name = (await button.getAttribute('aria-label')) || (await button.getText()).trim();
      if (name === label) {
        match = button;
        return true;
      }
    }
    return false;
  }, {
    timeout: 30_000,
    timeoutMsg: `Expected a main navigation button named ${label}`,
  });
  return match;
}

async function openNav(label, expectedSelector) {
  const button = await findNavButton(label);
  await clickElement(button, `nav ${label}`);
  await browser.waitUntil(async () => (await button.getAttribute('aria-current')) === 'page', {
    timeout: 30_000,
    timeoutMsg: `Expected nav ${label} to become the current page`,
  });
  await waitForVisible(expectedSelector);
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

// 只切页面、只看不点：不改设置、不起检测、不联网，跑在真实数据上也不留痕迹
describe('PicNexus real Tauri desktop smoke', () => {
  beforeEach(async () => {
    // 1280 宽：侧栏展开（窄于 1000 才强制收成图标栏）
    await browser.setWindowSize(1280, 900);
    await waitForMainLayout();
  });

  it('starts the real desktop shell and switches between main navigation views', async () => {
    for (const label of ['快传', '图库', '链接健康', '图床', '设置']) {
      await findNavButton(label);
    }

    await openNav('图库', '.gallery');
    await openNav('链接健康', '.health');
    await openNav('图床', '.hosts-list');
    await openNav('设置', '.settings');
    await openNav('快传', '.home');
    await expectRenderable('.home', 3);
  });

  it('opens settings and renders its groups and switches without changing native state', async () => {
    await openNav('设置', '.settings .settings-nav');

    // 7 个分组：通用、上传与链接、快捷键、编辑器与命令行、备份与同步、数据与隐私、关于
    await waitForElementCount('.settings .settings-nav .settings-nav__item', 7);
    await browser.waitUntil(async () => (await $$('.settings [role="switch"]')).length >= 1, {
      timeout: 30_000,
      timeoutMsg: 'Expected the settings page to render at least one switch',
    });
    await expectRenderable('.settings', 20);
  });

  it('opens the gallery and the hosts page with or without saved data', async () => {
    await openNav('图库', '.gallery');
    await expectRenderable('.gallery', 5);

    await openNav('图床', '.hosts-list');
    await waitForVisible('.hosts-list .hosts-list__title');
    await expectRenderable('.hosts-list', 3);
  });

  it('opens 链接健康 without starting a check', async () => {
    await openNav('链接健康', '.health');

    await waitForVisible('.health .health-status');
    await waitForElementCount('.health .tool-card', 3);
    await expectRenderable('.health', 8);
  });
});
