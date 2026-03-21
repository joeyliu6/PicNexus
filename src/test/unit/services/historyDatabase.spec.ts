import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HistoryItem } from '../../../config/types';

// ─── SQLite 内存 Mock ────────────────────────────────────────

type Row = Record<string, unknown>;

class MockDatabase {
  private rows: Row[] = [];

  async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
    const s = sql.trim().toUpperCase();

    if (s.startsWith('CREATE') || s.startsWith('PRAGMA')) {
      return { rowsAffected: 0 };
    }

    if (s.startsWith('INSERT OR IGNORE')) {
      const id = params[0] as string;
      const exists = this.rows.some(r => r.id === id);
      if (exists) return { rowsAffected: 0 };
      return this._doInsert(params);
    }

    if (s.startsWith('INSERT OR REPLACE') || s.startsWith('INSERT')) {
      return this._doInsert(params);
    }

    if (s.startsWith('UPDATE')) {
      // UPDATE history_items SET ... WHERE id = $17 (id is last param)
      const id = params[params.length - 1] as string;
      const idx = this.rows.findIndex(r => r.id === id);
      if (idx === -1) return { rowsAffected: 0 };
      // minimal update: just mark as updated
      this.rows[idx] = { ...this.rows[idx], _updated: true };
      return { rowsAffected: 1 };
    }

    if (s.startsWith('DELETE FROM HISTORY_ITEMS WHERE ID IN')) {
      const before = this.rows.length;
      this.rows = this.rows.filter(r => !params.includes(r.id));
      return { rowsAffected: before - this.rows.length };
    }

    if (s.startsWith('DELETE FROM HISTORY_ITEMS WHERE ID')) {
      const before = this.rows.length;
      this.rows = this.rows.filter(r => r.id !== params[0]);
      return { rowsAffected: before - this.rows.length };
    }

    if (s.startsWith('DELETE FROM HISTORY_ITEMS')) {
      const count = this.rows.length;
      this.rows = [];
      return { rowsAffected: count };
    }

    return { rowsAffected: 0 };
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    const s = sql.trim().toUpperCase();

    if (s.includes('COUNT(*)') && s.includes('WHERE ID IN')) {
      // batch exists query
      const result: Row[] = params.map(id => ({
        id,
        timestamp: this.rows.find(r => r.id === id)?.timestamp ?? null,
      })).filter(r => r.timestamp !== null);
      return result as unknown as T;
    }

    if (s.includes('COUNT(*)') && s.includes('WHERE TIMESTAMP <=')) {
      const ts = params[0] as number;
      const count = this.rows.filter(r => (r.timestamp as number) <= ts).length;
      return [{ count }] as unknown as T;
    }

    if (s.includes('COUNT(*)')) {
      return [{ count: this.rows.length }] as unknown as T;
    }

    if (s.includes('WHERE ID =')) {
      const id = params[0] as string;
      const found = this.rows.filter(r => r.id === id);
      return found as unknown as T;
    }

    if (s.includes('WHERE FILE_PATH =')) {
      const fp = params[0] as string;
      return this.rows.filter(r => r.file_path === fp) as unknown as T;
    }

    // Default: return all rows (ORDER BY + LIMIT handled simply)
    return [...this.rows] as unknown as T;
  }

  async close(): Promise<void> { /* no-op */ }

  // ── internal ──
  private _doInsert(params: unknown[]): { rowsAffected: number } {
    // param order: id, timestamp, local_file_name, local_file_name_lower, file_path,
    //   primary_service, results, generated_link, link_check_status, link_check_summary,
    //   width, height, aspect_ratio, file_size, format, color_type, has_alpha
    this.rows.push({
      id:                    params[0],
      timestamp:             params[1],
      local_file_name:       params[2],
      local_file_name_lower: params[3],
      file_path:             params[4],
      primary_service:       params[5],
      results:               params[6],
      generated_link:        params[7],
      link_check_status:     params[8],
      link_check_summary:    params[9],
      width:                 params[10],
      height:                params[11],
      aspect_ratio:          params[12],
      file_size:             params[13],
      format:                params[14],
      color_type:            params[15],
      has_alpha:             params[16],
    });
    return { rowsAffected: 1 };
  }
}

// ─── Mock @tauri-apps/plugin-sql ────────────────────────────

