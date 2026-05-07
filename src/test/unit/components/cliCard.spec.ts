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

function mountCliCard(executablePath = 'C:\\Program Files\\PicNexus\\PicNexus.exe') {
  return mountWithDefaults(CliCard, {
    props: { executablePath },
    global: {
      stubs: {
        Button: ButtonStub,
      },
    },
  });
}

async function flush() {
  await flushPromises();
  await nextTick();
}

function findButtonByText(wrapper: ReturnType<typeof mountCliCard>, text: string) {
  return wrapper.findAll('button').find((button) => button.text() === text);
}

describe('CliCard', () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it('shows add PATH action and both command forms when CLI dir is not in PATH', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({ inPath: false }),
    });

    const wrapper = mountCliCard();
    await flush();

    expect(wrapper.text()).toContain('未加入 PATH');
    expect(wrapper.text()).toContain('加入 PATH');
    expect(wrapper.text()).toContain('picnexus --service r2 image.png');
    expect(wrapper.text()).toContain('"C:\\Program Files\\PicNexus\\PicNexus.exe" --service r2 image.png');
  });

  it('shows joined PATH state and terminal restart hint after add succeeds', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({ inPath: false }),
      add_cli_to_path: status({ inPath: true, needsTerminalRestart: true }),
    });

    const wrapper = mountCliCard();
    await flush();

    const addButton = findButtonByText(wrapper, '加入 PATH');
    expect(addButton).toBeDefined();
    if (!addButton) throw new Error('add PATH button not found');
    await addButton.trigger('click');
    await flush();

    expect(getInvokeMock()).toHaveBeenCalledWith('add_cli_to_path');
    expect(wrapper.text()).toContain('已加入 PATH');
    expect(wrapper.text()).toContain('请重新打开终端后使用');
  });

  it('returns to not-in-PATH state after remove succeeds', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({ inPath: true }),
      remove_cli_from_path: status({ inPath: false, needsTerminalRestart: true }),
    });

    const wrapper = mountCliCard();
    await flush();

    expect(wrapper.text()).toContain('移除 PATH');
    const removeButton = findButtonByText(wrapper, '移除 PATH');
    expect(removeButton).toBeDefined();
    if (!removeButton) throw new Error('remove PATH button not found');
    await removeButton.trigger('click');
    await flush();

    expect(getInvokeMock()).toHaveBeenCalledWith('remove_cli_from_path');
    expect(wrapper.text()).toContain('未加入 PATH');
  });

  it('offers to remove the created link when shell PATH still needs setup', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({
        inPath: false,
        message: '已创建链接，但 /Users/u/.local/bin 不在 PATH 中。',
      }),
      remove_cli_from_path: status({ inPath: false }),
    });

    const wrapper = mountCliCard('/Applications/PicNexus.app/Contents/MacOS/PicNexus');
    await flush();

    expect(wrapper.text()).toContain('已创建链接');
    const removeLinkButton = findButtonByText(wrapper, '移除链接');
    expect(removeLinkButton).toBeDefined();
    if (!removeLinkButton) throw new Error('remove link button not found');
    await removeLinkButton.trigger('click');
    await flush();

    expect(getInvokeMock()).toHaveBeenCalledWith('remove_cli_from_path');
    expect(wrapper.text()).toContain('未加入 PATH');
  });

  it('disables one-click PATH action on unsupported platforms and keeps full-path command visible', async () => {
    setupInvokeResponses({
      get_cli_path_status: status({
        supported: false,
        executableDir: '/Applications/PicNexus.app/Contents/MacOS',
        message: '当前平台暂不支持一键加入 PATH，请使用完整路径命令。',
      }),
    });

    const wrapper = mountCliCard('/Applications/PicNexus.app/Contents/MacOS/PicNexus');
    await flush();

    expect(wrapper.text()).toContain('当前平台暂不支持一键加入 PATH');
    expect(wrapper.text()).toContain('完整路径命令');
    const action = findButtonByText(wrapper, '暂不支持');
    expect(action?.attributes('disabled')).toBeDefined();
  });
});
