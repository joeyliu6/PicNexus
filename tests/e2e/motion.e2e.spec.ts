import { expect, test, type Page } from '@playwright/test';
import { historyRow, openApp } from '../redesign/helpers';

// Logo 动效（交接说明第 10 节，decisions/motion.md）：③ 花瓣逐片点亮、⑥ 完成绽放、⑦ 拖入感应。
// 动效只在真实时刻播；系统开着「减少动态效果」时一律不动（第 14 节最后一条：无位移动画、花瓣不闪烁），
// 状态照样由颜色以外的文字说明。jsdom 不跑 CSS 动画，所以在真浏览器里记下每一次动画 / 过渡的开始。

const SINGLE = ['C:/Pictures/夏日海边.png'];
/** 京东半秒后才传完：先把「上传中」的花瓣画出来，传完时才有变化可播（页面时钟是假的，由测试拨） */
const JD_OK = { upload_to_jd: { urlPrefix: 'https://mock.cdn/jd/', delayMs: 500 } };
/** 有过上传记录：首页是常规布局（有「选择文件」），不是第一次使用 */
const UPLOAD = { historyRows: [historyRow(1, '系统架构图.png', 42)], dialogOpenResult: SINGLE, invokeOverrides: JD_OK };

type Motion = 'reduce' | 'no-preference';

/** 记下页面里每一次 CSS 动画 / 过渡的开始：「类型 名字 元素的 class」 */
async function recordMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { __motionLog: string[] }).__motionLog = log;
    const note = (kind: string, name: string, target: EventTarget | null) => {
      log.push(`${kind} ${name.replace(/-[0-9a-f]{8}$/, '')} ${(target as Element | null)?.getAttribute?.('class') ?? ''}`);
    };
    document.addEventListener('animationstart', (e) => note('animation', e.animationName, e.target), true);
    document.addEventListener('transitionstart', (e) => note('transition', e.propertyName, e.target), true);
  });
}

const motionLog = (page: Page) => page.evaluate(() => (window as unknown as { __motionLog: string[] }).__motionLog);

async function openHome(page: Page, motion: Motion, seed: Parameters<typeof openApp>[1] = {}): Promise<void> {
  await openApp(page, seed);
  await page.emulateMedia({ reducedMotion: motion });
  await recordMotion(page);
}

async function dragIn(page: Page, paths: string[]): Promise<void> {
  await page.evaluate((files) => {
    const state = (window as unknown as { __PICNEXUS_E2E__: { dragDropHandler?: (e: { payload: unknown }) => void } }).__PICNEXUS_E2E__;
    state.dragDropHandler?.({ payload: { type: 'enter', paths: files } });
  }, paths);
}

async function dragOut(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as unknown as { __PICNEXUS_E2E__: { dragDropHandler?: (e: { payload: unknown }) => void } }).__PICNEXUS_E2E__;
    state.dragDropHandler?.({ payload: { type: 'leave' } });
  });
}

/** macOS 的侧栏没有 Logo（那一行留给红绿灯）；WebKit 项目按 macOS 渲染 */
const hasLogo = async (page: Page) => (await page.evaluate(() => document.documentElement.dataset.platform)) !== 'macos';

/** 上传一张：先停在「上传中」，再拨时钟让京东传完、自动复制，最后给浏览器留一帧把刚开始的动画报上来 */
async function uploadAndCopy(page: Page): Promise<void> {
  await page.locator('.drop-bar__pick').click();
  await expect(page.locator('.focus-card')).toHaveAttribute('aria-label', '正在上传');
  await page.clock.runFor(1000);
  await expect(page.locator('.focus-card__pill')).toContainText('已复制');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
});

