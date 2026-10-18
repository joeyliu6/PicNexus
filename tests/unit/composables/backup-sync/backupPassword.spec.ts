// 备份密码的设置 / 修改 / 关闭 = 换钥匙：当前密码不对什么都不动；内层密文先用旧钥匙解开、换钥匙、再用新钥匙锁上；
// 旧钥匙就解不开的原样保留并报出来；写回失败回滚钥匙；换完广播给托盘（独立 webview，有自己一份钥匙）
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const configStoreMock = vi.hoisted(() => ({ readRawAll: vi.fn(), setDirect: vi.fn() }));
const syncStatusStoreMock = vi.hoisted(() => ({ readRawAll: vi.fn(), setDirect: vi.fn() }));
const writeSyncLog = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
// isAnyEncryptedData 保留真实实现：fieldSecrets 靠它认魔数前缀，换成假的等于把遍历逻辑一起绕过去了
vi.mock('@/security/crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/security/crypto')>()),
  secureStorage: secureStorageMock,
}));
vi.mock('@/store/instances', () => ({ configStore: configStoreMock, syncStatusStore: syncStatusStoreMock }));
vi.mock('@/composables/backup-sync/backupSyncUtils', () => ({ writeSyncLog }));

import { changeBackupPassword, WrongPasswordError } from '@/composables/backup-sync/backupPassword';

/** 一份带字段级密文的配置快照，密文用 `oldKey` 加密 */
function rawConfigWithSecrets(oldKey = 'old-key') {
  return {
    config: {
      id: 'config',
      webdav_profiles: [{ id: 'p1', name: '我的 OpenList', passwordEncrypted: `PNXENC:${oldKey}|hosting-pw` }],
      webdav: { profiles: [{ id: 'b1', name: '坚果云', passwordEncrypted: `PNXENC:${oldKey}|backup-pw` }] },
    },
    analytics_data: { clientId: 'client-1' },
  };
}

interface Written {
  config: { webdav_profiles: Array<{ passwordEncrypted: string }>; webdav: { profiles: Array<{ passwordEncrypted: string }> } };
}
const written = () => configStoreMock.setDirect.mock.calls[0][0] as Written;

function swapToNewKey(): void {
  cipher.calls.push('swap');
  cipher.key = 'new-key';
}

beforeEach(() => {
  vi.clearAllMocks();
  cipher.key = 'old-key';
  cipher.calls = [];
  invokeMock.mockResolvedValue('old-key-b64');
  secureStorageMock.isPasswordMode.mockReturnValue(true);
  secureStorageMock.verifyBackupPassword.mockResolvedValue(true);
  secureStorageMock.setBackupPassword.mockImplementation(async () => swapToNewKey());
  secureStorageMock.clearBackupPassword.mockImplementation(async () => swapToNewKey());
  secureStorageMock.forceReinit.mockResolvedValue(undefined);
  secureStorageMock.encrypt.mockImplementation(async (text: string) => `PNXENC:${cipher.key}|${text}`);
  secureStorageMock.decrypt.mockImplementation(async (data: string) => {
    cipher.calls.push('decrypt');
    const body = data.slice('PNXENC:'.length);
    const separator = body.indexOf('|');
    if (separator < 0 || body.slice(0, separator) !== cipher.key) throw new Error('数据损坏或密钥不匹配');
    return body.slice(separator + 1);
  });
  configStoreMock.readRawAll.mockResolvedValue(rawConfigWithSecrets());
  configStoreMock.setDirect.mockResolvedValue(undefined);
  syncStatusStoreMock.readRawAll.mockResolvedValue(null);
  syncStatusStoreMock.setDirect.mockResolvedValue(undefined);
});

describe('changeBackupPassword', () => {
  it('修改 / 关闭时当前密码不对：抛 WrongPasswordError，不换钥匙、不写盘', async () => {
    secureStorageMock.verifyBackupPassword.mockResolvedValue(false);
    await expect(changeBackupPassword({ mode: 'change', currentPassword: 'x', newPassword: 'New12345' })).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(changeBackupPassword({ mode: 'disable', currentPassword: 'x' })).rejects.toBeInstanceOf(WrongPasswordError);
    expect(secureStorageMock.setBackupPassword).not.toHaveBeenCalled();
    expect(secureStorageMock.clearBackupPassword).not.toHaveBeenCalled();
    expect(configStoreMock.setDirect).not.toHaveBeenCalled();
  });

  it('设置：不验当前密码；内层密文先用旧钥匙解开再换钥匙，写回的是新钥匙锁上的', async () => {
    await changeBackupPassword({ mode: 'set', password: 'New12345' });
    expect(secureStorageMock.verifyBackupPassword).not.toHaveBeenCalled();
    // 顺序判据：内层密文只能用旧钥匙解开，解密必须发生在换钥匙之前
    expect(cipher.calls).toEqual(['decrypt', 'decrypt', 'swap']);
    expect(written().config.webdav_profiles[0].passwordEncrypted).toBe('PNXENC:new-key|hosting-pw');
    expect(written().config.webdav.profiles[0].passwordEncrypted).toBe('PNXENC:new-key|backup-pw');
    expect(writeSyncLog).toHaveBeenCalledWith('password_set', 'success');
  });

  it('关闭加密也搬运内层密文', async () => {
    await changeBackupPassword({ mode: 'disable', currentPassword: 'Old12345' });
    expect(cipher.calls).toEqual(['decrypt', 'decrypt', 'swap']);
    expect(written().config.webdav.profiles[0].passwordEncrypted).toBe('PNXENC:new-key|backup-pw');
  });

  it('旧钥匙就解不开的密文原样保留，并在结果里报出来', async () => {
    const raw = rawConfigWithSecrets();
    raw.config.webdav_profiles[0].passwordEncrypted = 'PNXENC:a-key-nobody-has|lost-forever';
    configStoreMock.readRawAll.mockResolvedValue(raw);
    const report = await changeBackupPassword({ mode: 'change', currentPassword: 'Old12345', newPassword: 'New12345' });
    expect(written().config.webdav_profiles[0].passwordEncrypted).toBe('PNXENC:a-key-nobody-has|lost-forever');
    expect(written().config.webdav.profiles[0].passwordEncrypted).toBe('PNXENC:new-key|backup-pw');
    expect(report.orphans.length).toBe(1);
  });

  it('写回失败：钥匙回滚到旧的，错误交给调用方', async () => {
    configStoreMock.setDirect.mockRejectedValue(new Error('disk full'));
    await expect(changeBackupPassword({ mode: 'set', password: 'New12345' })).rejects.toThrow('disk full');
    expect(invokeMock).toHaveBeenCalledWith('set_secure_key', { key: 'old-key-b64' });
    expect(secureStorageMock.forceReinit).toHaveBeenCalled();
  });
});
