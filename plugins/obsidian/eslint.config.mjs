import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

export default defineConfig([
  ...obsidianmd.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
      'obsidianmd/ui/sentence-case': [
        'warn',
        {
          acronyms: ['HTTP'],
          brands: ['PicNexus'],
        },
      ],
    },
  },
]);
