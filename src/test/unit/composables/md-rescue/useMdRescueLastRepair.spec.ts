import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/plugin-fs', () => ({
  copyFile: vi.fn(),
  exists: vi.fn(),
}));

import { copyFile, exists } from '@tauri-apps/plugin-fs';
import {
  readLastRepair,
  saveLastRepair,
  clearLastRepair,
  undoLastRepair,
  isLastRepairRestorable,
  type LastRepairRecord,
} from '../../../../composables/md-rescue/useMdRescueLastRepair';

const STORAGE_KEY = 'lastRepair.md-rescue';

const mockCopyFile = vi.mocked(copyFile);
const mockExists = vi.mocked(exists);

function makeRecord(partial: Partial<LastRepairRecord> = {}): LastRepairRecord {
  return {
    date: 1_700_000_000,
    filesFixed: 2,
    linksFixed: 5,
    backupPath: '/backup',
    fileBackupMap: [],
    ...partial,
  };
}

describe('readLastRepair / saveLastRepair / clearLastRepair', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('空存储返回 null', () => {
    expect(readLastRepair()).toBeNull();
  });

  it('save 后能读回完整记录', () => {
    const record = makeRecord({ filesFixed: 9 });
    saveLastRepair(record);
    expect(readLastRepair()).toEqual(record);
  });

  it('clear 后读回 null', () => {
    saveLastRepair(makeRecord());
    clearLastRepair();
    expect(readLastRepair()).toBeNull();
  });

  it('存储内容格式非法 → 视为 null', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
    expect(readLastRepair()).toBeNull();
  });

  it('存储内容非 JSON → 安静返回 null', () => {
    localStorage.setItem(STORAGE_KEY, '{not-json');
    expect(readLastRepair()).toBeNull();
  });

  it('字段类型错误 → 被 isRecord 拒绝', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      date: 'not-a-number',
      filesFixed: 1,
      linksFixed: 1,
      backupPath: '/b',
      fileBackupMap: [],
    }));
    expect(readLastRepair()).toBeNull();
  });

  it('setItem 抛错被捕获', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveLastRepair(makeRecord())).not.toThrow();
    spy.mockRestore();
  });

  it('removeItem 抛错被捕获', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('err');
    });
    expect(() => clearLastRepair()).not.toThrow();
    spy.mockRestore();
  });
});

describe('undoLastRepair', () => {
  beforeEach(() => {
    mockCopyFile.mockReset();
  });

  it('全部成功', async () => {
    mockCopyFile.mockResolvedValue(undefined);
    const record = makeRecord({
      fileBackupMap: [
        { original: '/a.md', backup: '/b/a.bak' },
        { original: '/b.md', backup: '/b/b.bak' },
      ],
    });
    const result = await undoLastRepair(record);
    expect(result).toEqual({ restored: 2, failed: 0 });
    expect(mockCopyFile).toHaveBeenCalledTimes(2);
  });

  it('部分失败', async () => {
    mockCopyFile
      .mockRejectedValueOnce(new Error('perm'))
      .mockResolvedValueOnce(undefined);
    const record = makeRecord({
      fileBackupMap: [
        { original: '/a.md', backup: '/b/a.bak' },
        { original: '/b.md', backup: '/b/b.bak' },
      ],
    });
    const result = await undoLastRepair(record);
    expect(result).toEqual({ restored: 1, failed: 1 });
  });

  it('空映射', async () => {
    const result = await undoLastRepair(makeRecord({ fileBackupMap: [] }));
    expect(result).toEqual({ restored: 0, failed: 0 });
  });
});

describe('isLastRepairRestorable', () => {
  beforeEach(() => {
    mockExists.mockReset();
  });

  it('备份目录存在 → true', async () => {
    mockExists.mockResolvedValue(true);
    expect(await isLastRepairRestorable(makeRecord())).toBe(true);
  });

  it('备份目录不存在 → false', async () => {
    mockExists.mockResolvedValue(false);
    expect(await isLastRepairRestorable(makeRecord())).toBe(false);
  });

  it('exists 抛错 → false', async () => {
    mockExists.mockRejectedValue(new Error('fs'));
    expect(await isLastRepairRestorable(makeRecord())).toBe(false);
  });
});
