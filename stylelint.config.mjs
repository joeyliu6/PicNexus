// Stylelint config for PicNexus (Vue 3 SFC)
// 官方预设: https://github.com/ota-meshi/stylelint-config-standard-vue
// 策略：只把 CLAUDE.md 明文硬禁令（font-size / z-index 必须用 CSS 变量）配成规则，
// 其余走 stylelint-config-standard-vue 默认。第一阶段 defaultSeverity=warning 不 block。

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard-vue'],
  ignoreFiles: [
    'dist/**',
    'node_modules/**',
    'src-tauri/**',
    'sidecar/**',
  ],
  defaultSeverity: 'warning',
  rules: {
    // CLAUDE.md 硬禁令：字号必须用 CSS 变量
    // 允许: var(--*), inherit, unset, 0（少数场景下 0px 无单位）
    'declaration-property-value-allowed-list': {
      'font-size': [
        '/^var\\(--.+\\)$/',
        '/^inherit$/',
        '/^unset$/',
        '/^0$/',
      ],
      // z-index 分两类：
      // 1) 全局层级必须用 var(--z-*)
      // 2) 同一堆叠上下文内的相对整数 (0-20) 允许硬编码，属于 stylelint 例外
      //    例外依据见 docs/design/tokens.md#z-index-scale
      'z-index': [
        '/^var\\(--.+\\)$/',
        '/^auto$/',
        '/^(0|[1-9]|1[0-9]|20)$/',
      ],
    },
    // stylelint-config-standard-vue 默认已禁止 color-no-hex 之类，无需额外配置
    // 先让 standard 预设的规则暴露出来，再根据实际命中量调整
  },
};
