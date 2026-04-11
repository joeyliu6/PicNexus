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
      'sidecar/**',
      'scripts/**',
      '.husky/**',
      'docs/**',
      '*.config.mjs',
      '*.config.ts',
    ],
  },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    rules: {
      // === CLAUDE.md 硬指标（warn 先不 block，拆完文件后改 error） ===
      'max-lines': [
        'warn',
        {
          max: 500,
          skipBlankLines: true,
          skipComments: true,
        },
      ],

      // === 把 vueTsConfigs.recommended 里默认为 error 的严格规则全降为 warn ===
      // 保留检查可见性，但第一阶段不 block 任何操作。
      // 理由：这些不是 CLAUDE.md 明文硬指标，现有代码库里命中量大，
      // 若设为 error 会直接挡住所有 commit，超出第二批范围。
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      'prefer-const': 'warn',
      'no-empty': 'warn',
      'no-prototype-builtins': 'warn',
      'no-case-declarations': 'warn',
      'no-unused-vars': 'off', // 交给 @typescript-eslint 版本
      // Vue 专用规则降级（现有代码已违反，先可见不阻塞）
      'vue/multi-word-component-names': 'warn',
      'vue/no-mutating-props': 'warn',
    },
  },
);
