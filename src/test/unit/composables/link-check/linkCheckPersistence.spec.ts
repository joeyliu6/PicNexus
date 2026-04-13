import { describe, it, expect, vi, beforeEach } from 'vitest';

const { batchUpdateMock } = vi.hoisted(() => ({
  batchUpdateMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../services/HistoryDatabase', () => ({
  historyDB: {
    batchUpdateLinkCheckStatus: batchUpdateMock,
  },
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

import { exportCsv, updateHistoryCheckStatus } from '../../../../composables/link-check/linkCheckPersistence';
import type { LinkCheckRow, BatchCheckResult } from '../../../../types/linkCheck';

// ─── exportCsv ────────────────────────────────────────────────────────────────

describe('exportCsv', () => {
  it('空 rows 时只返回 header 行', () => {
    const csv = exportCsv([]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('序号');
  });

  it('有效链接状态为"有效"', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', fileName: 'img.jpg',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg',
      checkResult: {
        link: 'https://r2.example.com/img.jpg',
        is_valid: true, status_code: 200, error_type: 'success', browser_might_work: false,
      },
    };
    const csv = exportCsv([row]);
    expect(csv).toContain('有效');
  });

  it('超时链接状态为"超时"', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', fileName: 'img.jpg',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg',
      checkResult: {
        link: 'https://r2.example.com/img.jpg',
        is_valid: false, error_type: 'timeout', browser_might_work: false,
      },
    };
    const csv = exportCsv([row]);
    expect(csv).toContain('超时');
  });

  it('失效链接状态为"失效"', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', fileName: 'img.jpg',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg',
      checkResult: {
        link: 'https://r2.example.com/img.jpg',
        is_valid: false, error_type: 'http_4xx', browser_might_work: false,
      },
    };
    const csv = exportCsv([row]);
    expect(csv).toContain('失效');
  });

  it('可疑链接状态为"疑似异常"', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', fileName: 'img.jpg',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg',
      checkResult: {
        link: 'https://r2.example.com/img.jpg',
        is_valid: false, error_type: 'suspicious', browser_might_work: false,
      },
    };
    const csv = exportCsv([row]);
    expect(csv).toContain('疑似异常');
  });

  it('未检测时状态为"未检测"', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', fileName: 'img.jpg',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg',
    };
    const csv = exportCsv([row]);
    expect(csv).toContain('未检测');
  });

  it('文件名和 URL 被双引号包裹', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', fileName: 'my photo.jpg',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg',
    };
    const csv = exportCsv([row]);
    expect(csv).toContain('"my photo.jpg"');
    expect(csv).toContain('"https://r2.example.com/img.jpg"');
  });

  it('行号从 1 开始', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', fileName: 'img.jpg',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg',
    };
    const csv = exportCsv([row]);
    const dataLine = csv.split('\n')[1];
    expect(dataLine.startsWith('1,')).toBe(true);
  });

  it('多行时行号递增', () => {
    const makeRow = (n: number): LinkCheckRow => ({
      historyId: `h${n}`, serviceId: 'r2', fileName: `img${n}.jpg`,
      url: `https://r2.example.com/img${n}.jpg`, rawUrl: `https://r2.example.com/img${n}.jpg`,
    });
    const csv = exportCsv([makeRow(1), makeRow(2), makeRow(3)]);
    const lines = csv.split('\n');
    expect(lines[1].startsWith('1,')).toBe(true);
    expect(lines[2].startsWith('2,')).toBe(true);
    expect(lines[3].startsWith('3,')).toBe(true);
  });
});

// ─── updateHistoryCheckStatus ─────────────────────────────────────────────────

describe('updateHistoryCheckStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('空 results 时调用 batchUpdateLinkCheckStatus（空数组）', async () => {
    const result: BatchCheckResult = {
      results: [], total: 0, valid: 0, invalid: 0, timeout: 0, suspicious: 0, elapsed_ms: 0, cancelled: false,
    };
    await updateHistoryCheckStatus(result);
    expect(batchUpdateMock).toHaveBeenCalledWith([]);
  });

  it('按 historyId 分组并构建正确的 linkCheckStatus', async () => {
    const result: BatchCheckResult = {
      results: [
        {
          link: 'https://r2.example.com/img.jpg',
          history_id: 'h1', service_id: 'r2',
          is_valid: true, status_code: 200, error_type: 'success',
          response_time: 80, browser_might_work: false,
        },
      ],
      total: 1, valid: 1, invalid: 0, timeout: 0, suspicious: 0, elapsed_ms: 100, cancelled: false,
    };

    await updateHistoryCheckStatus(result);

    expect(batchUpdateMock).toHaveBeenCalledOnce();
    const [updates] = batchUpdateMock.mock.calls[0];
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('h1');

    const status = JSON.parse(updates[0].linkCheckStatus);
    expect(status.r2.isValid).toBe(true);
    expect(status.r2.statusCode).toBe(200);
    expect(status.r2.responseTime).toBe(80);
  });

  it('linkCheckSummary 正确统计 valid/invalid', async () => {
    const result: BatchCheckResult = {
      results: [
        { link: 'a.jpg', history_id: 'h1', service_id: 'r2', is_valid: true, error_type: 'success', browser_might_work: false },
        { link: 'b.jpg', history_id: 'h1', service_id: 'github', is_valid: false, error_type: 'http_4xx', browser_might_work: false },
      ],
      total: 2, valid: 1, invalid: 1, timeout: 0, suspicious: 0, elapsed_ms: 50, cancelled: false,
    };

    await updateHistoryCheckStatus(result);

    const [updates] = batchUpdateMock.mock.calls[0];
    const summary = JSON.parse(updates[0].linkCheckSummary);
    expect(summary.totalLinks).toBe(2);
    expect(summary.validLinks).toBe(1);
    expect(summary.invalidLinks).toBe(1);
    expect(summary.uncheckedLinks).toBe(0);
  });

  it('results 无 history_id 时跳过', async () => {
    const result: BatchCheckResult = {
      results: [
        { link: 'a.jpg', history_id: undefined, service_id: 'r2', is_valid: true, error_type: 'success', browser_might_work: false },
      ],
      total: 1, valid: 1, invalid: 0, timeout: 0, suspicious: 0, elapsed_ms: 0, cancelled: false,
    };

    await updateHistoryCheckStatus(result);
    const [updates] = batchUpdateMock.mock.calls[0];
    expect(updates).toHaveLength(0);
  });

  it('不同 historyId 的结果分别生成独立的 update 条目', async () => {
    const result: BatchCheckResult = {
      results: [
        { link: 'a.jpg', history_id: 'h1', service_id: 'r2', is_valid: true, error_type: 'success', browser_might_work: false },
        { link: 'b.jpg', history_id: 'h2', service_id: 'r2', is_valid: false, error_type: 'http_4xx', browser_might_work: false },
      ],
      total: 2, valid: 1, invalid: 1, timeout: 0, suspicious: 0, elapsed_ms: 0, cancelled: false,
    };

    await updateHistoryCheckStatus(result);
    const [updates] = batchUpdateMock.mock.calls[0];
    expect(updates).toHaveLength(2);
    const ids = updates.map((u: { id: string }) => u.id);
    expect(ids).toContain('h1');
    expect(ids).toContain('h2');
  });
});
