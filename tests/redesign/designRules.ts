import { expect, type Page } from '@playwright/test';

/**
 * 交接说明第 14 节验收清单里能在浏览器里量出来的几条，每张基准图截图前都量一遍：
 * - 字号只出现 20 / 17 / 15 / 13 / 12 / 11，字重只出现 400 / 500 / 600
 * - 800×600 下任何地方都不横向滚动；窗口窄于 1000 时侧栏收成 56 的图标栏
 * - 页面上最多一个主按钮（每个弹窗里也最多一个）
 * - 弹窗宽 520、圆角 16、垂直水平居中、底部按钮高 34
 * - 正常状态不画绿点：除通知的 ✓ 圆点、刚测完连接的结果（P07）外，没有绿色的小圆点
 *
 * 量的是浏览器算出来的样式，所以组件里直接写死、令牌值改错、继承来的字号都拦得住。
 */

/** 设计稿原值、记在 decisions 里的字号例外（花瓣角标 9、日历星期 10），图床图标里代替图标的两个字随图标尺寸走 */
const TYPE_EXEMPT = ['.petals__count', '.upload-calendar__weekday', '.host-icon__mark'];

/** 绿色小圆点只许出现在：通知的 ✓、图床页「测试连接」刚通过的结果标签（P07，设计稿画了，不是常驻状态） */
const GREEN_ALLOWED = ['.pn-toast', '.host-head__pill--ok'];

export async function designRuleViolations(page: Page): Promise<string[]> {
  return page.evaluate(({ typeExempt, greenAllowed }) => {
    const problems: string[] = [];
    const FONT_SIZES = new Set([11, 12, 13, 15, 17, 20]);
    const FONT_WEIGHTS = new Set(['400', '500', '600']);
    const GREENS = new Set(['rgb(22, 163, 74)', 'rgb(34, 197, 94)', 'rgb(20, 122, 58)', 'rgb(91, 208, 138)']);

    // 只给读屏看的元素（1×1 裁掉）不算
    const visible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const label = (el: Element): string => {
      const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
      const text = (el.textContent ?? '').trim().slice(0, 16);
      return `<${el.tagName.toLowerCase()}${cls}>${text ? ` 「${text}」` : ''}`;
    };

    // 字号与字重：有可见文字的元素、输入框
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg') || typeExempt.some((selector) => el.closest(selector))) continue;
      const ownText = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if ((!ownText && !isField) || !visible(el)) continue;
      const style = getComputedStyle(el);
      const size = Number.parseFloat(style.fontSize);
      if (!FONT_SIZES.has(size)) problems.push(`字号 ${style.fontSize}：${label(el)}`);
      if (!FONT_WEIGHTS.has(style.fontWeight)) problems.push(`字重 ${style.fontWeight}：${label(el)}`);
    }

    // 横向滚动
    if (document.documentElement.scrollWidth > window.innerWidth) {
      problems.push(`整页横向滚动：内容宽 ${document.documentElement.scrollWidth}，窗口宽 ${window.innerWidth}`);
    }
    for (const el of document.querySelectorAll('body *')) {
      const overflowX = getComputedStyle(el).overflowX;
      if ((overflowX === 'auto' || overflowX === 'scroll') && visible(el) && el.scrollWidth > el.clientWidth + 1) {
        problems.push(`横向滚动 ${el.scrollWidth} > ${el.clientWidth}：${label(el)}`);
      }
    }

    // 窄窗口侧栏
    if (window.innerWidth < 1000) {
      const rail = document.querySelector('.nav-rail');
      // 系统缩放（如 175%）下量出来会是 56.0000038 这样的小数
      const width = rail ? Math.round(rail.getBoundingClientRect().width) : 0;
      if (width !== 56) problems.push(`窗口宽 ${window.innerWidth} 时侧栏应为 56 的图标栏，实际 ${rail ? width : '没有图标栏'}`);
      if (document.querySelector('.app-sidebar')) problems.push('窗口窄于 1000 时仍显示展开的侧栏');
    }

    // 主按钮：页面一个，每个弹窗各一个
    const primaries = (root: ParentNode) => [...root.querySelectorAll('.pn-button--primary')].filter(visible);
    const pagePrimaries = primaries(document.querySelector('.app-shell') ?? document);
    if (pagePrimaries.length > 1) problems.push(`页面上有 ${pagePrimaries.length} 个主按钮：${pagePrimaries.map(label).join('、')}`);

    // 弹窗
    for (const dialog of document.querySelectorAll('.pn-dialog')) {
      if (!visible(dialog)) continue;
      const rect = dialog.getBoundingClientRect();
      const style = getComputedStyle(dialog);
      const title = label(dialog.querySelector('.pn-dialog__title') ?? dialog);
      if (Math.round(rect.width) !== 520) problems.push(`弹窗宽 ${rect.width}（应为 520）：${title}`);
      if (style.borderTopLeftRadius !== '16px') problems.push(`弹窗圆角 ${style.borderTopLeftRadius}（应为 16px）：${title}`);
      const dx = rect.left + rect.width / 2 - window.innerWidth / 2;
      const dy = rect.top + rect.height / 2 - window.innerHeight / 2;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) problems.push(`弹窗没有居中（偏 ${dx.toFixed(1)}, ${dy.toFixed(1)}）：${title}`);
      for (const button of dialog.querySelectorAll('.pn-dialog__footer button')) {
        if (visible(button) && Math.round(button.getBoundingClientRect().height) !== 34) {
          problems.push(`弹窗按钮高 ${button.getBoundingClientRect().height}（应为 34）：${label(button)}`);
        }
      }
      const inDialog = primaries(dialog);
      if (inDialog.length > 1) problems.push(`弹窗里有 ${inDialog.length} 个主按钮：${title}`);
    }

    // 绿点：12×12 以内、圆形、绿色底的元素只许出现在通知里
    for (const el of document.querySelectorAll('body *')) {
      if (greenAllowed.some((selector) => el.closest(selector)) || !visible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 12 || rect.height > 12) continue;
      const style = getComputedStyle(el);
      if (GREENS.has(style.backgroundColor) && Number.parseFloat(style.borderTopLeftRadius) >= rect.width / 2 - 0.5) {
        problems.push(`正常状态的绿点：${label(el)}`);
      }
    }

    return problems;
  }, { typeExempt: TYPE_EXEMPT, greenAllowed: GREEN_ALLOWED });
}

export async function expectDesignRules(page: Page): Promise<void> {
  expect(await designRuleViolations(page), '交接说明第 14 节验收清单').toEqual([]);
}
