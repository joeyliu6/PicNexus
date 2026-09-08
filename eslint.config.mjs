// ESLint flat config for PicNexus (Vue 3 + TypeScript)
// 官方预设来源: https://github.com/vuejs/eslint-config-typescript
// 策略：只开 CLAUDE.md 里定义的"硬指标"，其余规则走官方默认，避免海量噪音。

import pluginVue from 'eslint-plugin-vue';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,vue}'],
  },
  {
    name: 'app/files-to-ignore',
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/**',
      'sidecars/**',
      'scripts/**',
      '.husky/**',
      'docs/**',
      // 测试文件：vitest mock 里大量 `as any` / `expect.any(Object)` 是常规做法，
      // 强行套主应用的 any/unused 规则收益极低。运行时由 vitest 自身 + tsc 兜底。
      'tests/**',
      'coverage/**',
      '.ci-artifacts/**',
      'playwright-report/**',
      'test-results/**',
      // Obsidian 插件子项目：有独立的构建与 lint 体系，不归主应用 ESLint 管控。
      'plugins/**',
      '*.config.mjs',
      '*.config.ts',
      '*.conf.cjs',
    ],
  },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    rules: {
      // === CLAUDE.md 硬指标（重建层收尾后全部正式升级为 error） ===
      'max-lines': [
        'error',
        {
          max: 500,
          skipBlankLines: true,
          skipComments: true,
        },
      ],

      // === vueTsConfigs.recommended 里默认为 error 的严格规则：
      //     S6 子任务 6a 清零后全部升级为 error，锁死重建层成果 ===
      // 与 tsconfig 的 verbatimModuleSyntax 配套：import 语义必须显式，
      // 类型导入一律写 `import type`，编译器才不用猜哪些 import 该在产物里保留
      // disallowTypeAnnotations 关掉：内联 `import('x').T` 是正当写法（常用来避开循环依赖），
      // 而 verbatimModuleSyntax 只在意「顶层 import 有没有写 type」，管不着内联标注
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-empty-object-type': 'error',
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      'prefer-const': 'error',
      'no-empty': 'error',
      'no-prototype-builtins': 'error',
      'no-case-declarations': 'error',
      'no-console': 'error',
      'no-unused-vars': 'off', // 交给 @typescript-eslint 版本
      // Vue 专用规则升级
      'vue/multi-word-component-names': 'error',
      'vue/no-mutating-props': 'error',
    },
  },
  {
    // 布局级单件组件豁免：Sidebar 是应用唯一侧栏，命名语义明确，
    // 改名涉及多处引用且收益极低。
    name: 'app/layout-component-name-overrides',
    files: ['src/components/layout/Sidebar.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
);
