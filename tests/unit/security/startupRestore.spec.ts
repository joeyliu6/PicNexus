// 启动时还原备份配置（D01 / D02）的收尾：密码对了记下「已还原」；跳过时把加密配置另存在数据文件夹再删原文件。
// 两条路之后都要整页重新加载（启动时各模块读配置已失败一轮），通知跨过重新加载再弹。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  files: new Map<string, string>(),
  initWithPassword: vi.fn(),
  failWrite: false,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(async (path: string) => {
    if (!m.files.has(path)) throw new Error(`not found: ${path}`);
    return m.files.get(path)!;
  }),
  writeTextFile: vi.fn(async (path: string, content: string) => {
    if (m.failWrite) throw new Error('磁盘已满');
    m.files.set(path, content);
  }),
  remove: vi.fn(async (path: string) => { m.files.delete(path); }),
  exists: vi.fn(async (path: string) => m.files.has(path)),
}));
vi.mock('@tauri-apps/api/path', () => ({ join: async (...parts: string[]) => parts.join('/') }));
vi.mock('@/utils/appPaths', () => ({ getUserDataDir: async () => 'D:/data' }));
vi.mock('@/security/crypto', () => ({ secureStorage: { initWithPassword: m.initWithPassword } }));

import {
  asideFileName,
  readEncryptedConfig,
  restoreWithPassword,
  setAsideEncryptedConfig,
  takeStartupNotice,
} from '@/security/startupRestore';

const ENCRYPTED = 'PNXPWD:salt:iv:cipher';

beforeEach(() => {
  m.files = new Map([['D:/data/.settings.dat', ENCRYPTED]]);
  m.initWithPassword.mockReset();
  m.failWrite = false;
  sessionStorage.clear();
});

describe('startupRestore', () => {
  it('读出数据文件夹里的加密配置', async () => {
    await expect(readEncryptedConfig()).resolves.toBe(ENCRYPTED);
  });

  it('密码对了：返回 restored，重新加载后弹一次「已还原」', async () => {
    m.initWithPassword.mockResolvedValue(undefined);
    await expect(restoreWithPassword(ENCRYPTED, 'right')).resolves.toBe('restored');
    expect(m.initWithPassword).toHaveBeenCalledWith(ENCRYPTED, 'right');
    expect(takeStartupNotice()).toEqual({ kind: 'restored' });
    expect(takeStartupNotice()).toBeNull();
  });

  it('密码不对：返回 wrong-password，不留通知', async () => {
    m.initWithPassword.mockRejectedValue(new Error('迁移密码不正确'));
    await expect(restoreWithPassword(ENCRYPTED, 'nope')).resolves.toBe('wrong-password');
    expect(takeStartupNotice()).toBeNull();
  });

  it('其他错误原样抛出（由调用方写原因）', async () => {
    m.initWithPassword.mockRejectedValue(new Error('钥匙串不可用'));
    await expect(restoreWithPassword(ENCRYPTED, 'x')).rejects.toThrow('钥匙串不可用');
  });

  it('另存的文件名带时间、扩展名 .json（「从文件导入…」只列 .json）', () => {
    expect(asideFileName(new Date(2026, 9, 19, 8, 5, 3))).toBe('picnexus-encrypted-settings-20261019-080503.json');
  });

  it('跳过：把加密配置原样另存在数据文件夹，再删掉原文件，并留下通知', async () => {
    const file = await setAsideEncryptedConfig(new Date(2026, 9, 19, 8, 5, 3));
    expect(file).toBe('picnexus-encrypted-settings-20261019-080503.json');
    expect(m.files.get('D:/data/picnexus-encrypted-settings-20261019-080503.json')).toBe(ENCRYPTED);
    expect(m.files.has('D:/data/.settings.dat')).toBe(false);
    expect(takeStartupNotice()).toEqual({ kind: 'skipped', file });
  });

  it('另存失败就不删原文件，也不留通知', async () => {
    m.failWrite = true;
    await expect(setAsideEncryptedConfig()).rejects.toThrow('磁盘已满');
    expect(m.files.get('D:/data/.settings.dat')).toBe(ENCRYPTED);
    expect(takeStartupNotice()).toBeNull();
  });

  it('加密配置已经不在（读不出来）：不另存、不留通知，返回 null 让调用方直接以默认配置重新加载', async () => {
    m.files.clear();
    await expect(setAsideEncryptedConfig()).resolves.toBeNull();
    expect([...m.files.keys()]).toEqual([]);
    expect(takeStartupNotice()).toBeNull();
  });

  it('通知内容坏了当作没有', () => {
    sessionStorage.setItem('picnexus-startup-notice', '{oops');
    expect(takeStartupNotice()).toBeNull();
  });
});
