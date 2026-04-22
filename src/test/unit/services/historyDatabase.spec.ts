import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryItem } from '../../../config/types';

type Row = Record<string, unknown>;

class MockDatabase {
  private rows: Row[] = [];

  async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
    const statement = sql.trim().toUpperCase();

    if (statement.startsWith('CREATE') || statement.startsWith('PRAGMA')) {
      return { rowsAffected: 0 };
    }

    if (statement.startsWith('INSERT OR IGNORE')) {
      const id = params[0] as string;
      const exists = this.rows.some((row) => row.id === id);
      if (exists) return { rowsAffected: 0 };
      return this.insertRow(params);
    }

    if (statement.startsWith('INSERT OR REPLACE') || statement.startsWith('INSERT')) {
      return this.insertRow(params);
    }

    if (statement.startsWith('UPDATE')) {
      if (statement.includes('WHERE ID IN')) {
        const nextSkip = params[0];
        const ids = params.slice(1);
        let affected = 0;
        this.rows = this.rows.map((row) => {
          if (!ids.includes(row.id)) return row;
          affected++;
          return { ...row, link_check_skip: nextSkip };
        });
        return { rowsAffected: affected };
      }

      const id = params[params.length - 1] as string;
      const index = this.rows.findIndex((row) => row.id === id);
      if (index === -1) return { rowsAffected: 0 };
      this.rows[index] = { ...this.rows[index], _updated: true };
      return { rowsAffected: 1 };
    }

    if (statement.startsWith('DELETE FROM HISTORY_ITEMS WHERE ID IN')) {
      const before = this.rows.length;
      this.rows = this.rows.filter((row) => !params.includes(row.id));
      return { rowsAffected: before - this.rows.length };
    }

    if (statement.startsWith('DELETE FROM HISTORY_ITEMS WHERE ID')) {
      const before = this.rows.length;
      this.rows = this.rows.filter((row) => row.id !== params[0]);
      return { rowsAffected: before - this.rows.length };
    }

    if (statement.startsWith('DELETE FROM HISTORY_ITEMS')) {
      const count = this.rows.length;
      this.rows = [];
      return { rowsAffected: count };
    }

    return { rowsAffected: 0 };
  }

  async select<T>(sql: string, params: unknown[] = []): Promise<T> {
    const statement = sql.trim().toUpperCase();

    if (statement.includes('COUNT(*)') && statement.includes('WHERE ID IN')) {
      const result: Row[] = params
        .map((id) => ({
          id,
          timestamp: this.rows.find((row) => row.id === id)?.timestamp ?? null,
        }))
        .filter((row) => row.timestamp !== null);
      return result as unknown as T;
    }

    if (statement.includes('COUNT(*)') && statement.includes('WHERE TIMESTAMP <=')) {
      const timestamp = params[0] as number;
      const count = this.rows.filter((row) => (row.timestamp as number) <= timestamp).length;
      return [{ count }] as unknown as T;
    }

    if (statement.includes('COUNT(*)')) {
      return [{ count: this.rows.length }] as unknown as T;
    }

    if (statement.includes('WHERE ID =')) {
      const id = params[0] as string;
      return this.rows.filter((row) => row.id === id) as unknown as T;
    }

    if (statement.includes('WHERE FILE_PATH =')) {
      const filePath = params[0] as string;
      return this.rows.filter((row) => row.file_path === filePath) as unknown as T;
    }

    return [...this.rows] as unknown as T;
  }

  async close(): Promise<void> {
    // noop
  }

  private insertRow(params: unknown[]): { rowsAffected: number } {
    this.rows.push({
      id: params[0],
      timestamp: params[1],
      local_file_name: params[2],
      local_file_name_lower: params[3],
      file_path: params[4],
      primary_service: params[5],
      results: params[6],
      generated_link: params[7],
      link_check_status: params[8],
      link_check_summary: params[9],
      link_check_skip: params[10],
      width: params[11],
      height: params[12],
      aspect_ratio: params[13],
      file_size: params[14],
      format: params[15],
      color_type: params[16],
      has_alpha: params[17],
      is_favorited: params[18],
      success_count: params[19],
      successful_service_ids: params[20],
      migration_skip: params[21],
    });
    return { rowsAffected: 1 };
  }
}

let mockDb: MockDatabase;

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn().mockImplementation(async () => mockDb),
  },
}));

function makeHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2)}`,
    timestamp: overrides.timestamp ?? Date.now(),
    localFileName: overrides.localFileName ?? 'photo.jpg',
    filePath: overrides.filePath ?? '/tmp/photo.jpg',
    primaryService: overrides.primaryService ?? 'weibo',
    results: overrides.results ?? [
      {
        serviceId: 'weibo',
        status: 'success',
        result: { serviceId: 'weibo', fileKey: 'k', url: 'https://example.com/a.jpg' },
      },
    ],
    generatedLink: overrides.generatedLink ?? 'https://example.com/a.jpg',
    width: overrides.width ?? 800,
    height: overrides.height ?? 600,
    aspectRatio: overrides.aspectRatio ?? 800 / 600,
    fileSize: overrides.fileSize ?? 102400,
    format: overrides.format ?? 'jpg',
    ...overrides,
  };
}

describe('HistoryDatabase', () => {
  beforeEach(async () => {
    mockDb = new MockDatabase();
    const { HistoryDatabase } = await import('../../../services/HistoryDatabase');
    (HistoryDatabase as unknown as { instance: null }).instance = null;
  });

  it('insert() then getById() returns the stored item', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeHistoryItem({ id: 'test-insert-1' }));

    const found = await historyDB.getById('test-insert-1');
    expect(found).not.toBeNull();
    expect(found?.id).toBe('test-insert-1');
    expect(found?.localFileName).toBe('photo.jpg');
  });

  it('delete() removes the row', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeHistoryItem({ id: 'test-delete-1' }));
    await historyDB.delete('test-delete-1');

    expect(await historyDB.getById('test-delete-1')).toBeNull();
  });

  it('insertOrIgnore() ignores duplicate ids', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    const item = makeHistoryItem({ id: 'dup-1' });

    const first = await historyDB.insertOrIgnore(item);
    const second = await historyDB.insertOrIgnore(item);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('deleteMany() removes multiple rows', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    for (const id of ['d1', 'd2', 'd3']) {
      await historyDB.insert(makeHistoryItem({ id }));
    }

    await historyDB.deleteMany(['d1', 'd2']);

    expect(await historyDB.getById('d1')).toBeNull();
    expect(await historyDB.getById('d2')).toBeNull();
    expect(await historyDB.getById('d3')).not.toBeNull();
  });

  it('setLinkCheckSkip() updates skip state in batch', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeHistoryItem({ id: 'skip-1' }));
    await historyDB.insert(makeHistoryItem({ id: 'skip-2' }));

    const affected = await historyDB.setLinkCheckSkip(['skip-1', 'skip-2'], true);

    expect(affected).toBe(2);
    expect((await historyDB.getById('skip-1'))?.linkCheckSkip).toBe(true);
    expect((await historyDB.getById('skip-2'))?.linkCheckSkip).toBe(true);
  });

  it('clear() removes all history', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeHistoryItem({ id: 'c1' }));
    await historyDB.insert(makeHistoryItem({ id: 'c2' }));

    await historyDB.clear();

    expect(await historyDB.getCount()).toBe(0);
  });

  it('importFromJSON() throws on non-array json', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await expect(historyDB.importFromJSON('{"not":"array"}', 'replace')).rejects.toThrow(
      '无效的 JSON 格式：期望数组',
    );
  });

  it('importFromJSON() throws when every row is invalid', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    const invalidItems = [{ foo: 'bar' }, { timestamp: 'not-a-number' }];
    await expect(
      historyDB.importFromJSON(JSON.stringify(invalidItems), 'replace'),
    ).rejects.toThrow('导入数据格式不匹配');
  });

  it('isInitialized() reflects connection lifecycle', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    // 先关一次，排除其它测试开过连接留下的状态
    await historyDB.close();
    expect(historyDB.isInitialized()).toBe(false);

    await historyDB.insert(makeHistoryItem({ id: 'init-check' }));
    expect(historyDB.isInitialized()).toBe(true);

    await historyDB.close();
    expect(historyDB.isInitialized()).toBe(false);
  });

  it('importFromJSON() replace strategy clears old data first', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeHistoryItem({ id: 'old-1' }));

    const importedCount = await historyDB.importFromJSON(
      JSON.stringify([makeHistoryItem({ id: 'new-1' })]),
      'replace',
    );

    expect(importedCount).toBe(1);
    expect(await historyDB.getById('old-1')).toBeNull();
    expect(await historyDB.getById('new-1')).not.toBeNull();
  });
});
