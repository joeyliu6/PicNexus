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
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));

/** 假密码机的当前钥匙 + 调用顺序流水，供「解密必须发生在换钥匙之前」那条判据用 */
const cipher = vi.hoisted(() => ({ key: 'old-key', calls: [] as string[] }));
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

// isAnyEncryptedData 保留真实实现：fieldSecrets 靠它认魔数前缀，
// 换成假的等于把遍历逻辑一起绕过去了
vi.mock('@/security/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/security/crypto')>();
  return { ...actual, secureStorage: secureStorageMock };
});

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

  cipher.key = 'old-key';
  cipher.calls = [];
  secureStorageMock.encrypt.mockImplementation(async (text: string) => `PNXENC:${cipher.key}|${text}`);
  secureStorageMock.decrypt.mockImplementation(async (data: string) => {
    cipher.calls.push('decrypt');
    const body = data.slice('PNXENC:'.length);
    const separator = body.indexOf('|');
    if (separator < 0 || body.slice(0, separator) !== cipher.key) {
      throw new Error('数据损坏或密钥不匹配');
    }
    return body.slice(separator + 1);
  });
});

/** 一份带字段级密文的配置快照，密文用 `oldKey` 加密 */
function rawConfigWithSecrets(oldKey = 'old-key') {
  return {
    config: {
      id: 'config',
      webdav_profiles: [
        { id: 'p1', name: '我的 OpenList', passwordEncrypted: `PNXENC:${oldKey}|hosting-pw` },
      ],
      webdav: {
        profiles: [{ id: 'b1', name: '坚果云', passwordEncrypted: `PNXENC:${oldKey}|backup-pw` }],
      },
    },
    analytics_data: { clientId: 'client-1' },
  };
}

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

/**
 * 换钥匙时内层密文的搬运
 *
 * 这里钉的是历史缺陷：`swapKeyAndReencrypt` 曾经只重写外层信封，
 * config 里的 `passwordEncrypted` 一起变成谁也开不了的孤儿。
 */
