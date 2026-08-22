import type { ClipViolation, EscapeViolation } from './layoutProbe';

/**
 * 有意为之的裁切 / 越界登记表。未登记的一律判失败。
 *
 * 加一条豁免前先问自己：这是 UI 真的想裁掉这块内容，还是布局塌了？
 * 只有前者才写进来，reason 必须说清「裁掉的是什么、为什么可以裁」。
 *
 * ⚠️ 不要拿「WebKit 上就是这样」当理由 —— 那正是这套哨兵要抓的东西。
 *    如果某条只在 layout-webkit 上违规、layout-chromium 是绿的，
 *    先当成 macOS / Linux 上的真实缺陷去查 CSS，确认无法迎合再登记，
 *    并在 reason 里写明差多少 px、为什么视觉上可接受。
 */
export interface Exemption {
  page: string;
  /** '*' 表示该页所有状态 */
  state: string | '*';
  /** 对 layoutProbe 产出的短路径做子串匹配 */
  pathIncludes: string;
  axis: 'x' | 'y' | 'escape';
  reason: string;
}

export const EXEMPTIONS: Exemption[] = [
  {
    page: 'backup-sync',
    state: '*',
    pathIncludes: 'webdav-collapsible',
    axis: 'y',
    reason: 'CollapsibleSettingsCard 折叠态：max-height 收到 0 再用 overflow 裁掉正文，'
      + '「把内容裁没」就是折叠这个交互本身。展开态（webdav-expanded）不在此列，仍然受检。',
  },
  {
    page: 'link-check',
    state: 'empty',
    pathIncludes: 'link-list-wrap',
    axis: 'x',
    reason: '.empty-state-wrapper 有 translate(-40px, -40px) 的视觉居中补偿'
      + '（CheckLinkList.vue 的 --link-check-empty-center-shift-x/y）。'
      + '它是撑满容器的 flex 居中盒，被裁掉的是左上角的空白区，不是内容。',
  },
  {
    page: 'link-check',
    state: 'empty',
    pathIncludes: 'link-list-wrap',
    axis: 'y',
    reason: '同上，纵向那一半的视觉居中补偿。',
  },
  {
    page: 'upload',
    state: '*',
    pathIncludes: 'thumbnail-wrapper',
    axis: 'x',
    reason: 'QueueCard 的 40px 缩略图盒（border-box，含 1px 边框 → 内容区 38px）里，'
      + 'ThumbnailImage 自己的 wrapper 算出 40px，右下各被削 1px。'
      + '削掉的是内层 wrapper 的边框像素，图片本身是 object-fit: cover 裁切的，肉眼无差别。'
      + '两个引擎表现一致，属既有细节问题而非引擎差异；已登记到 docs/TODO.md。',
  },
  {
    page: 'upload',
    state: '*',
    pathIncludes: 'thumbnail-wrapper',
    axis: 'y',
    reason: '同上，纵向那 1px。',
  },
];

/**
 * 忽略的运行时报错。
 *
 * 只登记「harness 结构性产生、与被测代码无关」的那种；任何新面孔都必须让 R1 失败，
 * 否则 WebKit 上最值钱的一条规则就废了。
 */
export const IGNORED_RUNTIME_ERRORS: Array<{ pattern: RegExp; reason: string }> = [
  {
    // 注意匹配的是「错误身份」而不是某个引擎的措辞 —— 同一个 TypeError，
    // Chromium 说 "Cannot read properties of undefined (reading 'invoke')"，
    // WebKit 说 "undefined is not an object (evaluating 'window.__TAURI_INTERNALS__.invoke')"。
    // 按措辞写的规则只会在另一个引擎上全线失效，这本身就是跨引擎的第一课。
    pattern: /__TAURI_INTERNALS__|Cannot read properties of undefined \(reading 'invoke'\)/,
    reason: '视觉 harness 刻意不 alias @tauri-apps/*（tests/visual/vite.config.ts 只有 @ → src），'
      + '而项目的结构化 Logger（src/utils/logger.ts）无条件走 plugin-log → invoke，'
      + '所以每次加载必抛一次。这是 harness 的结构性属性，不是被测代码的缺陷，'
      + '两个引擎表现一致。',
  },
  {
    pattern: /Failed to load resource|net::ERR_/i,
    reason: 'harness 的图片走 page.route 拦截桩，资源加载类报错不代表布局或脚本缺陷。',
  },
];

export function isIgnoredRuntimeError(text: string): boolean {
  return IGNORED_RUNTIME_ERRORS.some((item) => item.pattern.test(text));
}

export function isExemptClip(page: string, state: string, violation: ClipViolation): boolean {
  return EXEMPTIONS.some((item) => item.axis === violation.axis
    && item.page === page
    && (item.state === '*' || item.state === state)
    && violation.path.includes(item.pathIncludes));
}

export function isExemptEscape(page: string, state: string, violation: EscapeViolation): boolean {
  return EXEMPTIONS.some((item) => item.axis === 'escape'
    && item.page === page
    && (item.state === '*' || item.state === state)
    && violation.path.includes(item.pathIncludes));
}

/** 只报告不失败，用于首次分诊与规则调校 */
export const REPORT_ONLY = process.env.PROBE_REPORT === '1';
