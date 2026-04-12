// Stylelint 配置 — PicNexus (Vue 3 SFC)
// ─────────────────────────────────────
// 把 CLAUDE.md + tokens.md 的全部硬编码禁令转为 error 级规则，
// 提交时 lint-staged 自动拦截（仅影响被改动的文件）。
// 正当例外用行内注释豁免：/* stylelint-disable-next-line <rule> */

/** @type {import('stylelint').Config} */

// ── 共享白名单片段 ────────────────────────────────
const RESET = ['/^inherit$/', '/^unset$/', '/^initial$/', '/^revert$/'];

const COLOR_ALLOWED = [
  '/^var\\(--.+\\)$/',
  ...RESET,
  '/^currentcolor$/i',
  '/^transparent$/',
];

// ── 共享黑名单正则 ────────────────────────────────
const RAW_LENGTH   = '/\\d+\\.?\\d*(px|r?em)/';      // 8px · 1.5rem · .5em
const RAW_TIME     = '/\\d+\\.?\\d*m?s/';             // 200ms · 0.3s · 1s
const RAW_HEX      = '/#[\\da-f]{3,8}/i';             // #fff · #f5f5f5
const RAW_COLOR_FN = '/(?:rgb|hsl)a?\\s*\\(/i';       // rgb() · rgba() · hsl()

export default {
  extends: ['stylelint-config-standard-vue'],
  ignoreFiles: [
    'dist/**',
    'node_modules/**',
    'src-tauri/**',
    'sidecar/**',
  ],
  defaultSeverity: 'error',
  rules: {

    // ══════════════���════════════════════════���═══════════
    //  命名 & 格式覆盖 — 适配项目 BEM 约定
    // ═══════════════════════════════════════════════════

    // BEM: .block-name__element--modifier（允许双下划线 + 双连字符修饰符）
    'selector-class-pattern': [
      '^[a-z][a-z0-9]*(-[a-z0-9]+)*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$',
      { message: '类名应使用 kebab-case 或 BEM（block__element--modifier）' },
    ],

    // Vue scoped 样式中修饰符常导致误报，关闭
    'no-descending-specificity': null,

    // 项目紧凑风格：允许单行多声明
    'declaration-block-single-line-max-declarations': null,

    // ═══════════════════════════════════════════════════
    //  白名单 — 单值属性只允许 var(--*) + CSS 关键字
    // ═══════════════════════════════════════════════════
    'declaration-property-value-allowed-list': [
      {
        // ── 字号 (tokens.md #typography-scale) ──
        'font-size': [
          '/^var\\(--.+\\)$/',
          ...RESET,
          '/^0$/',
          '/^calc\\(.+\\)$/',    // calc/clamp 内部允许硬编码
          '/^clamp\\(.+\\)$/',
        ],

        // ── z-index (tokens.md #z-index-scale) ──
        // 全局层级 → var(--z-*)；局部堆叠 ≤ 20 允许硬编码
        'z-index': [
          '/^var\\(--.+\\)$/',
          '/^auto$/',
          '/^-?(0|[1-9]|1[0-9]|20)$/',
        ],

        // ── 所有颜色属性 ──
        // 匹配 color / background-color / border-*-color / outline-color 等
        // (?!--) 排除 CSS 自定义属性，以免影响主题文件中的变量定义
        '/^(?!--).*color$/': COLOR_ALLOWED,
        'fill':   [...COLOR_ALLOWED, '/^none$/'],
        'stroke': [...COLOR_ALLOWED, '/^none$/'],

        // ── 动效时长 longhand (tokens.md #duration-token) ──
        'transition-duration': ['/^var\\(--.+\\)$/', ...RESET, '/^0s?$/'],
        'animation-duration':  ['/^var\\(--.+\\)$/', ...RESET, '/^0s?$/'],
      },
      {
        message: '禁止硬编码，请使用 CSS 变量 → docs/design/tokens.md',
      },
    ],

    // ═══════════════════════════════════════════════════
    //  黑名单 — 多值/shorthand 禁止裸数值和裸颜色
    // ═══════════════════════════════════════════════════
    'declaration-property-value-disallowed-list': [
      {
        // ── 间距 (tokens.md #spacing-scale) ──
        '/^margin/':  [RAW_LENGTH],
        '/^padding/': [RAW_LENGTH],
        'gap':        [RAW_LENGTH],
        'row-gap':    [RAW_LENGTH],
        'column-gap': [RAW_LENGTH],

        // ── 圆角 (tokens.md #radius-scale) ──
        '/border.*radius/': [RAW_LENGTH],

        // ── 动效 shorthand (tokens.md #duration-token) ──
        'transition': [RAW_TIME],
        'animation':  [RAW_TIME],

        // ── shorthand 里的裸颜色 ──
        'background':                             [RAW_HEX, RAW_COLOR_FN],
        '/^border(-(top|right|bottom|left))?$/':  [RAW_HEX, RAW_COLOR_FN],
        'outline':                                [RAW_HEX, RAW_COLOR_FN],
        'box-shadow':                             [RAW_HEX, RAW_COLOR_FN],
        'text-shadow':                            [RAW_HEX, RAW_COLOR_FN],
      },
      {
        message: '禁止硬编码数值/颜色，请使用 CSS 变量 → docs/design/tokens.md',
      },
    ],
  },
};
