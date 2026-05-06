import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
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

vi.mock('../../../security/shellOpen', () => ({
  openTrustedExternalUrl: mocks.openExternal,
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

  afterEach(() => {
    vi.useRealTimers();
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

  it('falls back to zero percent when download progress is not finite', () => {
    mocks.autoUpdate = makeAutoUpdate({
      status: ref('downloading'),
      downloadProgress: ref(Number.NaN),
    });

    const wrapper = mountCard();

    expect(wrapper.get('.download-progress-percent').text()).toBe('0%');
  });

  it('starts a check from the idle action', async () => {
    const checkForUpdate = vi.fn();
    mocks.autoUpdate = makeAutoUpdate({ checkForUpdate });

    const wrapper = mountCard();

    await wrapper.find('.button-stub').trigger('click');
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it('starts download from an available update', async () => {
    const downloadAndInstall = vi.fn();
    mocks.autoUpdate = makeAutoUpdate({
      status: ref('available'),
      updateInfo: ref({ version: '2.0.0', date: '', body: '' }),
      downloadAndInstall,
    });

    const wrapper = mountCard();

    expect(wrapper.text()).toContain('v2.0.0');
    const downloadButton = wrapper.findAll('.button-stub')
      .find(button => button.find('.pi-download').exists());
    if (!downloadButton) throw new Error('download button not found');

    await downloadButton.trigger('click');
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it('saves when the auto update toggle changes', async () => {
    const wrapper = mountCard();

    await wrapper.get('.toggle-switch-stub').trigger('click');

    expect(wrapper.emitted('update:autoUpdateEnabled')).toEqual([[false]]);
    expect(wrapper.emitted('save')).toHaveLength(1);
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

  it('offers retry download and recheck actions for a failed pending update', async () => {
    const retryDownload = vi.fn();
    const checkForUpdate = vi.fn();
    mocks.autoUpdate = makeAutoUpdate({
      status: ref('error'),
      errorMessage: ref('download failed'),
      lastCheckTime: ref(Date.now() - 120_000),
      pendingUpdateAvailable: ref(true),
      retryDownload,
      checkForUpdate,
    });

    const wrapper = mountCard();
    const buttons = wrapper.findAll('.button-stub');
    const retryDownloadButton = buttons.find(button => button.find('.pi-download').exists());
    const recheckButton = buttons.find(button => button.find('.pi-refresh').exists());
    if (!retryDownloadButton) throw new Error('retry download button not found');
    if (!recheckButton) throw new Error('recheck button not found');

    expect(wrapper.text()).toContain('download failed');
    expect(buttons.some(button => button.find('.pi-external-link').exists())).toBe(false);

    await retryDownloadButton.trigger('click');
    await recheckButton.trigger('click');

    expect(retryDownload).toHaveBeenCalledTimes(1);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
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

  it('shows a toast when opening the manual download page fails', async () => {
    mocks.openExternal.mockRejectedValue(new Error('blocked'));
    mocks.autoUpdate = makeAutoUpdate({
      status: ref('error'),
      errorMessage: ref('network'),
      pendingUpdateAvailable: ref(false),
    });

    const wrapper = mountCard();
    const manualButton = wrapper.findAll('.button-stub')
      .find(button => button.find('.pi-external-link').exists());
    if (!manualButton) throw new Error('manual download button not found');

    await manualButton.trigger('click');
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('https://github.com/joeyliu6/PicNexus/releases/latest'),
    );
  });

  it('keeps the refresh branch during a successful post-check state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const status = ref('checking');
    mocks.autoUpdate = makeAutoUpdate({
      status,
      lastCheckTime: ref(Date.now()),
    });

    const wrapper = mountCard();

    expect(wrapper.get('.update-refresh').classes()).toContain('is-checking');

    status.value = 'up-to-date';
    await nextTick();

    expect(wrapper.get('.update-refresh').classes()).toContain('is-success');

    vi.advanceTimersByTime(1500);
    await nextTick();

    expect(wrapper.get('.update-refresh').classes()).not.toContain('is-success');
    expect(wrapper.get('.update-refresh').attributes('disabled')).toBeUndefined();
  });

  it('clears the post-check state when checking starts again', async () => {
    vi.useFakeTimers();
    const status = ref('checking');
    mocks.autoUpdate = makeAutoUpdate({
      status,
      errorMessage: ref('network'),
    });

    const wrapper = mountCard();

    status.value = 'error';
    await nextTick();

    expect(wrapper.get('.update-refresh').classes()).toContain('is-error');
    expect(mocks.toastError).toHaveBeenCalledWith(expect.any(String), 'network');

    status.value = 'checking';
    await nextTick();
    vi.advanceTimersByTime(1500);
    await nextTick();

    expect(wrapper.get('.update-refresh').classes()).toContain('is-checking');
  });
});
