import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordMruEntry,
  removeMruEntry,
  clearAllMruEntries,
} from '@/composables/md-rescue/useMdRescueMru';

const STORAGE_KEY = 'mru.md-rescue';

function seedStorage(data: unknown): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function readStorage(): unknown {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe('useMdRescueMru - storage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('recordMruEntry', () => {
    it('首次记录：写入一条新项', () => {
      recordMruEntry('/path/a.md', 'file');
      const data = readStorage() as any[];
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ path: '/path/a.md', kind: 'file' });
      expect(typeof data[0].ts).toBe('number');
    });

    it('已存在时前移到首位', () => {
      recordMruEntry('/a.md', 'file');
      recordMruEntry('/b.md', 'file');
      recordMruEntry('/a.md', 'file');
      const data = readStorage() as any[];
      expect(data[0].path).toBe('/a.md');
      expect(data[1].path).toBe('/b.md');
      expect(data).toHaveLength(2);
    });

    it('超过上限（5 条）时截尾', () => {
      for (let i = 1; i <= 7; i++) {
        recordMruEntry(`/f${i}.md`, 'file');
      }
      const data = readStorage() as any[];
      expect(data).toHaveLength(5);
      expect(data[0].path).toBe('/f7.md');
      expect(data[4].path).toBe('/f3.md');
    });

    it('支持 folder 类型', () => {
      recordMruEntry('/dir', 'folder');
      const data = readStorage() as any[];
      expect(data[0].kind).toBe('folder');
    });
  });

  describe('removeMruEntry', () => {
    it('按 path 删除匹配项', () => {
      recordMruEntry('/a.md', 'file');
      recordMruEntry('/b.md', 'file');
      removeMruEntry('/a.md');
      const data = readStorage() as any[];
      expect(data).toHaveLength(1);
      expect(data[0].path).toBe('/b.md');
    });

    it('删除不存在的 path 安全无副作用', () => {
      recordMruEntry('/a.md', 'file');
      removeMruEntry('/ghost.md');
      const data = readStorage() as any[];
      expect(data).toHaveLength(1);
    });
  });

  describe('clearAllMruEntries', () => {
    it('清空存储', () => {
      recordMruEntry('/a.md', 'file');
      recordMruEntry('/b.md', 'file');
      clearAllMruEntries();
      const data = readStorage() as any[];
      expect(data).toEqual([]);
    });
  });

  describe('校验损坏数据', () => {
    it('非数组时视为空', () => {
      seedStorage({ broken: true });
      recordMruEntry('/x.md', 'file');
      const data = readStorage() as any[];
      expect(data).toHaveLength(1);
    });

    it('过滤掉字段不完整的项', () => {
      seedStorage([
        { path: '/ok.md', kind: 'file', ts: 123 },
        { path: '/bad.md' }, // 缺 kind / ts
        null,
        { path: 123, kind: 'file', ts: 123 }, // path 非字符串
        { path: '/bad2.md', kind: 'unknown', ts: 999 }, // kind 非法
      ]);
      recordMruEntry('/new.md', 'file');
      const data = readStorage() as any[];
      // 只保留 /ok.md 和新加的 /new.md
      expect(data.map((d: any) => d.path).sort()).toEqual(['/new.md', '/ok.md']);
    });

    it('JSON.parse 失败时安静回退', () => {
      localStorage.setItem(STORAGE_KEY, '{invalid json');
      recordMruEntry('/x.md', 'file');
      const data = readStorage() as any[];
      expect(data).toHaveLength(1);
    });
  });

  describe('localStorage 写入失败', () => {
    it('setItem 抛错被捕获', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(() => recordMruEntry('/a.md', 'file')).not.toThrow();
      spy.mockRestore();
    });
  });
});
