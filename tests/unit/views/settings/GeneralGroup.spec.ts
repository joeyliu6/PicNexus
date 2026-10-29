// 设置 › 通用 ›「启动」的脚注说的是关窗口之后的事：要跟「关闭窗口时最小化到托盘」的开关一致
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import { mountWithDefaults } from '../../helpers/vueMount';

const config = ref<UserConfig>(structuredClone(DEFAULT_CONFIG));

vi.mock('@/views/settings/useSettingsConfig', () => ({
  useSettingsConfig: () => ({ config, patch: vi.fn(), isSaved: () => false }),
}));
vi.mock('@/views/settings/settingsEffects', () => ({
  useSettingsEffects: () => ({ autoStartActual: ref(null), changeAutoStart: vi.fn(), changeCloseToTray: vi.fn(), changeTheme: vi.fn() }),
}));
vi.mock('@/composables/useTheme', () => ({ useThemeManager: () => ({ currentTheme: ref('light') }) }));

const { default: GeneralGroup } = await import('@/views/settings/GeneralGroup.vue');

const mounted: VueWrapper[] = [];

function mountWithCloseToTray(closeToTray: boolean): VueWrapper {
  config.value = { ...structuredClone(DEFAULT_CONFIG), appBehavior: { ...DEFAULT_CONFIG.appBehavior!, closeToTray } };
  const wrapper = mountWithDefaults(GeneralGroup);
  mounted.push(wrapper);
  return wrapper;
}

const startNote = (wrapper: VueWrapper) => wrapper.find('[aria-label="启动"] .settings-section__note').text();

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('GeneralGroup startup note', () => {
  it('says the app stays in the tray when closing the window minimizes to it', () => {
    expect(startNote(mountWithCloseToTray(true))).toBe('关闭窗口后 PicNexus 仍在托盘运行，全局快捷键和后台检测照常可用。');
  });

  it('says closing the window quits when it does not minimize to the tray', () => {
    expect(startNote(mountWithCloseToTray(false))).toBe('关闭窗口即退出 PicNexus，全局快捷键和后台检测随之停止。');
  });
});
