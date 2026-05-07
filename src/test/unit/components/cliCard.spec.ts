import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { getInvokeMock, resetTauriMocks, setupInvokeResponses } from '../../helpers/tauriMock';
import { mountWithDefaults } from '../../helpers/vueMount';

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    clear: vi.fn(),
    showConfig: vi.fn(),
  }),
}));

import CliCard from '../../../components/settings/external-editor/CliCard.vue';
import type { EditorServerConfig } from '../../../config/types';

interface CliPathStatus {
  supported: boolean;
  inPath: boolean;
  executableDir: string;
  commandName: 'picnexus';
  needsTerminalRestart: boolean;
  message?: string;
}

const ButtonStub = {
  props: ['label', 'disabled'],
  emits: ['click'],
  template: '<button class="button-stub" :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
};

const ToggleSwitchStub = {
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template: '<button class="toggle-switch-stub" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />',
};

function status(overrides: Partial<CliPathStatus> = {}): CliPathStatus {
  return {
    supported: true,
    inPath: false,
    executableDir: 'C:\\Program Files\\PicNexus',
    commandName: 'picnexus',
    needsTerminalRestart: false,
    ...overrides,
  };
}

function editorServer(overrides: Partial<EditorServerConfig> = {}): EditorServerConfig {
  return {
    enabled: false,
    typoraEnabled: false,
    cliEnabled: false,
    port: 36799,
    typoraService: null,
    obsidianService: null,
    ...overrides,
  };
}

function mountCliCard(
  executablePath = 'C:\\Program Files\\PicNexus\\PicNexus.exe',
  editorOverrides: Partial<EditorServerConfig> = {},
) {
  return mountWithDefaults(CliCard, {
    props: { executablePath, editorServer: editorServer(editorOverrides) },
    global: {
      stubs: {
        Button: ButtonStub,
        ToggleSwitch: ToggleSwitchStub,
      },
    },
  });
}

async function flush() {
  await flushPromises();
  await nextTick();
}

describe('CliCard', () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it('shows disabled state and both command forms before CLI is enabled', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({ inPath: false }),
    });

    const wrapper = mountCliCard();
    await flush();

    expect(wrapper.text()).toContain('打开开关后会启用 CLI 图床配置');
    expect(wrapper.text()).toContain('打开 CLI 后，PicNexus 会导出已配置且支持 CLI 的图床命令');
    expect(wrapper.text()).toContain('加入 PATH 后，可直接使用短命令');
    expect(wrapper.text()).toContain('picnexus --service r2 image.png');
    expect(wrapper.text()).toContain('"C:\\Program Files\\PicNexus\\PicNexus.exe" --service r2 image.png');
  });

  it('adds CLI to PATH and emits enabled state when the switch is turned on', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({ inPath: false }),
      add_cli_to_path: status({ inPath: true, needsTerminalRestart: true }),
    });

    const wrapper = mountCliCard();
    await flush();

    await wrapper.get('.toggle-switch-stub').trigger('click');
    await flush();

    expect(getInvokeMock()).toHaveBeenCalledWith('add_cli_to_path');
    const updates = wrapper.emitted('update:editorServer') as Array<[EditorServerConfig]>;
    expect(updates.at(-1)?.[0]).toMatchObject({ cliEnabled: true });
    expect(wrapper.text()).toContain('已加入 PATH，直接使用短命令');
  });

  it('removes CLI from PATH and emits disabled state when the switch is turned off', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({ inPath: true }),
      remove_cli_from_path: status({ inPath: false, needsTerminalRestart: true }),
    });

    const wrapper = mountCliCard('C:\\Program Files\\PicNexus\\PicNexus.exe', { cliEnabled: true });
    await flush();

    await wrapper.get('.toggle-switch-stub').trigger('click');
    await flush();

    expect(getInvokeMock()).toHaveBeenCalledWith('remove_cli_from_path');
    const updates = wrapper.emitted('update:editorServer') as Array<[EditorServerConfig]>;
    expect(updates.at(-1)?.[0]).toMatchObject({ cliEnabled: false });
    expect(wrapper.text()).toContain('打开开关后会启用 CLI 图床配置');
  });

  it('shows the PATH-free hint when CLI is enabled but not in PATH', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({ inPath: false }),
      add_cli_to_path: status({ inPath: false }),
    });

    const wrapper = mountCliCard();
    await flush();

    await wrapper.get('.toggle-switch-stub').trigger('click');
    await flush();

    expect(wrapper.text()).toContain('加入 PATH 后，可直接使用短命令');
  });

  it('keeps CLI enabled and shows warning when a Unix shell PATH still needs setup', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({ inPath: false }),
      add_cli_to_path: status({
        inPath: false,
        message: '已创建链接，但 /Users/u/.local/bin 不在 PATH 中。',
      }),
    });

    const wrapper = mountCliCard('/Applications/PicNexus.app/Contents/MacOS/PicNexus');
    await flush();

    await wrapper.get('.toggle-switch-stub').trigger('click');
    await flush();

    const updates = wrapper.emitted('update:editorServer') as Array<[EditorServerConfig]>;
    expect(updates.at(-1)?.[0]).toMatchObject({ cliEnabled: true });
    expect(wrapper.text()).toContain('已创建链接');
    expect(wrapper.find('.path-status-note.warning').exists()).toBe(true);
  });

  it('does not enable CLI on unsupported platforms and keeps full-path command visible', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({
        supported: false,
        executableDir: '/Applications/PicNexus.app/Contents/MacOS',
        inPath: false,
        message: '当前平台暂不支持一键加入 PATH，请使用完整路径命令。',
      }),
    });

    const wrapper = mountCliCard('/Applications/PicNexus.app/Contents/MacOS/PicNexus');
    await flush();

    await wrapper.get('.toggle-switch-stub').trigger('click');
    await flush();

    expect(getInvokeMock()).not.toHaveBeenCalledWith('add_cli_to_path');
    expect(wrapper.emitted('update:editorServer')).toBeUndefined();
    expect(wrapper.text()).toContain('当前平台暂不支持一键加入 PATH');
    expect(wrapper.text()).toContain('加入 PATH 后，可直接使用短命令');
  });

  it('disables CLI export even when removing PATH fails', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({ inPath: true }),
      remove_cli_from_path: new Error('无法删除符号链接'),
    });

    const wrapper = mountCliCard('C:\\Program Files\\PicNexus\\PicNexus.exe', { cliEnabled: true });
    await flush();

    await wrapper.get('.toggle-switch-stub').trigger('click');
    await flush();

    expect(getInvokeMock()).toHaveBeenCalledWith('remove_cli_from_path');
    const updates = wrapper.emitted('update:editorServer') as Array<[EditorServerConfig]>;
    expect(updates.at(-1)?.[0]).toMatchObject({ cliEnabled: false });
    expect(wrapper.find('.path-status-note.error').exists()).toBe(true);
  });
});
