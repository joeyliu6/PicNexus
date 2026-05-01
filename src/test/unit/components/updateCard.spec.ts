import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import UpdateCard from '../../../components/settings/about-update/UpdateCard.vue';

const mocks = vi.hoisted(() => ({
  autoUpdate: undefined as any,
  toastError: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock('../../../composables/useAutoUpdate', () => ({
  useAutoUpdate: () => mocks.autoUpdate,
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ error: mocks.toastError }),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: mocks.openExternal,
}));

const ButtonStub = defineComponent({
  name: 'Button',
  props: ['label', 'icon', 'disabled', 'outlined', 'size'],
  emits: ['click'],
  template: `
    <button class="button-stub" :disabled="disabled" @click="$emit('click')">
      <i v-if="icon" :class="icon"></i>
      <span>{{ label }}</span>
    </button>
  `,
});

const ToggleSwitchStub = defineComponent({
  name: 'ToggleSwitch',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: `
    <button class="toggle-switch-stub" @click="$emit('update:modelValue', !modelValue)">
      {{ String(modelValue) }}
    </button>
  `,
});

function makeAutoUpdate(overrides: Record<string, unknown> = {}) {
  return {
    status: ref('idle'),
    updateInfo: ref(null),
    downloadProgress: ref(0),
    errorMessage: ref(''),
    lastCheckTime: ref(null),
    pendingUpdateAvailable: ref(false),
    checkForUpdate: vi.fn(),
    downloadAndInstall: vi.fn(),
    retryRelaunch: vi.fn(),
    retryDownload: vi.fn(),
    ...overrides,
  };
}

function mountCard() {
  return mountWithDefaults(UpdateCard, {
    props: {
      autoUpdateEnabled: true,
    },
    global: {
      stubs: {
        Button: ButtonStub,
        ToggleSwitch: ToggleSwitchStub,
      },
    },
  });
}

describe('UpdateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.autoUpdate = makeAutoUpdate();
  });

  it('shows download progress on the right and uses a centered CSS spinner', () => {
    mocks.autoUpdate = makeAutoUpdate({
      status: ref('downloading'),
      downloadProgress: ref(37),
    });

    const wrapper = mountCard();

    expect(wrapper.get('.download-progress-percent').text()).toBe('37%');
    expect(wrapper.find('.download-spinner-ring').exists()).toBe(true);
    expect(wrapper.find('.pi-spinner').exists()).toBe(false);
  });

  it('shows restart action when update is installed and waiting for relaunch', async () => {
    const retryRelaunch = vi.fn();
    mocks.autoUpdate = makeAutoUpdate({
      status: ref('install-pending'),
      retryRelaunch,
    });

    const wrapper = mountCard();
    expect(wrapper.text()).toContain('更新已安装，重启后生效');

    const restartButton = wrapper.findAll('.button-stub')
      .find(button => button.text().includes('重启完成更新'));
    if (!restartButton) throw new Error('restart button not found');

    await restartButton.trigger('click');
    expect(retryRelaunch).toHaveBeenCalledTimes(1);
  });

  it('opens latest release page from check error manual download action', async () => {
    mocks.autoUpdate = makeAutoUpdate({
      status: ref('error'),
      errorMessage: ref('network'),
      pendingUpdateAvailable: ref(false),
    });

    const wrapper = mountCard();
    const manualButton = wrapper.findAll('.button-stub')
      .find(button => button.text().includes('手动下载'));
    if (!manualButton) throw new Error('manual download button not found');

    await manualButton.trigger('click');
    expect(mocks.openExternal).toHaveBeenCalledWith('https://github.com/joeyliu6/PicNexus/releases/latest');
  });
});
