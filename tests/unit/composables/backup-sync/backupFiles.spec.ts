// 从文件导入：自动认出是配置还是上传记录；加密的先解锁；认不出写「无法识别」；导入配置留本机的同步连接
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

const m = vi.hoisted(() => ({ disk: null as unknown, log: vi.fn() }));

vi.mock('@/store/instances', () => ({
  configStore: {
    get: vi.fn(async () => (m.disk ? structuredClone(m.disk) : null)),
    set: vi.fn(async (_key: string, value: unknown) => { m.disk = structuredClone(value); }),
    save: vi.fn(),
  },
}));
vi.mock('@/security/crypto', () => ({
  secureStorage: { isPasswordMode: () => true, encrypt: vi.fn() },
  isPasswordEncryptedData: (s: string) => s.startsWith('PNXPWD:'),
}));
vi.mock('@/composables/backup-sync/backupSyncUtils', async () => ({
  ...(await vi.importActual<object>('@/composables/backup-sync/backupSyncUtils')),
  writeSyncLog: m.log,
}));

import { importConfig, parseBackupFile, UNRECOGNIZED_FILE } from '@/composables/backup-sync/backupFiles';

const decrypt = vi.fn(async (s: string) => s.replace('PNXPWD:', ''));

beforeEach(() => {
  decrypt.mockClear();
  m.disk = { ...structuredClone(DEFAULT_CONFIG), webdav: { profiles: [], activeId: 'local' } };
});

describe('parseBackupFile', () => {
  it('数组是上传记录', async () => {
    await expect(parseBackupFile('[{"id":"a"},{"id":"b"}]', decrypt)).resolves.toMatchObject({ kind: 'history', count: 2 });
  });

  it('合法配置是配置；加密的先解锁', async () => {
    const config = JSON.stringify(DEFAULT_CONFIG);
    await expect(parseBackupFile(config, decrypt)).resolves.toMatchObject({ kind: 'config' });
    await expect(parseBackupFile(`PNXPWD:${config}`, decrypt)).resolves.toMatchObject({ kind: 'config' });
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'not json', '{"hello":1}', '42'])('认不出（%j）写「无法识别」', async (raw) => {
    await expect(parseBackupFile(raw, decrypt)).rejects.toThrow(UNRECOGNIZED_FILE);
  });
});

describe('importConfig', () => {
  it('用文件里的配置替换本机，但留本机的同步连接', async () => {
    const file: UserConfig = { ...structuredClone(DEFAULT_CONFIG), enabledServices: ['r2'], webdav: { profiles: [], activeId: 'from-file' } };
    await importConfig(file);
    expect((m.disk as UserConfig).enabledServices).toEqual(['r2']);
    expect((m.disk as UserConfig).webdav?.activeId).toBe('local');
    expect(m.log).toHaveBeenCalledWith('import_settings_local', 'success');
  });
});
