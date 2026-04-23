import { describe, it, expect, beforeEach, vi } from 'vitest';

// 覆盖 setup.ts 里没有 readDir 的 plugin-fs mock
vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(),
  remove: vi.fn(),
}));

import { readDir, remove } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import { cleanupStoreBackups } from '../../../utils/storeCleanup';

const mockReadDir = vi.mocked(readDir);
const mockRemove = vi.mocked(remove);
const mockAppDataDir = vi.mocked(appDataDir);

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function makeEntry(name: string, isFile = true) {
  return { name, isFile, isDirectory: false, isSymlink: false } as Awaited<ReturnType<typeof readDir>>[number];
}

describe('cleanupStoreBackups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppDataDir.mockResolvedValue('/mock/appdata');
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  it('无备份文件时不调用 remove', async () => {
    mockReadDir.mockResolvedValue([
      makeEntry('unrelated.txt'),
      makeEntry('.settings.dat'),
    ]);
    await cleanupStoreBackups();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('备份不足 KEEP_COUNT 时不删除', async () => {
    const entries = [
      makeEntry(`.settings.dat.corrupted.${NOW - 40 * DAY_MS}`),
      makeEntry(`.settings.dat.corrupted.${NOW - 50 * DAY_MS}`),
    ];
    mockReadDir.mockResolvedValue(entries);
    await cleanupStoreBackups();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('保留最新 KEEP_COUNT 个，删除超龄的旧备份', async () => {
    const backups: string[] = [];
    // 5 个超过 30 天的备份（都是旧的）
    for (let i = 1; i <= 5; i++) {
      backups.push(`.settings.dat.corrupted.${NOW - (40 + i) * DAY_MS}`);
    }
    mockReadDir.mockResolvedValue(backups.map(name => makeEntry(name)));

    await cleanupStoreBackups();

    // 按时间倒序，保留最新 3 个，删除最后 2 个
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });

  it('年龄未超 30 天不删除，即使超过 KEEP_COUNT', async () => {
    const backups: string[] = [];
    for (let i = 1; i <= 5; i++) {
      backups.push(`.settings.dat.corrupted.${NOW - i * DAY_MS}`);
    }
    mockReadDir.mockResolvedValue(backups.map(name => makeEntry(name)));

    await cleanupStoreBackups();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('识别 .invalid 后缀的备份', async () => {
    const backups: string[] = [];
    for (let i = 1; i <= 5; i++) {
      backups.push(`.settings.dat.invalid.${NOW - (40 + i) * DAY_MS}`);
    }
    mockReadDir.mockResolvedValue(backups.map(name => makeEntry(name)));

    await cleanupStoreBackups();
    expect(mockRemove).toHaveBeenCalled();
  });

  it('非文件条目被忽略', async () => {
    mockReadDir.mockResolvedValue([
      { name: `.settings.dat.corrupted.${NOW - 100 * DAY_MS}`, isFile: false, isDirectory: true, isSymlink: false } as any,
    ]);
    await cleanupStoreBackups();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('时间戳不是有效数字 → 不识别为备份', async () => {
    mockReadDir.mockResolvedValue([
      makeEntry('.settings.dat.corrupted.notanumber'),
      makeEntry('.settings.dat.corrupted.-1'),
    ]);
    await cleanupStoreBackups();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('readDir 抛错时不抛出（静默失败）', async () => {
    mockReadDir.mockRejectedValue(new Error('fs error'));
    await expect(cleanupStoreBackups()).resolves.toBeUndefined();
  });

  it('删除失败被捕获，不影响其他文件删除', async () => {
    const backups: string[] = [];
    for (let i = 1; i <= 5; i++) {
      backups.push(`.settings.dat.corrupted.${NOW - (40 + i) * DAY_MS}`);
    }
    mockReadDir.mockResolvedValue(backups.map(name => makeEntry(name)));
    mockRemove.mockRejectedValueOnce(new Error('EACCES')).mockResolvedValue(undefined);

    await expect(cleanupStoreBackups()).resolves.toBeUndefined();
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });
});
