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
      // 通用 UPDATE：HistoryDatabase.update() 按 ALL_COLUMNS.slice(1) 顺序传参（去掉 id 列），末尾追加 id
      const updateColumns = [
        'timestamp', 'local_file_name', 'local_file_name_lower', 'file_path',
        'primary_service', 'results', 'generated_link', 'link_check_status',
        'link_check_summary', 'link_check_skip', 'width', 'height', 'aspect_ratio',
        'file_size', 'format', 'color_type', 'has_alpha', 'is_favorited',
        'favorite_updated_at', 'favorite_updated_by',
        'success_count', 'successful_service_ids', 'migration_skip',
      ];
      const next: Row = { ...this.rows[index] };
      for (let i = 0; i < updateColumns.length && i < params.length - 1; i++) {
        next[updateColumns[i]] = params[i];
      }
      this.rows[index] = next;
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
      const rows = this.rows.filter((row) => row.file_path === filePath);
      if (statement.includes('ORDER BY TIMESTAMP DESC')) {
        return rows
          .toSorted((a, b) => (b.timestamp as number) - (a.timestamp as number)) as unknown as T;
      }
      return rows as unknown as T;
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
      favorite_updated_at: params[19],
      favorite_updated_by: params[20],
      success_count: params[21],
      successful_service_ids: params[22],
      migration_skip: params[23],
    });
    return { rowsAffected: 1 };
  }
}

let mockDb: MockDatabase;

// Keep plugin-sql local: this suite needs a stateful in-memory SQL adapter.
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

  it('getByFilePath() returns the newest matching row deterministically', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeHistoryItem({
      id: 'same-path-old',
      filePath: '/tmp/same.png',
      timestamp: 100,
      generatedLink: 'https://example.com/old.jpg',
    }));
    await historyDB.insert(makeHistoryItem({
      id: 'same-path-new',
      filePath: '/tmp/same.png',
      timestamp: 200,
      generatedLink: 'https://example.com/new.jpg',
    }));

    const found = await historyDB.getByFilePath('/tmp/same.png');

    expect(found?.id).toBe('same-path-new');
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

  // ==================== 镜像管理 ====================

  function makeMultiMirrorItem(id: string): HistoryItem {
    return makeHistoryItem({
      id,
      primaryService: 'weibo',
      generatedLink: 'https://example.com/weibo.jpg',
      results: [
        {
          serviceId: 'weibo',
          status: 'success',
          result: { serviceId: 'weibo', url: 'https://example.com/weibo.jpg', fileKey: 'weibo-file-key' },
        },
        {
          serviceId: 'r2',
          status: 'success',
          result: { serviceId: 'r2', url: 'https://example.com/r2.jpg', fileKey: 'r2-file-key' },
        },
        {
          serviceId: 'jd',
          status: 'failed',
          error: 'upload failed',
        },
      ],
      linkCheckStatus: {
        weibo: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
        r2: { isValid: true, lastCheckTime: 1, errorType: 'success' },
      },
    });
  }

  it('switchPrimaryService() 切主服务到已成功上传的镜像', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeMultiMirrorItem('mirror-switch-1'));

    await historyDB.switchPrimaryService('mirror-switch-1', 'r2');

    const updated = await historyDB.getById('mirror-switch-1');
    expect(updated?.primaryService).toBe('r2');
    expect(updated?.generatedLink).toBe('https://example.com/r2.jpg');
  });

  it('switchPrimaryService() 切到相同主服务时为 no-op', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeMultiMirrorItem('mirror-switch-noop'));

    await expect(
      historyDB.switchPrimaryService('mirror-switch-noop', 'weibo'),
    ).resolves.toBeUndefined();

    const updated = await historyDB.getById('mirror-switch-noop');
    expect(updated?.primaryService).toBe('weibo');
  });

  it('switchPrimaryService() 目标镜像未成功上传时抛错', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeMultiMirrorItem('mirror-switch-fail'));

    await expect(
      historyDB.switchPrimaryService('mirror-switch-fail', 'jd'),
    ).rejects.toThrow(/目标镜像不可用/);
  });

  it('switchPrimaryService() 目标镜像不存在时抛错', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeMultiMirrorItem('mirror-switch-missing'));

    await expect(
      historyDB.switchPrimaryService('mirror-switch-missing', 'github'),
    ).rejects.toThrow(/目标镜像不可用/);
  });

  it('switchPrimaryService() 记录不存在时抛错', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await expect(
      historyDB.switchPrimaryService('nope', 'r2'),
    ).rejects.toThrow(/记录不存在/);
  });

  it('removeMirror() 删除非主服务镜像并清理 linkCheckStatus', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeMultiMirrorItem('mirror-remove-1'));

    await historyDB.removeMirror('mirror-remove-1', 'r2');

    const updated = await historyDB.getById('mirror-remove-1');
    expect(updated?.results.some(r => r.serviceId === 'r2')).toBe(false);
    expect(updated?.linkCheckStatus?.r2).toBeUndefined();
    expect(updated?.linkCheckStatus?.weibo).toBeDefined();
  });

  it('removeMirror() 删除失败的镜像也允许', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeMultiMirrorItem('mirror-remove-failed'));

    await historyDB.removeMirror('mirror-remove-failed', 'jd');

    const updated = await historyDB.getById('mirror-remove-failed');
    expect(updated?.results.some(r => r.serviceId === 'jd')).toBe(false);
  });

  it('removeMirror() 删除当前主服务时抛错', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeMultiMirrorItem('mirror-remove-primary'));

    await expect(
      historyDB.removeMirror('mirror-remove-primary', 'weibo'),
    ).rejects.toThrow(/无法删除当前主服务镜像/);
  });

  it('removeMirror() 镜像不存在时抛错', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    await historyDB.insert(makeMultiMirrorItem('mirror-remove-missing'));

    await expect(
      historyDB.removeMirror('mirror-remove-missing', 'github'),
    ).rejects.toThrow(/镜像不存在/);
  });

  it('removeMirror() 删镜像后同步 linkCheckSummary（按 success 口径重算）', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    const item = makeMultiMirrorItem('mirror-remove-summary');
    // weibo: invalid, r2: valid；failed 的 jd 不计入 summary
    item.linkCheckSummary = {
      totalLinks: 2,
      validLinks: 1,
      invalidLinks: 1,
      uncheckedLinks: 0,
      lastCheckTime: 1,
    };
    await historyDB.insert(item);

    // 删 r2（非主服务、valid）→ 剩 weibo(invalid)
    await historyDB.removeMirror('mirror-remove-summary', 'r2');

    const updated = await historyDB.getById('mirror-remove-summary');
    expect(updated?.linkCheckSummary).toMatchObject({
      totalLinks: 1,
      validLinks: 0,
      invalidLinks: 1,
      uncheckedLinks: 0,
    });
  });

  it('removeMirror() 原本无 linkCheckSummary 时不凭空创建', async () => {
    const { historyDB } = await import('../../../services/HistoryDatabase');
    // makeMultiMirrorItem 默认不设 linkCheckSummary
    await historyDB.insert(makeMultiMirrorItem('mirror-remove-no-summary'));

    await historyDB.removeMirror('mirror-remove-no-summary', 'r2');

    const updated = await historyDB.getById('mirror-remove-no-summary');
    expect(updated?.linkCheckSummary).toBeUndefined();
  });
});
