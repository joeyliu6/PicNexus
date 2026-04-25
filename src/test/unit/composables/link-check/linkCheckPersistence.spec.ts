import { describe, it, expect, vi, beforeEach } from 'vitest';

const { batchUpdateMock, getContextMock } = vi.hoisted(() => ({
  batchUpdateMock: vi.fn().mockResolvedValue(undefined),
  // 默认返回空 Map：测试场景里没有预存 linkCheckStatus
  getContextMock: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../../../../services/HistoryDatabase', () => ({
  historyDB: {
    batchUpdateLinkCheckStatus: batchUpdateMock,
    getLinkCheckContextByIds: getContextMock,
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

  it('[BUG-8 回归] 输出以 UTF-8 BOM 开头，Excel 不乱码', () => {
    const csv = exportCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('[BUG-8 回归] 文件名内嵌的引号被 RFC 4180 加倍转义', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', fileName: 'She said "hi".jpg',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg',
    };
    const csv = exportCsv([row]);
    // 内嵌的 " 必须被加倍成 ""，整个字段仍包在双引号里
    expect(csv).toContain('"She said ""hi"".jpg"');
  });

  it('[BUG-8 回归] 文件名以 = 开头时前置撇号防 Excel 公式注入', () => {
    const row: LinkCheckRow = {
      historyId: 'h1', serviceId: 'r2', fileName: '=cmd|"/c calc"!A1',
      url: 'https://r2.example.com/img.jpg', rawUrl: 'https://r2.example.com/img.jpg',
    };
    const csv = exportCsv([row]);
    // 前置 ' 退化为纯文本，避免 Excel 把它当公式执行
    expect(csv).toContain(`"'=cmd|""/c calc""!A1"`);
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
    getContextMock.mockResolvedValue(new Map());
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

  it('[BUG-1 回归] 子集复检不会覆盖未参与本次的图床状态', async () => {
    // h1 已在 DB 里有 weibo + github 的状态；本次只重检了 weibo
    getContextMock.mockResolvedValue(new Map([
      ['h1', {
        results: JSON.stringify([
          { serviceId: 'weibo', status: 'success', result: { url: 'a' } },
          { serviceId: 'github', status: 'success', result: { url: 'b' } },
        ]),
        linkCheckStatus: JSON.stringify({
          weibo: { isValid: false, lastCheckTime: 100, errorType: 'http_4xx' },
          github: { isValid: true, lastCheckTime: 100, errorType: 'success' },
        }),
      }],
    ]));

    const result: BatchCheckResult = {
      results: [
        { link: 'a', history_id: 'h1', service_id: 'weibo', is_valid: true, status_code: 200, error_type: 'success', browser_might_work: false },
      ],
      total: 1, valid: 1, invalid: 0, timeout: 0, suspicious: 0, elapsed_ms: 0, cancelled: false,
    };

    await updateHistoryCheckStatus(result);

    const [updates] = batchUpdateMock.mock.calls[0];
    const status = JSON.parse(updates[0].linkCheckStatus);
    expect(status.weibo.isValid).toBe(true);
    // 关键：github 的旧状态必须保留，不能被空对象覆盖
    expect(status.github).toBeDefined();
    expect(status.github.isValid).toBe(true);

    // summary 反映完整 2 个图床，不是仅本次重检的 1 条
    const summary = JSON.parse(updates[0].linkCheckSummary);
    expect(summary.totalLinks).toBe(2);
    expect(summary.validLinks).toBe(2);
    expect(summary.uncheckedLinks).toBe(0);
  });

  it('[BUG-3 回归] browserMightWork=true 会被持久化', async () => {
    const result: BatchCheckResult = {
      results: [
        { link: 'a', history_id: 'h1', service_id: 'weibo', is_valid: false, status_code: 403, error_type: 'http_4xx', browser_might_work: true },
      ],
      total: 1, valid: 0, invalid: 1, timeout: 0, suspicious: 0, elapsed_ms: 0, cancelled: false,
    };

    await updateHistoryCheckStatus(result);

    const [updates] = batchUpdateMock.mock.calls[0];
    const status = JSON.parse(updates[0].linkCheckStatus);
    expect(status.weibo.browserMightWork).toBe(true);
  });

  it('[BUG-3 回归] suspicious errorType 会以原值落库', async () => {
    const result: BatchCheckResult = {
      results: [
        { link: 'a', history_id: 'h1', service_id: 'r2', is_valid: false, status_code: 200, error_type: 'suspicious', browser_might_work: false },
      ],
      total: 1, valid: 0, invalid: 0, timeout: 0, suspicious: 1, elapsed_ms: 0, cancelled: false,
    };

    await updateHistoryCheckStatus(result);

    const [updates] = batchUpdateMock.mock.calls[0];
    const status = JSON.parse(updates[0].linkCheckStatus);
    expect(status.r2.errorType).toBe('suspicious');
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
