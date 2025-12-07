// src/theme/index.ts
// PrimeVue 主题预设配置

import { definePreset } from '@primevue/themes';
import Aura from '@primevue/themes/aura';

/**
 * WeiboDR 自定义主题预设
 * 基于 PrimeVue Aura 主题，适配现有配色方案
 */
export const WeiboDRPreset = definePreset(Aura, {
  semantic: {
    // 主品牌色 - Sky/Blue 系列
    primary: {
      50: '{sky.50}',
      100: '{sky.100}',
      200: '{sky.200}',
      300: '{sky.300}',
      400: '{sky.400}',
      500: '{sky.500}',   // #3b82f6 - 主品牌色
      600: '{sky.600}',   // #2563eb - 悬浮态
      700: '{sky.700}',
      800: '{sky.800}',
      900: '{sky.900}',
      950: '{sky.950}'
    },

    // 颜色方案配置
    colorScheme: {
      // 亮色主题
      light: {
        surface: {
          0: '#ffffff',
          50: '{slate.50}',   // #f8fafc
          100: '{slate.100}', // #f1f5f9
          200: '{slate.200}', // #e2e8f0
          300: '{slate.300}', // #cbd5e1
          400: '{slate.400}', // #94a3b8
          500: '{slate.500}', // #64748b
          600: '{slate.600}', // #475569
          700: '{slate.700}', // #334155
          800: '{slate.800}', // #1e293b
          900: '{slate.900}', // #0f172a
          950: '{slate.950}'  // #020617
        },
        primary: {
          color: '{primary.500}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.600}',
          activeColor: '{primary.700}'
        },
        highlight: {
          background: '{primary.50}',
          focusBackground: '{primary.100}',
          color: '{primary.700}',
          focusColor: '{primary.800}'
        },
        content: {
          background: '{surface.0}',        // #ffffff - 亮色卡片背景
          hoverBackground: '{surface.100}', // #f1f5f9
          borderColor: '{surface.200}',     // #e2e8f0
          color: '#0f172a',                 // Slate 900 - 深色文本
          hoverColor: '#1e293b'             // Slate 800 - 悬浮文本
        }
      },

      // 深色主题
      dark: {
        surface: {
          0: '#0f172a',      // Slate 900 - 主内容区（对应 --bg-app）
          50: '#1e293b',     // Slate 800 - 卡片容器（对应 --bg-card）
          100: '#334155',    // Slate 700 - 输入框（对应 --bg-input）
          200: '#475569',    // Slate 600
          300: '#64748b',    // Slate 500
          400: '#94a3b8',    // Slate 400 - 次要文本（对应 --text-muted）
          500: '#cbd5e1',    // Slate 300
          600: '#e2e8f0',    // Slate 200
          700: '#f1f5f9',    // Slate 100
          800: '#f8fafc',    // Slate 50 - 主文本（对应 --text-main）
          900: '#ffffff',
          950: '#0a0f1a'     // 侧边栏背景（对应 --bg-sidebar）
        },
        primary: {
          color: '{primary.400}',
          contrastColor: '{surface.900}',
          hoverColor: '{primary.300}',
          activeColor: '{primary.200}'
        },
        highlight: {
          background: 'rgba(59, 130, 246, 0.16)',
          focusBackground: 'rgba(59, 130, 246, 0.24)',
          color: 'rgba(59, 130, 246, 0.87)',
          focusColor: 'rgba(59, 130, 246, 0.87)'
        },
        content: {
          background: '{surface.50}',       // #1e293b - 深色卡片背景（Slate 800）
          hoverBackground: '{surface.100}', // #334155 - Slate 700
          borderColor: '{surface.100}',     // #334155 - Slate 700
          color: '#f8fafc',                 // Slate 50 - 亮色文本（与 --text-main 一致）
          hoverColor: '#f1f5f9'             // Slate 100 - 悬浮文本
        }
      }
    }
  }
});
