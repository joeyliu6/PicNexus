import { describe, it, expect, vi } from 'vitest';

// applyLinkPrefix 对非微博图床直接返回原 URL，这里简化 mock 为透传
vi.mock('../../../../composables/useCopyLink', () => ({
  applyLinkPrefix: (url: string) => url,
}));

import {
  liteRowToItem,
  buildCheckItemsSync,
  restoreCheckStatus,
  applyResultsToRows,
} from '../../../../composables/link-check/linkCheckDataBuilder';
import type { LinkCheckLiteRow } from '../../../../services/HistoryDatabase';
import type { HistoryItem, UserConfig } from '../../../../config/types';
import type { LinkCheckRow } from '../../../../types/linkCheck';

// 最小化的空 UserConfig（buildCheckItemsSync 使用 applyLinkPrefix，已 mock）
const EMPTY_CONFIG = {} as UserConfig;

// ─── liteRowToItem ────────────────────────────────────────────────────────────

describe('liteRowToItem', () => {
  it('results 为 JSON 字符串时自动解析', () => {
    const row: LinkCheckLiteRow = {
      id: '1',
      local_file_name: 'a.jpg',
      primary_service: 'r2',
      results: JSON.stringify([{ serviceId: 'r2', status: 'success' }]),
      link_check_status: null,
    };
    const item = liteRowToItem(row);
    expect(item.results).toEqual([{ serviceId: 'r2', status: 'success' }]);
  });

  it('results 为已解析对象时直接使用', () => {
    const parsed = [{ serviceId: 'r2', status: 'success' }];
    const row = {
      id: '1',
      local_file_name: 'a.jpg',
      primary_service: 'r2',
      results: parsed as unknown as string,
      link_check_status: null,
    };
    const item = liteRowToItem(row);
    expect(item.results).toBe(parsed);
  });

  it('link_check_status 为 JSON 字符串时解析', () => {
    const status = { r2: { isValid: true, lastCheckTime: 0, errorType: 'success' } };
    const row: LinkCheckLiteRow = {
      id: '2',
      local_file_name: 'b.jpg',
      primary_service: 'r2',
      results: '[]',
      link_check_status: JSON.stringify(status),
    };
    const item = liteRowToItem(row);
    expect(item.linkCheckStatus).toEqual(status);
  });

  it('link_check_status 为 null 时 linkCheckStatus 为 undefined', () => {
    const row: LinkCheckLiteRow = {
      id: '3',
      local_file_name: 'c.jpg',
      primary_service: 'r2',
      results: '[]',
      link_check_status: null,
    };
    const item = liteRowToItem(row);
    expect(item.linkCheckStatus).toBeUndefined();
  });

  it('基础字段映射正确', () => {
    const row: LinkCheckLiteRow = {
      id: 'id-x',
      local_file_name: 'photo.png',
      primary_service: 'github',
      results: '[]',
      link_check_status: null,
    };
    const item = liteRowToItem(row);
    expect(item.id).toBe('id-x');
    expect(item.localFileName).toBe('photo.png');
    expect(item.primaryService).toBe('github');
    expect(item.timestamp).toBe(0);
    expect(item.generatedLink).toBe('');
  });
});

// ─── buildCheckItemsSync ──────────────────────────────────────────────────────

describe('buildCheckItemsSync', () => {
  function makeItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
    return {
      id: 'item-1',
      timestamp: 0,
      localFileName: 'img.jpg',
      primaryService: 'r2',
      generatedLink: '',
      results: [],
      ...overrides,
    };
  }

  it('results 为空时返回空数组', () => {
    const { requestItems, rows } = buildCheckItemsSync([makeItem()], EMPTY_CONFIG);
    expect(requestItems).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });

  it('status !== success 的结果被跳过', () => {
    const item = makeItem({
      results: [{ serviceId: 'r2', status: 'failed', result: { serviceId: 'r2', fileKey: 'k', url: 'https://r2.example.com/x.jpg' } }],
    });
    const { requestItems } = buildCheckItemsSync([item], EMPTY_CONFIG);
    expect(requestItems).toHaveLength(0);
  });

  it('url 为空时跳过', () => {
    const item = makeItem({
      results: [{ serviceId: 'r2', status: 'success', result: { serviceId: 'r2', fileKey: 'k', url: '' } }],
    });
    const { requestItems } = buildCheckItemsSync([item], EMPTY_CONFIG);
    expect(requestItems).toHaveLength(0);
  });

  it('成功且有 url 的结果被包含', () => {
    const item = makeItem({
      results: [
        { serviceId: 'r2', status: 'success', result: { serviceId: 'r2', fileKey: 'k', url: 'https://r2.example.com/img.jpg' } },
      ],
    });
    const { requestItems, rows } = buildCheckItemsSync([item], EMPTY_CONFIG);
    expect(requestItems).toHaveLength(1);
    expect(requestItems[0].url).toBe('https://r2.example.com/img.jpg');
    expect(requestItems[0].history_id).toBe('item-1');
    expect(requestItems[0].service_id).toBe('r2');
    expect(rows).toHaveLength(1);
    expect(rows[0].historyId).toBe('item-1');
    expect(rows[0].serviceId).toBe('r2');
    expect(rows[0].fileName).toBe('img.jpg');
  });

  it('多个图床结果各自生成独立行', () => {
    const item = makeItem({
      results: [
        { serviceId: 'r2', status: 'success', result: { serviceId: 'r2', fileKey: 'k1', url: 'https://r2.example.com/a.jpg' } },
        { serviceId: 'github', status: 'success', result: { serviceId: 'github', fileKey: 'k2', url: 'https://cdn.github.com/b.jpg' } },
      ],
    });
    const { requestItems } = buildCheckItemsSync([item], EMPTY_CONFIG);
    expect(requestItems).toHaveLength(2);
  });

  it('没有 results 字段时跳过整条 item', () => {
    const item = makeItem({ results: undefined as unknown as [] });
    const { requestItems } = buildCheckItemsSync([item], EMPTY_CONFIG);
    expect(requestItems).toHaveLength(0);
  });
});

