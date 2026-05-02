import { describe, expect, it, vi } from 'vitest';
import {
  ALL_COLUMNS,
  columnPlaceholders,
  itemToRow,
  rowToItem,
  rowValues,
  safeJsonParse,
} from '../../../../services/database/DataTransformer';

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeHistoryItem() {
  return {
    id: 'alpha',
    timestamp: 1000,
    localFileName: 'Alpha.PNG',
    filePath: '/tmp/Alpha.PNG',
    primaryService: 'weibo',
    results: [
      {
        serviceId: 'weibo',
        status: 'success' as const,
        result: {
          serviceId: 'weibo',
          fileKey: 'alpha-key',
          url: 'https://img.example.com/alpha.png',
          width: 100,
          height: 80,
          size: 12,
        },
      },
      {
        serviceId: 'r2',
        status: 'failed' as const,
        error: 'boom',
      },
    ],
    generatedLink: 'https://img.example.com/alpha.png',
    linkCheckStatus: {
      weibo: {
        isValid: true,
        lastCheckTime: 2000,
        errorType: 'success' as const,
      },
    },
    linkCheckSummary: {
      totalLinks: 1,
      validLinks: 1,
      invalidLinks: 0,
      uncheckedLinks: 0,
      lastCheckTime: 2000,
    },
    width: 100,
    height: 80,
    aspectRatio: 1.25,
    fileSize: 12,
    format: 'png',
    isFavorited: true,
    migrationSkip: true,
  };
}

describe('DataTransformer', () => {
  it('maps a HistoryItem into the flattened database row shape', () => {
    const row = itemToRow(makeHistoryItem() as never);

    expect(row.local_file_name).toBe('Alpha.PNG');
    expect(row.local_file_name_lower).toBe('alpha.png');
    expect(row.file_path).toBe('/tmp/Alpha.PNG');
    // link_check_skip 列保留但功能已废弃，始终写入 0
    expect(row.link_check_skip).toBe(0);
    expect(row.is_favorited).toBe(1);
    expect(row.favorite_updated_at).toBe(1000);
    expect(row.favorite_updated_by).toBe('legacy');
    expect(row.migration_skip).toBe(1);
    expect(row.success_count).toBe(1);
    expect(JSON.parse(row.successful_service_ids)).toEqual(['weibo']);
  });

  it('restores a database row back into a HistoryItem with parsed JSON and booleans', () => {
    const item = rowToItem({
      id: 'alpha',
      timestamp: 1000,
      local_file_name: 'Alpha.PNG',
      local_file_name_lower: 'alpha.png',
      file_path: '/tmp/Alpha.PNG',
      primary_service: 'weibo',
      results: JSON.stringify([{ serviceId: 'weibo', status: 'success' }]),
      generated_link: 'https://img.example.com/alpha.png',
      link_check_status: JSON.stringify({ weibo: { isValid: true, lastCheckTime: 2000, errorType: 'success' } }),
      link_check_summary: JSON.stringify({ totalLinks: 1 }),
      link_check_skip: 1,
      width: 100,
      height: 80,
      aspect_ratio: 1.25,
      file_size: 12,
      format: 'png',
      color_type: 'unknown',
      has_alpha: 0,
      is_favorited: 1,
      favorite_updated_at: 3000,
      favorite_updated_by: 'device-a',
      success_count: 1,
      successful_service_ids: JSON.stringify(['weibo']),
      migration_skip: 1,
    });

    expect(item.localFileName).toBe('Alpha.PNG');
    expect(item.filePath).toBe('/tmp/Alpha.PNG');
    expect(item.primaryService).toBe('weibo');
    expect(item.results).toEqual([{ serviceId: 'weibo', status: 'success' }]);
    expect(item.linkCheckStatus).toEqual({ weibo: { isValid: true, lastCheckTime: 2000, errorType: 'success' } });
    expect(item.linkCheckSummary).toEqual({ totalLinks: 1 });
    expect(item.isFavorited).toBe(true);
    expect(item.favoriteUpdatedAt).toBe(3000);
    expect(item.favoriteUpdatedBy).toBe('device-a');
    expect(item.migrationSkip).toBe(true);
  });

  it('falls back safely when stored JSON columns are malformed', () => {
    const item = rowToItem({
      id: 'alpha',
      timestamp: 1000,
      local_file_name: 'Alpha.PNG',
      local_file_name_lower: 'alpha.png',
      file_path: null,
      primary_service: 'weibo',
      results: '{broken',
      generated_link: 'https://img.example.com/alpha.png',
      link_check_status: '{broken',
      link_check_summary: '{broken',
      link_check_skip: 0,
      width: 0,
      height: 0,
      aspect_ratio: 1,
      file_size: 0,
      format: 'unknown',
      color_type: 'unknown',
      has_alpha: 0,
      is_favorited: 0,
      favorite_updated_at: 0,
      favorite_updated_by: null,
      success_count: 0,
      successful_service_ids: '[]',
      migration_skip: 0,
    });

    expect(item.results).toEqual([]);
    expect(item.linkCheckStatus).toBeUndefined();
    expect(item.linkCheckSummary).toBeUndefined();
    expect(item.filePath).toBeUndefined();
  });

  it('exposes placeholder helpers in the same order as ALL_COLUMNS', () => {
    const row = itemToRow(makeHistoryItem() as never);
    const values = rowValues(row);

    expect(values).toHaveLength(ALL_COLUMNS.length);
    expect(values[0]).toBe('alpha');
    expect(values[1]).toBe(1000);
    expect(columnPlaceholders()).toBe(
      ALL_COLUMNS.map((_, index) => `$${index + 1}`).join(', '),
    );
    expect(columnPlaceholders(5)).toBe(
      ALL_COLUMNS.map((_, index) => `$${index + 5}`).join(', '),
    );
  });

  it('returns the fallback from safeJsonParse when the source JSON is empty or invalid', () => {
    expect(safeJsonParse(null, ['fallback'], 'results', 'alpha')).toEqual(['fallback']);
    expect(safeJsonParse('{broken', ['fallback'], 'results', 'alpha')).toEqual(['fallback']);
    expect(safeJsonParse('["ok"]', ['fallback'], 'results', 'alpha')).toEqual(['ok']);
  });
});
