import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mountWithDefaults } from '../helpers/vueMount';
import { flushPromisesAndTicks } from '../helpers/wait';
import BackupPasswordSection from '@/components/settings/backup/BackupPasswordSection.vue';
import type { BackupPasswordConfirmPayload } from '@/components/dialogs/backupPasswordDialogTypes';

const toastShowConfigMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const secureStorageMock = vi.hoisted(() => ({
  isPasswordMode: vi.fn(),
  verifyBackupPassword: vi.fn(),
  setBackupPassword: vi.fn(),
  clearBackupPassword: vi.fn(),
  forceReinit: vi.fn(),
}));
const configStoreMock = vi.hoisted(() => ({
  get: vi.fn(),
  readRawAll: vi.fn(),
  setDirect: vi.fn(),
}));
const syncStatusStoreMock = vi.hoisted(() => ({
  readRawAll: vi.fn(),
  setDirect: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showConfig: toastShowConfigMock }),
}));

vi.mock('@/security/crypto', () => ({
  secureStorage: secureStorageMock,
}));

vi.mock('@/store/instances', () => ({
  configStore: configStoreMock,
  syncStatusStore: syncStatusStoreMock,
}));

const dialogApi = {
  onPasswordSuccess: vi.fn(),
  onPasswordFailed: vi.fn(),
  resetLoading: vi.fn(),
};

const BackupPasswordDialogStub = defineComponent({
  name: 'BackupPasswordDialog',
  props: ['modelValue', 'mode'],
  emits: ['confirm', 'cancel', 'skip', 'update:modelValue'],
  setup(props, { emit, expose }) {
    expose(dialogApi);
    return () => h('section', {
      class: 'dialog-stub',
      'data-visible': String(props.modelValue),
      'data-mode': String(props.mode),
    }, [
      h('button', {
        class: 'confirm-change',
        onClick: () => emit('confirm', {
          mode: 'change',
          currentPassword: 'old-password',
          newPassword: 'NewPassword123',
          confirmPassword: 'NewPassword123',
        } satisfies BackupPasswordConfirmPayload),
      }, 'change'),
      h('button', {
        class: 'confirm-disable',
        onClick: () => emit('confirm', {
          mode: 'disable',
          currentPassword: 'old-password',
        } satisfies BackupPasswordConfirmPayload),
      }, 'disable'),
      h('button', {
        class: 'confirm-set',
        onClick: () => emit('confirm', {
          mode: 'set',
          password: 'NewPassword123',
        } satisfies BackupPasswordConfirmPayload),
      }, 'set'),
    ]);
  },
});

const ButtonStub = {
  props: ['label', 'loading'],
  emits: ['click'],
  template: '<button class="button-stub" :data-label="label" :data-loading="String(loading)" @click="$emit(\'click\')">{{ label }}</button>',
};