describe('BackupPasswordSection 内层密文搬运', () => {
  interface WrittenConfig {
    config: {
      webdav_profiles: Array<{ passwordEncrypted: string }>;
      webdav: { profiles: Array<{ passwordEncrypted: string }> };
    };
  }

  function lastWrittenConfig(): WrittenConfig {
    return configStoreMock.setDirect.mock.calls[0][0] as WrittenConfig;
  }

  function swapToNewKey(): void {
    cipher.calls.push('swap');
    cipher.key = 'new-key';
  }

  it('decrypts before swapping the key, then re-encrypts with the new one', async () => {
    secureStorageMock.isPasswordMode.mockReturnValue(false);
    configStoreMock.readRawAll.mockResolvedValue(rawConfigWithSecrets());
    secureStorageMock.setBackupPassword.mockImplementation(async () => swapToNewKey());

    const wrapper = mountSection();
    await nextTick();
    await wrapper.find('[data-label="设置密码"]').trigger('click');
    await wrapper.get('.confirm-set').trigger('click');
    await flushPromisesAndTicks(3);

    // 顺序判据：内层密文只能用旧钥匙解开，解密必须发生在换钥匙之前。
    // 把 swap 挪到解密之前，这条立刻红——本次修复就是这个顺序
    expect(cipher.calls).toEqual(['decrypt', 'decrypt', 'swap']);

    const written = lastWrittenConfig();
    expect(written.config.webdav_profiles[0].passwordEncrypted).toBe('PNXENC:new-key|hosting-pw');
    expect(written.config.webdav.profiles[0].passwordEncrypted).toBe('PNXENC:new-key|backup-pw');
  });

  it('carries the ciphertext across when encryption is disabled too', async () => {
    configStoreMock.readRawAll.mockResolvedValue(rawConfigWithSecrets());
    secureStorageMock.clearBackupPassword.mockImplementation(async () => swapToNewKey());

    const wrapper = mountSection();
    await nextTick();
    await wrapper.find('[data-label="关闭加密"]').trigger('click');
    await wrapper.get('.confirm-disable').trigger('click');
    await flushPromisesAndTicks(3);

    expect(cipher.calls).toEqual(['decrypt', 'decrypt', 'swap']);
    expect(lastWrittenConfig().config.webdav.profiles[0].passwordEncrypted)
      .toBe('PNXENC:new-key|backup-pw');
  });

  it('keeps ciphertext the old key cannot open instead of clearing it', async () => {
    const raw = rawConfigWithSecrets();
    raw.config.webdav_profiles[0].passwordEncrypted = 'PNXENC:a-key-nobody-has|lost-forever';
    secureStorageMock.isPasswordMode.mockReturnValue(false);
    configStoreMock.readRawAll.mockResolvedValue(raw);
    secureStorageMock.setBackupPassword.mockImplementation(async () => swapToNewKey());

    const wrapper = mountSection();
    await nextTick();
    await wrapper.find('[data-label="设置密码"]').trigger('click');
    await wrapper.get('.confirm-set').trigger('click');
    await flushPromisesAndTicks(3);

    const written = lastWrittenConfig();
    expect(written.config.webdav_profiles[0].passwordEncrypted).toBe('PNXENC:a-key-nobody-has|lost-forever');
    expect(written.config.webdav.profiles[0].passwordEncrypted).toBe('PNXENC:new-key|backup-pw');
  });

  /**
   * 孤儿密文用旧钥匙就已经解不开了，不是这次换钥匙弄坏的——但只弹「设置成功」的话，
   * 密码框还挂着「已保存」，用户要到某次上传失败、或下次启动的清理提示才知道。
   */
  it('names the passwords that could not be carried over instead of just saying it succeeded', async () => {
    const raw = rawConfigWithSecrets();
    raw.config.webdav_profiles[0].passwordEncrypted = 'PNXENC:a-key-nobody-has|lost-forever';
    secureStorageMock.isPasswordMode.mockReturnValue(false);
    configStoreMock.readRawAll.mockResolvedValue(raw);
    secureStorageMock.setBackupPassword.mockImplementation(async () => swapToNewKey());

    const wrapper = mountSection();
    await nextTick();
    await wrapper.find('[data-label="设置密码"]').trigger('click');
    await wrapper.get('.confirm-set').trigger('click');
    await flushPromisesAndTicks(3);

    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', expect.objectContaining({
      summary: '备份密码设置成功，但部分密码需要重新填写',
      detail: expect.stringContaining('WebDAV 图床「我的 OpenList」'),
      life: 0,   // 用户得去重填，一闪而过的提示等于没提示
    }));
    // 一条常驻警告 + 一条自动消失的成功 = 同一次操作两种色调的回执，是噪音
    expect(toastShowConfigMock).not.toHaveBeenCalledWith('success', expect.anything());
  });

  it('still reports plain success when every ciphertext made it across', async () => {
    secureStorageMock.isPasswordMode.mockReturnValue(false);
    configStoreMock.readRawAll.mockResolvedValue(rawConfigWithSecrets());
    secureStorageMock.setBackupPassword.mockImplementation(async () => swapToNewKey());

    const wrapper = mountSection();
    await nextTick();
    await wrapper.find('[data-label="设置密码"]').trigger('click');
    await wrapper.get('.confirm-set').trigger('click');
    await flushPromisesAndTicks(3);

    expect(toastShowConfigMock).toHaveBeenCalledWith('success', expect.objectContaining({
      summary: '备份密码设置成功',
    }));
    expect(toastShowConfigMock).not.toHaveBeenCalledWith('warn', expect.anything());
  });

  /**
   * 换完钥匙必须通知父级重读密文
   *
   * 磁盘上已是新密文，设置页 formData 里还是旧的。不通知的话点眼睛解不开，
   * 而且下一次保存会把旧密文写回磁盘，把搬运成果覆盖掉。
   */
  it('tells the parent to refresh its ciphertext copies after every successful swap', async () => {
    secureStorageMock.isPasswordMode.mockReturnValue(false);
    configStoreMock.readRawAll.mockResolvedValue(rawConfigWithSecrets());
    secureStorageMock.setBackupPassword.mockImplementation(async () => swapToNewKey());

    const wrapper = mountSection();
    await nextTick();
    await wrapper.find('[data-label="设置密码"]').trigger('click');
    await wrapper.get('.confirm-set').trigger('click');
    await flushPromisesAndTicks(3);

    expect(wrapper.emitted('secrets-rekeyed')).toHaveLength(1);
  });

  it('stays silent when the current password check fails, since no key was swapped', async () => {
    secureStorageMock.verifyBackupPassword.mockResolvedValueOnce(false);
    configStoreMock.readRawAll.mockResolvedValue(rawConfigWithSecrets());

    const wrapper = mountSection();
    await nextTick();
    await wrapper.find('[data-label="修改密码"]').trigger('click');
    await wrapper.get('.confirm-change').trigger('click');
    await flushPromisesAndTicks(3);

    expect(wrapper.emitted('secrets-rekeyed')).toBeUndefined();
  });

  it('rolls back to the old key and writes nothing when re-encryption fails', async () => {
    secureStorageMock.isPasswordMode.mockReturnValue(false);
    configStoreMock.readRawAll.mockResolvedValue(rawConfigWithSecrets());
    secureStorageMock.setBackupPassword.mockImplementation(async () => swapToNewKey());
    secureStorageMock.encrypt.mockRejectedValue(new Error('加密失败'));

    const wrapper = mountSection();
    await nextTick();
    await wrapper.find('[data-label="设置密码"]').trigger('click');
    await wrapper.get('.confirm-set').trigger('click');
    await flushPromisesAndTicks(3);

    expect(invokeMock).toHaveBeenCalledWith('set_secure_key', { key: 'old-key-b64' });
    expect(secureStorageMock.forceReinit).toHaveBeenCalledTimes(1);
    expect(configStoreMock.setDirect).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', expect.objectContaining({
      summary: '备份密码操作失败',
    }));
    // 失败路径不能通知父级刷新——磁盘没变，刷了也只是白读一遍旧值
    expect(wrapper.emitted('secrets-rekeyed')).toBeUndefined();
  });
});
