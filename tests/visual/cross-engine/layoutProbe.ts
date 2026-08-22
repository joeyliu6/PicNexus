import type { Page } from '@playwright/test';

/**
 * 页内布局测量 —— 跨引擎哨兵的取数层。
 *
 * 只读「结构量」，不碰像素：裁切、越界、地标尺寸。这些由 CSS 直接决定，
 * 换渲染引擎不会变；而字体栅格化、抗锯齿会变，所以这里刻意不测任何
 * 与字形绘制有关的东西。
 */

/** 亚像素容差：布局求解的舍入差异，1px 以内不算问题 */
export const SUBPIXEL_TOLERANCE = 1;

export interface ClipViolation {
  /** 裁掉内容的容器，便于人肉定位的短 CSS 路径 */
  path: string;
  axis: 'x' | 'y';
  /** 被切掉的后代，定位时直接看这个 */
  offenders: string[];
  /** 探出容器可视区多少 px（取最严重的那个后代） */
  overflowBy: number;
}

export interface EscapeViolation {
  path: string;
  reason: 'dialog' | 'fixed';
  rect: { top: number; right: number; bottom: number; left: number };
}

export interface LayoutReport {
  /** documentElement.clientWidth/Height —— 不含滚动条，是布局真正可用的尺寸 */
  viewport: { width: number; height: number };
  documentScrollWidth: number;
  shell: { width: number; height: number } | null;
  sidebarWidth: number | null;
  clippedX: ClipViolation[];
  clippedY: ClipViolation[];
  escapedViewport: EscapeViolation[];
}