function mountSection() {
  return mountWithDefaults(BackupPasswordSection, {
    global: {
      stubs: {
        BackupPasswordDialog: BackupPasswordDialogStub,
        Button: ButtonStub,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  secureStorageMock.isPasswordMode.mockReturnValue(true);
  secureStorageMock.verifyBackupPassword.mockResolvedValue(true);
  secureStorageMock.setBackupPassword.mockResolvedValue(undefined);
  secureStorageMock.clearBackupPassword.mockResolvedValue(undefined);
  secureStorageMock.forceReinit.mockResolvedValue(undefined);
  configStoreMock.get.mockResolvedValue({ id: 'config' });
  configStoreMock.readRawAll.mockResolvedValue({
    config: { id: 'config' },
    analytics_data: { clientId: 'client-1' },
  });
  configStoreMock.setDirect.mockResolvedValue(undefined);
  syncStatusStoreMock.readRawAll.mockResolvedValue(null);
  syncStatusStoreMock.setDirect.mockResolvedValue(undefined);
  invokeMock.mockResolvedValue('old-key-b64');
});

describe('BackupPasswordSection', () => {
  it('opens the change dialog from the encrypted state', async () => {
    const wrapper = mountSection();
    await nextTick();

    await wrapper.find('[data-label="修改密码"]').trigger('click');

    expect(wrapper.get('.dialog-stub').attributes('data-mode')).toBe('change');
  });

  it('does not rewrite data when change current password verification fails', async () => {
    secureStorageMock.verifyBackupPassword.mockResolvedValueOnce(false);
    const wrapper = mountSection();
    await nextTick();

    await wrapper.find('[data-label="修改密码"]').trigger('click');
    await wrapper.get('.confirm-change').trigger('click');
    await flushPromisesAndTicks(3);

    expect(secureStorageMock.verifyBackupPassword).toHaveBeenCalledWith('old-password');
    expect(secureStorageMock.setBackupPassword).not.toHaveBeenCalled();
    expect(configStoreMock.setDirect).not.toHaveBeenCalled();
    expect(dialogApi.onPasswordFailed).toHaveBeenCalledTimes(1);
    expect(toastShowConfigMock).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('changes password and rewrites config after current password verification succeeds', async () => {
    const wrapper = mountSection();
    await nextTick();

    await wrapper.find('[data-label="修改密码"]').trigger('click');
    await wrapper.get('.confirm-change').trigger('click');
    await flushPromisesAndTicks(3);

    expect(secureStorageMock.verifyBackupPassword).toHaveBeenCalledWith('old-password');
    expect(secureStorageMock.setBackupPassword).toHaveBeenCalledWith('NewPassword123');
    expect(configStoreMock.setDirect).toHaveBeenCalledWith({
      config: { id: 'config' },
      analytics_data: { clientId: 'client-1' },
    });
    expect(dialogApi.onPasswordSuccess).toHaveBeenCalledTimes(1);
    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.objectContaining({ summary: '备份密码修改成功' }));
  });

  it('does not clear password when disable current password verification fails', async () => {
    secureStorageMock.verifyBackupPassword.mockResolvedValueOnce(false);
    const wrapper = mountSection();
    await nextTick();

    await wrapper.find('[data-label="关闭加密"]').trigger('click');
    expect(wrapper.get('.dialog-stub').attributes('data-mode')).toBe('disable');

    await wrapper.get('.confirm-disable').trigger('click');
    await flushPromisesAndTicks(3);

    expect(secureStorageMock.verifyBackupPassword).toHaveBeenCalledWith('old-password');
    expect(secureStorageMock.clearBackupPassword).not.toHaveBeenCalled();
    expect(configStoreMock.setDirect).not.toHaveBeenCalled();
    expect(dialogApi.onPasswordFailed).toHaveBeenCalledTimes(1);
  });

  it('clears password after current password verification succeeds and switches to unset state', async () => {
    const wrapper = mountSection();
    await nextTick();

    await wrapper.find('[data-label="关闭加密"]').trigger('click');
    await wrapper.get('.confirm-disable').trigger('click');
    await flushPromisesAndTicks(3);

    expect(secureStorageMock.clearBackupPassword).toHaveBeenCalledTimes(1);
    expect(configStoreMock.setDirect).toHaveBeenCalledWith({
      config: { id: 'config' },
      analytics_data: { clientId: 'client-1' },
    });
    expect(wrapper.text()).toContain('未设置');
    expect(wrapper.find('[data-label="设置密码"]').exists()).toBe(true);
  });

  it('sets a new password without requiring current password when unset', async () => {
    secureStorageMock.isPasswordMode.mockReturnValue(false);
    const wrapper = mountSection();
    await nextTick();

    await wrapper.find('[data-label="设置密码"]').trigger('click');
    expect(wrapper.get('.dialog-stub').attributes('data-mode')).toBe('set');

    await wrapper.get('.confirm-set').trigger('click');
    await flushPromisesAndTicks(3);

    expect(secureStorageMock.verifyBackupPassword).not.toHaveBeenCalled();
    expect(secureStorageMock.setBackupPassword).toHaveBeenCalledWith('NewPassword123');
    expect(wrapper.text()).toContain('已加密');
  });
});