// ─── restoreCheckStatus ───────────────────────────────────────────────────────

describe('restoreCheckStatus', () => {
  it('有匹配 linkCheckStatus 时恢复 checkResult', () => {
    const items: HistoryItem[] = [{
      id: 'h1',
      timestamp: 0,
      localFileName: 'x.jpg',
      primaryService: 'r2',
      generatedLink: '',
      results: [],
      linkCheckStatus: {
        r2: { isValid: true, lastCheckTime: 100, statusCode: 200, errorType: 'success', responseTime: 50 },
      },
    }];
    const rows: LinkCheckRow[] = [{
      historyId: 'h1', serviceId: 'r2', url: 'https://r2.example.com/x.jpg',
      rawUrl: 'https://r2.example.com/x.jpg', fileName: 'x.jpg',
    }];

    restoreCheckStatus(rows, items);

    expect(rows[0].checkResult).toBeDefined();
    expect(rows[0].checkResult!.is_valid).toBe(true);
    expect(rows[0].checkResult!.status_code).toBe(200);
    expect(rows[0].checkResult!.response_time).toBe(50);
  });

  it("errorType 'pending' 转换为 'network'", () => {
    const items: HistoryItem[] = [{
      id: 'h1',
      timestamp: 0,
      localFileName: 'x.jpg',
      primaryService: 'r2',
      generatedLink: '',
      results: [],
      linkCheckStatus: {
        r2: { isValid: false, lastCheckTime: 0, errorType: 'pending' },
      },
    }];
    const rows: LinkCheckRow[] = [{
      historyId: 'h1', serviceId: 'r2', url: 'https://r2.example.com/x.jpg',
      rawUrl: 'https://r2.example.com/x.jpg', fileName: 'x.jpg',
    }];

    restoreCheckStatus(rows, items);
    expect(rows[0].checkResult!.error_type).toBe('network');
  });

  it('无匹配 item 时 checkResult 不变（仍为 undefined）', () => {
    const rows: LinkCheckRow[] = [{
      historyId: 'no-such-id', serviceId: 'r2',
      url: 'https://r2.example.com/x.jpg', rawUrl: 'https://r2.example.com/x.jpg', fileName: 'x.jpg',
    }];
    restoreCheckStatus(rows, []);
    expect(rows[0].checkResult).toBeUndefined();
  });
});

// ─── applyResultsToRows ───────────────────────────────────────────────────────

describe('applyResultsToRows', () => {
  it('按 url + historyId 匹配并设置 checkResult', () => {
    const rows: LinkCheckRow[] = [{
      historyId: 'h1', serviceId: 'r2',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg', fileName: 'img.jpg',
    }];
    const results = [{
      link: 'https://r2.example.com/img.jpg',
      history_id: 'h1',
      service_id: 'r2',
      is_valid: true,
      status_code: 200,
      error_type: 'success' as const,
      browser_might_work: false,
    }];

    applyResultsToRows(rows, results);
    expect(rows[0].checkResult).toBeDefined();
    expect(rows[0].checkResult!.is_valid).toBe(true);
  });

  it('url 不匹配时不设置 checkResult', () => {
    const rows: LinkCheckRow[] = [{
      historyId: 'h1', serviceId: 'r2',
      url: 'https://r2.example.com/other.jpg', rawUrl: 'https://r2.example.com/other.jpg', fileName: 'other.jpg',
    }];
    const results = [{
      link: 'https://r2.example.com/img.jpg',
      history_id: 'h1',
      service_id: 'r2',
      is_valid: true,
      error_type: 'success' as const,
      browser_might_work: false,
    }];

    applyResultsToRows(rows, results);
    expect(rows[0].checkResult).toBeUndefined();
  });

  it('historyId 不匹配时不设置 checkResult', () => {
    const rows: LinkCheckRow[] = [{
      historyId: 'h2', serviceId: 'r2',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg', fileName: 'img.jpg',
    }];
    const results = [{
      link: 'https://r2.example.com/img.jpg',
      history_id: 'h1',
      service_id: 'r2',
      is_valid: true,
      error_type: 'success' as const,
      browser_might_work: false,
    }];

    applyResultsToRows(rows, results);
    expect(rows[0].checkResult).toBeUndefined();
  });

  it('空 results 时不修改 rows', () => {
    const rows: LinkCheckRow[] = [{
      historyId: 'h1', serviceId: 'r2',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg', fileName: 'img.jpg',
    }];
    applyResultsToRows(rows, []);
    expect(rows[0].checkResult).toBeUndefined();
  });
});
