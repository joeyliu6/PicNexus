// 云端配置同步：没设备份密码不上传；拉取出错 / 云端文件为空或格式坏都中止、不覆盖云端；
// 合并留本机的同步连接与文档文件夹；合并后回传失败算「部分完成」；用户取消解密整次放弃
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type UserConfig, type WebDAVProfile } from '@/config/types';

const m = vi.hoisted(() => ({
  disk: null as unknown,
  set: vi.fn(),
  passwordMode: true,
  getFile: vi.fn(),
  putFile: vi.fn(),
  record: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@/store/instances', () => ({
  configStore: {
    get: vi.fn(async () => (m.disk ? structuredClone(m.disk) : null)),
    set: vi.fn(async (_key: string, value: unknown) => { m.set(value); m.disk = structuredClone(value); }),
    save: vi.fn(),
  },
}));
vi.mock('@/security/crypto', () => ({
  secureStorage: { isPasswordMode: () => m.passwordMode, encrypt: vi.fn(async (s: string) => `enc:${s}`) },
  isPasswordEncryptedData: (s: string) => s.startsWith('PNXPWD:'),
}));
vi.mock('@/composables/backup-sync/syncRecords', () => ({ recordSync: m.record }));
vi.mock('@/composables/backup-sync/backupSyncUtils', async () => {
  const actual = await vi.importActual<typeof import('@/composables/backup-sync/backupSyncUtils')>('@/composables/backup-sync/backupSyncUtils');
  return {
    ...actual,
    writeSyncLog: m.log,
    getWebDAVClientAndPath: vi.fn(async (p: WebDAVProfile | null) => (p ? { client: { getFile: m.getFile, putFile: m.putFile }, remotePath: '/PicNexus/settings.json' } : null)),
  };
});

import { NEED_BACKUP_PASSWORD, pullConfig, pushConfig, syncConfig } from '@/composables/backup-sync/ConfigSync';
import { CLOUD_CONFIG_EMPTY_REASON, SyncFailure } from '@/composables/backup-sync/backupSyncUtils';

const profile: WebDAVProfile = { id: 'p1', name: '坚果云', url: 'https://dav.example.com', username: 'u', passwordEncrypted: 'x', remotePath: '/PicNexus/' };
const decrypt = vi.fn(async (s: string) => s.replace('PNXPWD:', ''));

function local(): UserConfig {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    enabledServices: ['jd'],
    webdav: { profiles: [profile], activeId: 'p1', syncItems: { config: true, history: false } },
    linkHealth: { docFolders: ['D:/notes'], autoCheck: { enabled: true, intervalDays: 7 } },
  };
}

function cloud(patch: Partial<UserConfig> = {}): UserConfig {
  return { ...structuredClone(DEFAULT_CONFIG), enabledServices: ['r2'], webdav: { profiles: [], activeId: null }, linkHealth: { docFolders: ['/Users/me/notes'], autoCheck: { enabled: false, intervalDays: 30 } }, ...patch };
}

beforeEach(() => {
  m.disk = local();
  m.set.mockReset();
  m.passwordMode = true;
  m.getFile.mockReset();
  m.putFile.mockReset().mockResolvedValue(undefined);
  m.record.mockReset();
  m.log.mockReset();
  decrypt.mockClear();
});