let mockDb: MockDatabase;

vi.mock('@tauri-apps/plugin-sql', () => {
  return {
    default: {
      load: vi.fn().mockImplementation(async () => mockDb),
    },
  };
});

// ─── 测试数据工厂 ────────────────────────────────────────────

function makeHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id:             overrides.id ?? `id-${Math.random().toString(36).slice(2)}`,
    timestamp:      overrides.timestamp ?? Date.now(),
    localFileName:  overrides.localFileName ?? 'photo.jpg',
    filePath:       overrides.filePath ?? '/tmp/photo.jpg',
    primaryService: overrides.primaryService ?? 'weibo',
    results:        overrides.results ?? [{ serviceId: 'weibo', status: 'success', result: { serviceId: 'weibo', fileKey: 'k', url: 'https://example.com/a.jpg' } }],
    generatedLink:  overrides.generatedLink ?? 'https://example.com/a.jpg',
    width:          overrides.width ?? 800,
    height:         overrides.height ?? 600,
    aspectRatio:    overrides.aspectRatio ?? 800 / 600,
    fileSize:       overrides.fileSize ?? 102400,
    format:         overrides.format ?? 'jpg',
    ...overrides,
  };
}

// ─── 测试 ────────────────────────────────────────────────────

describe('HistoryDatabase', () => {
  beforeEach(async () => {
    // 每个测试独立的内存数据库
    mockDb = new MockDatabase();
    // 重置单例状态
    const { HistoryDatabase } = await import('../../../services/HistoryDatabase');
    (HistoryDatabase as unknown as { instance: null }).instance = null;
  });

  it('insert() → 写入后 getById() 可查询到', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    const item = makeHistoryItem({ id: 'test-insert-1' });
    await historyDB.insert(item);

    const found = await historyDB.getById('test-insert-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('test-insert-1');
    expect(found!.localFileName).toBe('photo.jpg');
  });

  it('delete() → 删除后 getById() 返回 null', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    const item = makeHistoryItem({ id: 'test-delete-1' });
    await historyDB.insert(item);
    await historyDB.delete('test-delete-1');

    const found = await historyDB.getById('test-delete-1');
    expect(found).toBeNull();
  });

  it('insertOrIgnore() → 重复 ID 不重复插入', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    const item = makeHistoryItem({ id: 'dup-1' });

    const first  = await historyDB.insertOrIgnore(item);
    const second = await historyDB.insertOrIgnore(item);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('deleteMany() → 批量删除', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    const items = ['d1', 'd2', 'd3'].map(id => makeHistoryItem({ id }));
    for (const item of items) await historyDB.insert(item);

    await historyDB.deleteMany(['d1', 'd2']);

    expect(await historyDB.getById('d1')).toBeNull();
    expect(await historyDB.getById('d2')).toBeNull();
    expect(await historyDB.getById('d3')).not.toBeNull();
  });

  it('clear() → 清空所有记录', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeHistoryItem({ id: 'c1' }));
    await historyDB.insert(makeHistoryItem({ id: 'c2' }));

    await historyDB.clear();
    const count = await historyDB.getCount();
    expect(count).toBe(0);
  });

  it('importFromJSON() → 非数组 JSON 抛出错误', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await expect(historyDB.importFromJSON('{"not":"array"}', 'replace')).rejects.toThrow(
      '无效的 JSON 格式：期望数组'
    );
  });

  it('importFromJSON() → 格式不合法的数据全部被过滤后抛出错误', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    const invalidItems = [{ foo: 'bar' }, { timestamp: 'not-a-number' }];
    await expect(
      historyDB.importFromJSON(JSON.stringify(invalidItems), 'replace')
    ).rejects.toThrow('导入数据格式不匹配');
  });

  it('importFromJSON() replace 策略 → 清空后导入', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    // 先插入一条旧数据
    await historyDB.insert(makeHistoryItem({ id: 'old-1' }));

    const newItems = [makeHistoryItem({ id: 'new-1' })];
    const count = await historyDB.importFromJSON(JSON.stringify(newItems), 'replace');

    expect(count).toBe(1);
    expect(await historyDB.getById('old-1')).toBeNull();
    expect(await historyDB.getById('new-1')).not.toBeNull();
  });
});