export async function collectLayoutReport(page: Page): Promise<LayoutReport> {
  return page.evaluate((tolerance) => {
    const shortPath = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      while (node && node !== document.documentElement && parts.length < 4) {
        const classes = [...node.classList]
          // 过滤 Vue / PrimeVue 的过渡态 class，否则同一元素的路径会随时序变化，
          // 豁免表就没法用稳定的 pathIncludes 去匹配它
          .filter((name) => !/-(enter|leave)(-(from|to|active))?$/.test(name))
          .slice(0, 2)
          .join('.');
        parts.unshift(classes ? `${node.tagName.toLowerCase()}.${classes}` : node.tagName.toLowerCase());
        node = node.parentElement;
      }
      return parts.join('>');
    };

    const label = (element: Element): string => {
      const classes = [...element.classList].slice(0, 2).join('.');
      return classes ? `${element.tagName.toLowerCase()}.${classes}` : element.tagName.toLowerCase();
    };

    // img / video / canvas 这类替换元素探出容器，是「裁切盒」的正常形态
    // （封面裁剪、缩略图填充），与省略号截断同一性质，不算布局塌陷
    const REPLACED_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'PICTURE', 'IFRAME', 'OBJECT']);

    // 单行省略号截断本来就要求内容溢出，那是设计意图。用「计算样式满足省略号
    // 三件套」当判据，而不是维护一张选择器名单 —— 名单会随组件增删腐烂，规则不会。
    const isEllipsisTruncation = (style: CSSStyleDeclaration): boolean => style.textOverflow === 'ellipsis'
      && (style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre');

    const isRendered = (element: HTMLElement, style: CSSStyleDeclaration): boolean => style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity) > 0.01
      && element.offsetWidth > 0
      && element.offsetHeight > 0;

    const styleCache = new WeakMap<Element, CSSStyleDeclaration>();
    const styleOf = (element: Element): CSSStyleDeclaration => {
      let cached = styleCache.get(element);
      if (!cached) {
        cached = getComputedStyle(element);
        styleCache.set(element, cached);
      }
      return cached;
    };

    /**
     * 「内容被切掉」的判据 —— 逐个后代往上找它**最近的裁切祖先**。
     *
     * 两条设计要点，都是实测撞出来的：
     *
     * 1. 不用 scrollWidth > clientWidth。那个量把装饰性伪元素（PrimeVue 的
     *    ::before 焦点层）和 transform 图层也算进去，而它们被 overflow:hidden
     *    裁掉恰恰是设计意图 —— 在 Chromium 上就能报出 9 类无法从 DOM 解释的
     *    「溢出」，留着只会变成没人敢动的噪声。
     *
     * 2. 中途遇到可滚动容器就停。滚动列表里滚出视野的内容，用户滚一下就能看到，
     *    不算塌；只有「最近的祖先是 hidden/clip」才是真的看不到了。
     *    不加这条的话，任何一个内部滚动的页面都会把外层 shell 报成裁切。
     */
    const clipsOn = (style: CSSStyleDeclaration, axis: 'x' | 'y'): boolean => {
      const value = axis === 'x' ? style.overflowX : style.overflowY;
      return value === 'hidden' || value === 'clip';
    };
    const scrollsOn = (style: CSSStyleDeclaration, axis: 'x' | 'y'): boolean => {
      const value = axis === 'x' ? style.overflowX : style.overflowY;
      return value === 'auto' || value === 'scroll';
    };

    /**
     * 沿祖先链找「真正会裁掉它」的那一个。
     *
     * 定位元素会跳出祖先的 overflow，这条 CSS 语义必须照做，否则会误报：
     *   - 绝对定位：只有「已定位」的祖先才是它的包含块，static 祖先裁不到它
     *   - 固定定位：包含块是视口，它头顶所有祖先的 overflow 一律无效
     * 实测就是靠这条把 lightbox（position: fixed）里的文字从误报里摘出去的。
     */
    const findClipper = (candidate: HTMLElement, candidateStyle: CSSStyleDeclaration, axis: 'x' | 'y') => {
      let sawAbsolute = candidateStyle.position === 'absolute';
      let ancestor: Element | null = candidate.parentElement;

      while (ancestor && ancestor !== document.documentElement) {
        const ancestorStyle = styleOf(ancestor);
        const positioned = ancestorStyle.position !== 'static';

        if (!sawAbsolute || positioned) {
          if (scrollsOn(ancestorStyle, axis)) return null;
          if (clipsOn(ancestorStyle, axis)) {
            return isEllipsisTruncation(ancestorStyle) ? null : { ancestor, ancestorStyle };
          }
          if (sawAbsolute) sawAbsolute = false;
        }

        if (ancestorStyle.position === 'fixed') return null;
        if (ancestorStyle.position === 'absolute') sawAbsolute = true;
        ancestor = ancestor.parentElement;
      }
      return null;
    };

    const violations = new Map<string, { path: string; axis: 'x' | 'y'; offenders: Map<string, number> }>();

    const record = (container: Element, axis: 'x' | 'y', offender: Element, by: number): void => {
      const path = shortPath(container);
      const key = `${path}|${axis}`;
      let entry = violations.get(key);
      if (!entry) {
        entry = { path, axis, offenders: new Map() };
        violations.set(key, entry);
      }
      const name = label(offender);
      entry.offenders.set(name, Math.max(entry.offenders.get(name) ?? 0, Math.round(by)));
    };

    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const escapedViewport: LayoutReport['escapedViewport'] = [];

    for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
      const style = styleOf(element);
      if (!isRendered(element, style)) continue;

      // fixed 层的越界由 R6 单独管，不参与裁切判定
      if (style.position !== 'fixed' && !REPLACED_TAGS.has(element.tagName)) {
        const rect = element.getBoundingClientRect();
        for (const axis of ['x', 'y'] as const) {
          const clipper = findClipper(element, style, axis);
          if (!clipper) continue;

          const { ancestor, ancestorStyle } = clipper;
          const box = ancestor.getBoundingClientRect();
          const innerLeft = box.left + parseFloat(ancestorStyle.borderLeftWidth || '0');
          const innerTop = box.top + parseFloat(ancestorStyle.borderTopWidth || '0');
          const by = axis === 'x'
            ? Math.max(rect.right - (innerLeft + ancestor.clientWidth), innerLeft - rect.left)
            : Math.max(rect.bottom - (innerTop + ancestor.clientHeight), innerTop - rect.top);
          if (by > tolerance) record(ancestor, axis, element, by);
        }
      }

      // 只查真会「肉眼可见地跑出屏幕」的两类：fixed 定位层与弹窗外壳。
      // 其余元素越界都会被祖先裁掉，归上面的裁切规则管；全量扫会被
      // 虚拟滚动列表和绝对定位过渡层打成筛子。
      const isDialogShell = element.classList.contains('p-dialog');
      if (style.position !== 'fixed' && !isDialogShell) continue;

      const rect = element.getBoundingClientRect();
      const escaped = rect.left < -tolerance
        || rect.top < -tolerance
        || rect.right > viewportWidth + tolerance
        || rect.bottom > viewportHeight + tolerance;
      if (escaped) {
        escapedViewport.push({
          path: shortPath(element),
          reason: isDialogShell ? 'dialog' : 'fixed',
          rect: {
            top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
          },
        });
      }
    }

    const toList = (axis: 'x' | 'y'): ClipViolation[] => [...violations.values()]
      .filter((entry) => entry.axis === axis)
      .map((entry) => ({
        path: entry.path,
        axis,
        offenders: [...entry.offenders.entries()].slice(0, 5).map(([name, by]) => `${name} +${by}`),
        overflowBy: Math.max(...entry.offenders.values()),
      }));

    const shellElement = document.querySelector<HTMLElement>('[data-visual-root]');
    const sidebar = document.querySelector<HTMLElement>('.visual-sidebar');

    return {
      viewport: { width: viewportWidth, height: viewportHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      shell: shellElement ? { width: shellElement.offsetWidth, height: shellElement.offsetHeight } : null,
      sidebarWidth: sidebar ? sidebar.offsetWidth : null,
      clippedX: toList('x'),
      clippedY: toList('y'),
      escapedViewport,
    };
  }, SUBPIXEL_TOLERANCE);
}