describe('syncConfig', () => {
  it('没设备份密码时不联网、不上传（云端配置包含图床密钥）', async () => {
    m.passwordMode = false;
    await expect(syncConfig(profile, decrypt)).rejects.toThrow(NEED_BACKUP_PASSWORD);
    expect(m.getFile).not.toHaveBeenCalled();
    expect(m.putFile).not.toHaveBeenCalled();
  });

  it('合并云端配置：留本机的同步连接与文档文件夹，自动检测取云端的；之后回传并报告「改了」', async () => {
    m.getFile.mockResolvedValue(JSON.stringify(cloud()));
    const result = await syncConfig(profile, decrypt);
    const merged = m.disk as UserConfig;
    expect(result.changed).toBe(true);
    expect(merged.enabledServices).toEqual(['r2']);
    expect(merged.webdav).toEqual(local().webdav);
    expect(merged.linkHealth).toEqual({ docFolders: ['D:/notes'], autoCheck: { enabled: false, intervalDays: 30 } });
    expect(m.putFile).toHaveBeenCalledWith('/PicNexus/settings.json', expect.stringMatching(/^enc:/));
    expect(m.record).toHaveBeenCalledWith(profile, 'config', 'success');
  });

  it('云端与本机一样时不写本机，报告「没改」', async () => {
    m.getFile.mockResolvedValue(JSON.stringify({ ...local() }));
    const result = await syncConfig(profile, decrypt);
    expect(result.changed).toBe(false);
    expect(m.set).not.toHaveBeenCalled();
  });

  it('加密的云端配置先解密', async () => {
    m.getFile.mockResolvedValue(`PNXPWD:${JSON.stringify(cloud())}`);
    await syncConfig(profile, decrypt);
    expect(decrypt).toHaveBeenCalled();
    expect((m.disk as UserConfig).enabledServices).toEqual(['r2']);
  });

  it('首次同步（云端没有文件）照常上传', async () => {
    m.getFile.mockResolvedValue(null);
    await expect(syncConfig(profile, decrypt)).resolves.toEqual({ changed: false });
    expect(m.putFile).toHaveBeenCalled();
  });

  it.each([
    ['非 404 的拉取错误', () => m.getFile.mockRejectedValue(new Error('HTTP 401 Unauthorized'))],
    ['云端文件 0 字节', () => m.getFile.mockResolvedValue('')],
    ['云端内容不是配置', () => m.getFile.mockResolvedValue(JSON.stringify({ hello: 1 }))],
  ])('%s：中止，不覆盖云端', async (_name, arrange) => {
    arrange();
    const error = await syncConfig(profile, decrypt).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncFailure);
    expect((error as SyncFailure).partial).toBe(false);
    expect(m.putFile).not.toHaveBeenCalled();
    expect(m.record).toHaveBeenCalledWith(profile, 'config', 'failed', expect.any(String));
  });

  it('空文件的中止原因写明出路（「⋯ › 用本机覆盖云端」）', async () => {
    m.getFile.mockResolvedValue('');
    await expect(syncConfig(profile, decrypt)).rejects.toThrow(CLOUD_CONFIG_EMPTY_REASON);
  });

  it('合并进本机后回传失败：标「部分完成」', async () => {
    m.getFile.mockResolvedValue(JSON.stringify(cloud()));
    m.putFile.mockRejectedValue(new Error('timeout'));
    const error = await syncConfig(profile, decrypt).catch((e: unknown) => e) as SyncFailure;
    expect(error.partial).toBe(true);
    expect(m.record).toHaveBeenCalledWith(profile, 'config', 'partial', expect.any(String));
  });

  it('输入密码时取消：整次放弃，不上传', async () => {
    m.getFile.mockResolvedValue('PNXPWD:x');
    decrypt.mockRejectedValueOnce(new Error('user_cancelled'));
    await expect(syncConfig(profile, decrypt)).rejects.toThrow('user_cancelled');
    expect(m.putFile).not.toHaveBeenCalled();
  });
});

describe('覆盖', () => {
  it('用本机覆盖云端：没设备份密码时不上传', async () => {
    m.passwordMode = false;
    await expect(pushConfig(profile)).rejects.toThrow(NEED_BACKUP_PASSWORD);
    expect(m.putFile).not.toHaveBeenCalled();
  });

  it('用云端覆盖本机：同样留本机的同步连接与文档文件夹', async () => {
    m.getFile.mockResolvedValue(JSON.stringify(cloud()));
    await pullConfig(profile, decrypt);
    expect((m.disk as UserConfig).enabledServices).toEqual(['r2']);
    expect((m.disk as UserConfig).webdav).toEqual(local().webdav);
    expect(m.putFile).not.toHaveBeenCalled();
  });

  it('用云端覆盖本机：云端没有文件算失败（没东西可还原），本机不动', async () => {
    m.getFile.mockResolvedValue(null);
    await expect(pullConfig(profile, decrypt)).rejects.toBeInstanceOf(SyncFailure);
    expect(m.set).not.toHaveBeenCalled();
  });
});
