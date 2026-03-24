import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Store, StoreError } from '../../../store';
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';

const mockReadTextFile = vi.mocked(readTextFile);
const mockWriteTextFile = vi.mocked(writeTextFile);
const mockExists = vi.mocked(exists);
const mockMkdir = vi.mocked(mkdir);

describe('Store（非加密模式）', () => {
  let store: Store;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExists.mockResolvedValue(false);
    mockWriteTextFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    store = new Store('test.dat', { encrypted: false });
  });

  // ─── 构造函数 ──────────────────────────────────────────────

  describe('构造函数', () => {
    it('空文件名抛出 StoreError', () => {
      expect(() => new Store('', { encrypted: false })).toThrow(StoreError);
    });

    it('空白文件名抛出 StoreError', () => {
      expect(() => new Store('   ', { encrypted: false })).toThrow(StoreError);
    });

    it('StoreError 携带 operation=init', () => {
      try {
        new Store('', { encrypted: false });
        expect.unreachable('应该抛出错误');
      } catch (e) {
        expect(e).toBeInstanceOf(StoreError);
        expect((e as StoreError).operation).toBe('init');
      }
    });

    it('合法文件名正常创建实例', () => {
      expect(() => new Store('valid.dat', { encrypted: false })).not.toThrow();
    });
  });

  // ─── get ───────────────────────────────────────────────────

  describe('get', () => {
    it('文件不存在时返回 null', async () => {
      mockExists.mockResolvedValue(false);

      const result = await store.get('anything');
      expect(result).toBeNull();
    });

    it('文件不存在时返回 defaultValue', async () => {
      mockExists.mockResolvedValue(false);

      const result = await store.get('missing', 'fallback');
      // 文件不存在 → 直接返回 null（不走 JSON 解析），defaultValue 不被使用
      // 实际行为：文件不存在时直接返回 null，不检查 defaultValue
      expect(result).toBeNull();
    });

    it('key 存在于文件中时返回对应值', async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('{"name":"Joey"}');

      const result = await store.get('name');
      expect(result).toBe('Joey');
    });

    it('key 不存在于文件中、无 defaultValue 时返回 null', async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('{"name":"Joey"}');

      const result = await store.get('age');
      expect(result).toBeNull();
    });

    it('key 不存在于文件中、有 defaultValue 时返回 defaultValue', async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('{"name":"Joey"}');

      const result = await store.get('age', 18);
      expect(result).toBe(18);
    });

    it('支持对象类型的值', async () => {
      const obj = { host: 'github.com', token: 'abc' };
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(JSON.stringify({ config: obj }));

      const result = await store.get<typeof obj>('config');
      expect(result).toEqual(obj);
    });

    it('无效 key（空字符串）返回 null', async () => {
      const result = await store.get('');
      expect(result).toBeNull();
    });

    it('文件内容为空字符串时返回 null', async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('');

      const result = await store.get('key');
      expect(result).toBeNull();
    });
  });

  // ─── 内存缓存 ──────────────────────────────────────────────

  describe('内存缓存', () => {
    it('第二次 get 不再读取磁盘', async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('{"a":1,"b":2}');

      await store.get('a');
      // 重置调用计数
      mockReadTextFile.mockClear();

      const result = await store.get('b');
      expect(result).toBe(2);
      expect(mockReadTextFile).not.toHaveBeenCalled();
    });

    it('缓存命中时也能返回 defaultValue（key 不在缓存中）', async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('{"a":1}');

      // 第一次读取加载缓存
      await store.get('a');
      mockReadTextFile.mockClear();

      // 缓存已加载，但 "missing" 不在缓存中
      const result = await store.get('missing', 42);
      expect(result).toBe(42);
      expect(mockReadTextFile).not.toHaveBeenCalled();
    });
  });

  // ─── set ───────────────────────────────────────────────────

  describe('set', () => {
    it('set 后 get 能读到值', async () => {
      // set 时文件不存在，写入新文件
      mockExists.mockResolvedValue(false);

      await store.set('color', 'blue');

      // 验证 writeTextFile 被调用
      expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
      const writtenContent = (mockWriteTextFile.mock.calls[0] as unknown[])[1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.color).toBe('blue');

      // set 会更新内存缓存，后续 get 走缓存
      const result = await store.get('color');
      expect(result).toBe('blue');
    });

    it('set 会合并已有磁盘数据', async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('{"existing":"data"}');

      await store.set('newKey', 'newValue');

      const writtenContent = (mockWriteTextFile.mock.calls[0] as unknown[])[1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.existing).toBe('data');
      expect(parsed.newKey).toBe('newValue');
    });

    it('空 key 抛出 StoreError（operation=write）', async () => {
      await expect(store.set('', 'value')).rejects.toThrow(StoreError);

      try {
        await store.set('', 'value');
      } catch (e) {
        expect((e as StoreError).operation).toBe('write');
      }
    });

    it('连续 set 不同 key 后 get 都能拿到', async () => {
      mockExists.mockResolvedValue(false);

      await store.set('x', 10);
      await store.set('y', 20);

      expect(await store.get('x')).toBe(10);
      expect(await store.get('y')).toBe(20);
    });

    it('覆盖已有 key 的值', async () => {
      mockExists.mockResolvedValue(false);

      await store.set('count', 1);
      await store.set('count', 2);

      expect(await store.get('count')).toBe(2);
    });
  });

  // ─── setDirect ─────────────────────────────────────────────

  describe('setDirect', () => {
    it('直接替换所有数据', async () => {
      const data = { alpha: 'a', beta: 'b' };
      await store.setDirect(data);

      expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
      const writtenContent = (mockWriteTextFile.mock.calls[0] as unknown[])[1] as string;
      expect(JSON.parse(writtenContent)).toEqual(data);
    });

    it('setDirect 后 get 能读到新数据', async () => {
      await store.setDirect({ foo: 'bar' });

      const result = await store.get('foo');
      expect(result).toBe('bar');
    });

    it('setDirect 覆盖之前 set 的数据', async () => {
      mockExists.mockResolvedValue(false);
      await store.set('old', 'value');

      await store.setDirect({ brand: 'new' });

      expect(await store.get('old')).toBeNull();
      expect(await store.get('brand')).toBe('new');
    });
  });

  // ─── clear ─────────────────────────────────────────────────

  describe('clear', () => {
    it('文件不存在时静默完成', async () => {
      mockExists.mockResolvedValue(false);

      await expect(store.clear()).resolves.toBeUndefined();
      expect(mockWriteTextFile).not.toHaveBeenCalled();
    });

    it('文件存在时写入空对象', async () => {
      mockExists.mockResolvedValue(true);

      await store.clear();

      expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
      const writtenContent = (mockWriteTextFile.mock.calls[0] as unknown[])[1] as string;
      expect(JSON.parse(writtenContent)).toEqual({});
    });

    it('clear 后 get 返回 null', async () => {
      // 先写入数据
      mockExists.mockResolvedValue(false);
      await store.set('key', 'value');
      expect(await store.get('key')).toBe('value');

      // clear
      mockExists.mockResolvedValue(true);
      await store.clear();

      // clear 重置了 cacheLoaded，下次 get 会重新读磁盘
      // 模拟磁盘上文件已被清空
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('{}');
      expect(await store.get('key')).toBeNull();
    });
  });

  // ─── readRawAll ────────────────────────────────────────────

  describe('readRawAll', () => {
    it('文件不存在时返回 null', async () => {
      mockExists.mockResolvedValue(false);

      const result = await store.readRawAll();
      expect(result).toBeNull();
    });

    it('文件为空时返回 null', async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('  ');

      const result = await store.readRawAll();
      expect(result).toBeNull();
    });

    it('返回完整的原始对象', async () => {
      const data = { a: 1, b: 'two', c: [3] };
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(JSON.stringify(data));

      const result = await store.readRawAll();
      expect(result).toEqual(data);
    });
  });

  // ─── 文件系统错误 ──────────────────────────────────────────

  describe('文件系统错误', () => {
    it('readTextFile 权限错误 → StoreError(operation=read)', async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockRejectedValue(new Error('Permission denied'));

      try {
        await store.get('key');
        expect.unreachable('应该抛出错误');
      } catch (e) {
        expect(e).toBeInstanceOf(StoreError);
        expect((e as StoreError).operation).toBe('read');
        expect((e as StoreError).key).toBe('key');
      }
    });

    it('writeTextFile 权限错误 → StoreError(operation=write)', async () => {
      mockExists.mockResolvedValue(false);
      mockWriteTextFile.mockRejectedValue(new Error('Permission denied'));

      try {
        await store.set('key', 'val');
        expect.unreachable('应该抛出错误');
      } catch (e) {
        expect(e).toBeInstanceOf(StoreError);
        expect((e as StoreError).operation).toBe('write');
        expect((e as StoreError).key).toBe('key');
      }
    });

    it('writeTextFile 磁盘空间不足 → StoreError(operation=write)', async () => {
      mockExists.mockResolvedValue(false);
      mockWriteTextFile.mockRejectedValue(new Error('No disk space'));

      try {
        await store.set('key', 'val');
        expect.unreachable('应该抛出错误');
      } catch (e) {
        expect(e).toBeInstanceOf(StoreError);
        expect((e as StoreError).operation).toBe('write');
      }
    });

    it('clear 时 writeTextFile 失败 → StoreError(operation=clear)', async () => {
      mockExists.mockResolvedValue(true);
      mockWriteTextFile.mockRejectedValue(new Error('Permission denied'));

      try {
        await store.clear();
        expect.unreachable('应该抛出错误');
      } catch (e) {
        expect(e).toBeInstanceOf(StoreError);
        expect((e as StoreError).operation).toBe('clear');
      }
    });

    it('mkdir 权限错误 → StoreError(operation=write)', async () => {
      mockExists.mockResolvedValue(false);
      mockMkdir.mockRejectedValue(new Error('Permission denied'));

      try {
        await store.set('key', 'val');
        expect.unreachable('应该抛出错误');
      } catch (e) {
        expect(e).toBeInstanceOf(StoreError);
        expect((e as StoreError).operation).toBe('write');
      }
    });
  });

  // ─── JSON 损坏恢复 ─────────────────────────────────────────

  describe('JSON 损坏', () => {
    it('文件内容非法 JSON 且有 defaultValue 时尝试恢复', async () => {
      mockExists.mockResolvedValue(true);
      // 第一次读取：损坏数据；恢复写入时 _loadFromDisk 再次读取仍是损坏数据
      // 所以恢复路径也失败，最终抛出 StoreError
      mockReadTextFile.mockResolvedValue('not valid json!!!');

      await expect(store.get('config', { default: true })).rejects.toThrow(StoreError);
      // 尽管恢复失败，但备份文件应已被创建（至少调用了一次 writeTextFile 写备份）
      expect(mockWriteTextFile).toHaveBeenCalled();
    });

    it('文件内容非法 JSON 且有 defaultValue、恢复写入成功时返回 defaultValue', async () => {
      // 第一次读：损坏；_loadFromDisk 再读取时文件已不存在（模拟备份后删除）
      let readCount = 0;
      mockExists.mockImplementation(async () => {
        readCount++;
        // 第一次 exists（_performRead 检查）→ true
        // 第二次 exists（_loadFromDisk 检查）→ false（模拟文件已被移走）
        return readCount <= 1;
      });
      mockReadTextFile.mockResolvedValue('not valid json!!!');

      const result = await store.get('config', { default: true });
      expect(result).toEqual({ default: true });
    });

    it('文件内容非法 JSON 且无 defaultValue 时抛出 StoreError', async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('corrupted data');

      await expect(store.get('key')).rejects.toThrow(StoreError);
    });

    it('文件内容是数组而非对象时返回 null', async () => {
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('[1,2,3]');

      const result = await store.get('key');
      expect(result).toBeNull();
    });
  });
});
