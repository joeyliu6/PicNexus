import { test, expect } from '@playwright/test';
import { ALL_VISUAL_STATES } from '../states';
import { gotoVisualState } from '../helpers';
import { collectLayoutReport, SUBPIXEL_TOLERANCE } from './layoutProbe';
import {
  isExemptClip,
  isExemptEscape,
  isIgnoredRuntimeError,
  REPORT_ONLY,
} from './exemptions';

/**
 * 跨引擎布局哨兵 —— 不比像素，只断言「结构不塌」。
 *
 * 为什么不给 WebKit 建像素基准：跨引擎的字体栅格化与抗锯齿差异必然超过
 * playwright.config.ts 里 maxDiffPixelRatio: 0.01 的容差，做成门禁只会持续误报；
 * 放宽到能容忍差异之后，又抓不到任何真实回归。而且像素比对回答的是
 * 「两张照片一样吗」，我们要问的是「排版会不会塌」。
 *
 * 这里断言的都是由 CSS 直接决定的绝对不变式（裁切 / 溢出 / 越界 / 地标尺寸），
 * 换引擎不会变，因此零基准图、跨引擎稳定。范式来自上一层的
 * dialog-consistency.visual.spec.ts —— 直接量尺寸，不走像素比对。
 *
 * 跑在两个 project 上：
 *   layout-chromium 是参照引擎，保证 exemptions.ts 里的豁免是诚实的
 *                   （分得清「WebKit 的锅」还是「本来就有的缺陷」）
 *   layout-webkit   是目标，近似 macOS 的 WKWebView 与 Linux 的 WebKitGTK
 *
 * 它抓不到什么（字体、老版本 WebKit、原生控件、DPI），见
 * docs/reference/guides/testing-guide.md 的「跨引擎层的局限」。
 */

/** harness 侧边栏固定宽度，86 个状态实测一致 */
const SIDEBAR_WIDTH = 80;

for (const { page: visualPage, state } of ALL_VISUAL_STATES) {
  test(`${visualPage} / ${state}`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => {
      // 带上首个栈帧：光有 message 无法定位是哪个组件抛的
      const frame = (error.stack ?? '').split(/\r?\n/)[1]?.trim() ?? '';
      runtimeErrors.push(`pageerror: ${error.message}${frame ? ` @ ${frame}` : ''}`);
    });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      runtimeErrors.push(`console.error: ${message.text()}`);
    });

    await gotoVisualState(page, visualPage, state);

    // 弹窗被 Teleport 到 body 之外，waitForVisualAssets 只等 [data-visual-root] 里的图片，
    // 弹窗内的图片得在这里单独等 —— 没加载完的图会让盒子高度失真
    const dialogImages = page.locator('.p-dialog img');
    const dialogImageCount = await dialogImages.count();
    for (let index = 0; index < dialogImageCount; index += 1) {
      await expect(dialogImages.nth(index)).toHaveJSProperty('complete', true);
    }

    const report = await collectLayoutReport(page);

    const unexpectedErrors = runtimeErrors.filter((text) => !isIgnoredRuntimeError(text));
    const unexpectedX = report.clippedX.filter((item) => !isExemptClip(visualPage, state, item));
    const unexpectedY = report.clippedY.filter((item) => !isExemptClip(visualPage, state, item));
    const unexpectedEscape = report.escapedViewport
      .filter((item) => !isExemptEscape(visualPage, state, item));

    if (REPORT_ONLY) {
      process.stdout.write(`\nPROBE ${visualPage}/${state} ${JSON.stringify({
        viewport: report.viewport,
        shell: report.shell,
        sidebarWidth: report.sidebarWidth,
        documentScrollWidth: report.documentScrollWidth,
        runtimeErrors: unexpectedErrors,
        clippedX: unexpectedX,
        clippedY: unexpectedY,
        escapedViewport: unexpectedEscape,
      })}\n`);
      return;
    }

    // 七条规则一律用 soft 断言：一个状态要么全绿，要么一次把所有问题报全。
    // 用硬断言的话 R1 一红就看不到 R5/R7 —— 跨引擎分诊最耗时的就是反复重跑。

    // ---- R1 无运行时报错 ----
    // WebKit 上最值钱的一条：JS API 缺失、语法不支持会在这里直接现形
    expect.soft(unexpectedErrors, '页面出现运行时错误').toEqual([]);

    // ---- R2 外壳填满视口（.visual-shell 是 100vw / 100vh）----
    expect.soft(report.shell, '找不到 [data-visual-root]').not.toBeNull();
    if (report.shell) {
      expect.soft(Math.abs(report.shell.width - report.viewport.width), '外壳宽度偏离视口')
        .toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
      expect.soft(Math.abs(report.shell.height - report.viewport.height), '外壳高度偏离视口')
        .toBeLessThanOrEqual(SUBPIXEL_TOLERANCE);
    }

    // ---- R3 文档不横向溢出 ----
    // 全仓没有任何 overflow-x: auto/scroll，出现横滚一律是缺陷
    expect.soft(report.documentScrollWidth, '文档出现横向滚动')
      .toBeLessThanOrEqual(report.viewport.width + SUBPIXEL_TOLERANCE);

    // ---- R4 地标尺寸 ----
    // 纯 px，与字体无关，所以可以绝对断言；比维护一张「关键元素名单」零维护
    expect.soft(report.sidebarWidth, 'harness 侧边栏宽度').toBe(SIDEBAR_WIDTH);

    // ---- R5 内容被横向裁掉 ----
    expect.soft(unexpectedX, '内容被横向裁切').toEqual([]);

    // ---- R6 弹窗 / fixed 层跑出视口 ----
    expect.soft(unexpectedEscape, '元素越出视口').toEqual([]);

    // ---- R7 内容被纵向裁掉 ----
    // 价值最高的一条：行高在两个引擎下差 1px，固定高度的盒子里最后一行就没了
    expect.soft(unexpectedY, '内容被纵向裁切（文字被切掉的典型症状）').toEqual([]);
  });
}
