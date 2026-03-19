// PrimeVue 主题预设配置

import { definePreset } from '@primevue/themes';
import Aura from '@primevue/themes/aura';

/**
 * PicNexus 自定义主题预设
 * 基于 PrimeVue Aura 主题，适配现有配色方案
 */
export const PicNexusPreset = definePreset(Aura, {
  semantic: {
    // 主品牌色 - Blue 系列（Arctic Minimal）
    primary: {
      50: '{blue.50}',
      100: '{blue.100}',
      200: '{blue.200}',
      300: '{blue.300}',
      400: '{blue.400}',   // #60a5fa - 深色模式主色
      500: '{blue.500}',   // #3b82f6 - 亮色模式主色/深色悬浮态
      600: '{blue.600}',
      700: '{blue.700}',
      800: '{blue.800}',
      900: '{blue.900}',
      950: '{blue.950}'
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

      // 深色主题 - Arctic Minimal (Zinc 纯灰)
      dark: {
        surface: {
          0: '#131316',      // 主内容区（对应 --bg-app）
          50: '#1a1a1e',     // 卡片容器（对应 --bg-card）
          100: '#242428',    // 输入框（对应 --bg-input）
          200: '#2e2e33',    // 中间过渡色
          300: '#71717a',    // Zinc 500 - 对应 --text-tertiary
          400: '#a1a1aa',    // Zinc 400 - 对应 --text-muted
          500: '#d4d4d8',    // Zinc 300
          600: '#e4e4e7',    // Zinc 200
          700: '#f4f4f5',    // Zinc 100
          800: '#f4f4f5',    // 对应 --text-main
          900: '#ffffff',
          950: '#0e0e11'     // 侧边栏背景（对应 --bg-sidebar）
        },
        primary: {
          color: '{primary.400}',
          contrastColor: '{surface.900}',
          hoverColor: '{primary.300}',
          activeColor: '{primary.200}'
        },
        highlight: {
          background: 'rgba(96, 165, 250, 0.16)',
          focusBackground: 'rgba(96, 165, 250, 0.24)',
          color: 'rgba(96, 165, 250, 0.87)',
          focusColor: 'rgba(96, 165, 250, 0.87)'
        },
        content: {
          background: '{surface.50}',       // #1a1a1e - 卡片背景
          hoverBackground: '{surface.100}', // #242428
          borderColor: '{surface.100}',     // #242428
          color: '#f4f4f5',                 // Zinc 100 - 主文本
          hoverColor: '#e4e4e7'             // Zinc 200 - 悬浮文本
        }
      }
    }
  }
});
