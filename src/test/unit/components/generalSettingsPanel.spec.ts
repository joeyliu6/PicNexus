import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import GeneralSettingsPanel from '../../../components/settings/GeneralSettingsPanel.vue';

const ButtonStub = defineComponent({
  name: 'Button',
  props: ['label', 'icon', 'loading'],
  emits: ['click'],
  template: '<button type="button" :class="icon" :disabled="loading" @click="$emit(\'click\')">{{ label }}</button>',
});

const ToggleSwitchStub = defineComponent({
  name: 'ToggleSwitch',
  props: ['modelValue'],
  emits: ['update:modelValue', 'change'],
  template: '<button type="button" class="toggle-stub" @click="$emit(\'update:modelValue\', !modelValue); $emit(\'change\')" />',
});

const InputTextStub = defineComponent({
  name: 'InputText',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<input :value="modelValue" />',
});

const DividerStub = defineComponent({
  name: 'Divider',
  template: '<hr />',
});

const ShortcutInputStub = defineComponent({
  name: 'ShortcutInput',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<input class="shortcut-stub" :value="modelValue" />',
});

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mountWithDefaults(GeneralSettingsPanel, {
    props: {
      currentTheme: 'auto',
      autoStart: false,
      minimizeToTrayOnStart: false,
      closeToTray: true,
      analyticsEnabled: true,
      isClearingCache: false,
      isResettingDefaults: false,
      linkDefaultFormat: 'url',
      linkCustomTemplate: '{url}',
      linkAutoCopy: true,
      globalShortcutEnabled: true,
      shortcutUploadClipboard: 'CommandOrControl+Shift+C',
      shortcutUploadFromFile: 'CommandOrControl+Shift+O',
      ...overrides,
    },
    global: {
      stubs: {
        Button: ButtonStub,
        ToggleSwitch: ToggleSwitchStub,
        InputText: InputTextStub,
        Divider: DividerStub,
        ShortcutInput: ShortcutInputStub,
      },
    },
  });
}

describe('GeneralSettingsPanel', () => {
  it('renders and emits the restore-defaults action', async () => {
    const wrapper = mountPanel();

    const resetButton = wrapper.findAll('button').find(button => button.text() === '恢复默认设置');
    expect(resetButton).toBeTruthy();

    await resetButton!.trigger('click');

    expect(wrapper.emitted('resetDefaults')).toEqual([[]]);
  });

  it('shows the restore-defaults button as loading', () => {
    const wrapper = mountPanel({ isResettingDefaults: true });

    const resetButton = wrapper.findAll('button').find(button => button.text() === '恢复默认设置');
    expect(resetButton?.attributes('disabled')).toBeDefined();
  });
});