test('⑦ dragging images in opens the frame, the photos and the logo petals', async ({ page }) => {
  await openHome(page, 'no-preference');
  await dragIn(page, ['C:/a.png']);
  await expect(page.locator('.drop-overlay')).toBeVisible();
  await expect.poll(() => motionLog(page)).toEqual(expect.arrayContaining([
    expect.stringMatching(/^animation drop-overlay-frame drop-overlay__zone/),
    expect.stringMatching(/^animation drop-overlay-fan drop-overlay__photo/),
  ]));
  const logo = page.locator('.app-sidebar .brand-mark');
  if (await hasLogo(page)) {
    await expect.poll(() => motionLog(page)).toEqual(expect.arrayContaining([expect.stringMatching(/^transition transform brand-mark__petal/)]));
    await expect(logo).toHaveClass(/brand-mark--open/);
  } else {
    await expect(logo).toHaveCount(0);
  }

  await dragOut(page);
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
  if (await hasLogo(page)) await expect(logo).not.toHaveClass(/brand-mark--open/);
});

test('⑦ with reduced motion the overlay simply appears and nothing moves', async ({ page }) => {
  await openHome(page, 'reduce');
  await dragIn(page, ['C:/a.png']);
  await expect(page.locator('.drop-overlay')).toContainText('松开上传');
  if (await hasLogo(page)) {
    await expect(page.locator('.app-sidebar .brand-mark')).toHaveClass(/brand-mark--open/);
    await expect(page.locator('.app-sidebar .brand-mark__petal--up')).toHaveCSS('transform', 'none');
  }
  await dragOut(page);
  await expect(page.locator('.drop-overlay')).toHaveCount(0);
  expect(await motionLog(page)).toEqual([]);
});

test('③ ⑥ a finished host lights its petal and the copy blooms once', async ({ page }) => {
  await openHome(page, 'no-preference', UPLOAD);
  await uploadAndCopy(page);
  await expect.poll(() => motionLog(page)).toEqual(expect.arrayContaining([
    expect.stringMatching(/^transition fill(-opacity)? petals__petal petals__petal--ok/),
    expect.stringMatching(/^animation petals-bloom /),
    expect.stringMatching(/^animation petals-ripple petals__ripple/),
  ]));
  expect((await motionLog(page)).filter((entry) => entry.startsWith('animation petals-bloom'))).toHaveLength(1);
});

test('③ ⑥ with reduced motion the petals do not fade or bloom, the words still say copied', async ({ page }) => {
  await openHome(page, 'reduce', UPLOAD);
  await uploadAndCopy(page);
  await expect(page.locator('.focus-card .petals__petal--ok')).toHaveCount(1);
  expect((await motionLog(page)).filter((entry) => /petals|brand-mark|drop-overlay/.test(entry))).toEqual([]);
});

/** 所有转圈共用 pn-base.css 的 pn-spin：转半拍后读它的 transform */
async function spinnerTransform(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const spinner = document.createElement('span');
    spinner.style.cssText = 'display:inline-block;width:12px;height:12px;animation:pn-spin var(--pn-dur-spin) linear infinite';
    document.body.append(spinner);
    await new Promise((resolve) => setTimeout(resolve, 0));
    spinner.getAnimations()[0].currentTime = 200;
    const transform = getComputedStyle(spinner).transform;
    spinner.remove();
    return transform;
  });
}

test('the shared spinner turns, and stands still with reduced motion (LoadingRules)', async ({ page }) => {
  await openHome(page, 'no-preference');
  expect(await spinnerTransform(page)).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await spinnerTransform(page)).toBe('none');
});

// 待拍板 ㉞（选 A）：交接说明 5.3「减少动态效果时位移改淡入」——弹窗、弹出层不再浮起，但淡入照样有时长，
// 不是直接出现（时长令牌归零只管位移类动画）
test('with reduced motion dialogs and popovers fade in instead of popping up', async ({ page }) => {
  await openHome(page, 'reduce', UPLOAD);
  const animation = (selector: string) => page.locator(selector).evaluate((el) => {
    const style = getComputedStyle(el);
    return `${style.animationName} ${style.animationDuration}`;
  });

  // 菜单、弹出层定好位置之前 Reka 把动画写成 none（免得朝错的方向播），所以轮询到动画出现为止
  await page.locator('.home-options__trigger').filter({ hasText: '上传到' }).click();
  await expect.poll(() => animation('.pn-popover')).toBe('pn-layer-fade-in 0.2s');
  await page.keyboard.press('Escape');

  await page.locator('.drop-bar__more').click();
  await expect.poll(() => animation('.pn-menu')).toBe('pn-layer-fade-in 0.2s');
  await page.locator('.pn-menu').getByText('从 URL 下载…').click();
  await expect(page.locator('.pn-dialog')).toBeVisible();
  expect(await animation('.pn-dialog')).toBe('pn-dialog-fade 0.25s');
  expect(await animation('.pn-dialog-overlay')).toBe('pn-dialog-fade 0.25s');

  // 关的时候也只淡出，不缩小
  await page.keyboard.press('Escape');
  await expect(page.locator('.pn-dialog')).toHaveCount(0);
  const closing = (await motionLog(page)).filter((entry) => / pn-dialog(-overlay)?$/.test(entry) && entry.includes('-out'));
  expect(closing.sort()).toEqual(['animation pn-fade-out pn-dialog-overlay', 'animation pn-fade-out pn-layer pn-dialog']);
});

