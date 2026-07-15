// PrimeVue 4 主题预设配置

import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

/**
 * PicNexus 自定义主题预设
 * 基于 Aura 主题，自定义主色调为蓝色
 */
export const PicNexusPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{blue.50}',
      100: '{blue.100}',
      200: '{blue.200}',
      300: '{blue.300}',
      400: '{blue.400}',
      500: '{blue.500}',
      600: '{blue.600}',
      700: '{blue.700}',
      800: '{blue.800}',
      900: '{blue.900}',
      950: '{blue.950}'
    }
  }
});