test('without reduced motion dialogs rise into place', async ({ page }) => {
  await openHome(page, 'no-preference', UPLOAD);
  await page.locator('.drop-bar__more').click();
  await page.locator('.pn-menu').getByText('从 URL 下载…').click();
  await expect(page.locator('.pn-dialog')).toBeVisible();
  expect(await page.locator('.pn-dialog').evaluate((el) => `${getComputedStyle(el).animationName} ${getComputedStyle(el).animationDuration}`))
    .toBe('pn-dialog-in 0.25s');
});

// 交接说明 5.3：菜单、下拉、弹出层、气泡出现用「标准 200ms」，退场 ease-out、快 30%（弹窗是舒展 250ms 的 70%）；
// 关的时候先播完淡出才移除，不是一下消失
test('menus slide in, and menus and dialogs fade out before they go', async ({ page }) => {
  await openHome(page, 'no-preference', UPLOAD);
  // 菜单定好位置之前 Reka 把动画写成 none：等进场动画真的开始了再关，不然进场根本来不及播
  const started = async (entry: string, count: number) => {
    await expect.poll(async () => (await motionLog(page)).filter((e) => e === entry).length).toBe(count);
  };
  await page.locator('.drop-bar__more').click();
  await started('animation pn-layer-in pn-layer pn-menu', 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pn-menu')).toHaveCount(0);

  await page.locator('.drop-bar__more').click();
  await started('animation pn-layer-in pn-layer pn-menu', 2);
  await page.locator('.pn-menu').getByText('从 URL 下载…').click();
  await started('animation pn-dialog-in pn-layer pn-dialog', 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pn-dialog')).toHaveCount(0);

  const log = await motionLog(page);
  expect(log.filter((entry) => entry.endsWith(' pn-menu'))).toEqual([
    'animation pn-layer-in pn-layer pn-menu',
    'animation pn-fade-out pn-layer pn-menu',
    'animation pn-layer-in pn-layer pn-menu',
    'animation pn-fade-out pn-layer pn-menu',
  ]);
  expect(log.filter((entry) => / pn-dialog(-overlay)?$/.test(entry)).sort()).toEqual([
    'animation pn-dialog-fade pn-dialog-overlay',
    'animation pn-dialog-in pn-layer pn-dialog',
    'animation pn-dialog-out pn-layer pn-dialog',
    'animation pn-fade-out pn-dialog-overlay',
  ]);
});

// 通知叠放（T05-Toasts）：新的一条加在最下面时，上面几条滑上去，不是瞬移
test('older notifications slide up when a new one arrives', async ({ page }) => {
  await openHome(page, 'no-preference');
  const push = (title: string) => page.evaluate(async (text) => {
    const storePath = '/src/components/pn/toastStore.ts';
    const store: typeof import('../../src/components/pn/toastStore') = await import(/* @vite-ignore */ storePath);
    store.pushToast({ kind: 'success', title: text, life: 60_000 });
  }, title);
  await push('第一条');
  await expect(page.locator('.pn-toast')).toHaveCount(1);
  await push('第二条');
  await expect.poll(() => motionLog(page)).toEqual(expect.arrayContaining([expect.stringMatching(/^transition transform pn-toast .*pn-toast-move/)]));
});
