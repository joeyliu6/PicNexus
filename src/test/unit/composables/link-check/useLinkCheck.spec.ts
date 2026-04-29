// useLinkCheckManager 关键流程测试：
// 单例 store 用 vi.resetModules + 动态 import 隔离每个 case
// 覆盖：serviceStats 派生计算 / 行操作（删除/淡出）/ 并发守护

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { getInvokeMock, getListenMock } from '../../../helpers/tauriMock';
import type { LinkCheckRow } from '../../../../types/linkCheck';

// ─── Hoisted Mock 句柄 ──────────────────────────────────────────

const {
  toastWarnMock,
  toastInfoMock,
  toastSuccessMock,
  toastErrorMock,
  loadConfigMock,
  historyDBOpenMock,
  historyDBGetByIdMock,
  historyDBUpdateMock,
  historyDBBatchUpdateLinkCheckStatusMock,
  historyDBGetLinkCheckContextByIdsMock,
  onCacheEventMock,
} = vi.hoisted(() => ({
  toastWarnMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  loadConfigMock: vi.fn().mockResolvedValue({}),
  historyDBOpenMock: vi.fn().mockResolvedValue(undefined),
  historyDBGetByIdMock: vi.fn().mockResolvedValue(null),
  historyDBUpdateMock: vi.fn().mockResolvedValue(undefined),
  historyDBBatchUpdateLinkCheckStatusMock: vi.fn().mockResolvedValue(undefined),
  historyDBGetLinkCheckContextByIdsMock: vi.fn().mockResolvedValue(new Map()),
  onCacheEventMock: vi.fn().mockResolvedValue(() => void 0),
}));
const invokeMock = getInvokeMock();
const listenMock = getListenMock();

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    warn: toastWarnMock,
    info: toastInfoMock,
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}));

vi.mock('../../../../composables/useConfig', () => ({
  useConfigManager: () => ({ loadConfig: loadConfigMock }),
}));

vi.mock('../../../../services/HistoryDatabase', () => ({
  historyDB: {
    open: historyDBOpenMock,
    getById: historyDBGetByIdMock,
    update: historyDBUpdateMock,
    batchUpdateLinkCheckStatus: historyDBBatchUpdateLinkCheckStatusMock,
    getLinkCheckContextByIds: historyDBGetLinkCheckContextByIdsMock,
    getLinkCheckInvalid: vi.fn().mockResolvedValue([]),
    getLinkCheckRestStream: vi.fn(async function* () { /* 空流 */ }),
  },
}));

vi.mock('../../../../events/cacheEvents', () => ({
  onCacheEvent: onCacheEventMock,
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

// ─── 工具：每个 case 重置模块拿到干净的单例状态 ─────────────────

async function freshManager() {
  vi.resetModules();
  const mod = await import('../../../../composables/link-check/useLinkCheck');
  return mod.useLinkCheckManager();
}

function makeRow(overrides: Partial<LinkCheckRow> = {}): LinkCheckRow {
  return {
    historyId: 'h1',
    serviceId: 'r2',
    fileName: 'a.jpg',
    url: 'https://r2.example.com/a.jpg',
    rawUrl: 'https://r2.example.com/a.jpg',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listenMock.mockResolvedValue(vi.fn());
  loadConfigMock.mockResolvedValue({});
  historyDBOpenMock.mockResolvedValue(undefined);
  historyDBBatchUpdateLinkCheckStatusMock.mockResolvedValue(undefined);
  historyDBGetLinkCheckContextByIdsMock.mockResolvedValue(new Map());
});

// ─── serviceStats computed ──────────────────────────────────────

describe('useLinkCheckManager.serviceStats', () => {
  it('checkRows 为空时返回空数组', async () => {
    const m = await freshManager();
    expect(m.serviceStats.value).toEqual([]);
  });

  it('按 serviceId 分组并计算 healthRate（valid/checked × 100）', async () => {
    const m = await freshManager();
    m.checkRows.value = [
      makeRow({ historyId: '1', serviceId: 'r2', checkResult: { link: '', is_valid: true, error_type: 'success', browser_might_work: false } }),
      makeRow({ historyId: '2', serviceId: 'r2', checkResult: { link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: false } }),
      makeRow({ historyId: '3', serviceId: 'r2' }), // 未检测
      makeRow({ historyId: '4', serviceId: 'smms', checkResult: { link: '', is_valid: true, error_type: 'success', browser_might_work: false } }),
    ];
    await nextTick();

    const stats = m.serviceStats.value;
    const r2 = stats.find((s) => s.serviceId === 'r2')!;
    const smms = stats.find((s) => s.serviceId === 'smms')!;

    expect(r2.total).toBe(3);
    expect(r2.valid).toBe(1);
    expect(r2.invalid).toBe(1);
    expect(r2.unchecked).toBe(1);
    expect(r2.checked).toBe(2);
    expect(r2.healthRate).toBe(50);

    expect(smms.total).toBe(1);
    expect(smms.healthRate).toBe(100);
  });

  it('全部未检测时 healthRate=0（不除零）', async () => {
    const m = await freshManager();
    m.checkRows.value = [
      makeRow({ historyId: '1', serviceId: 'r2' }),
      makeRow({ historyId: '2', serviceId: 'r2' }),
    ];
    await nextTick();
    expect(m.serviceStats.value[0].healthRate).toBe(0);
  });

  it('按 healthRate 升序排序（健康率低的服务排前面）', async () => {
    const m = await freshManager();
    m.checkRows.value = [
      makeRow({ historyId: '1', serviceId: 'good', checkResult: { link: '', is_valid: true, error_type: 'success', browser_might_work: false } }),
      makeRow({ historyId: '2', serviceId: 'bad', checkResult: { link: '', is_valid: false, error_type: 'http_4xx', browser_might_work: false } }),
    ];
    await nextTick();
    expect(m.serviceStats.value[0].serviceId).toBe('bad');
    expect(m.serviceStats.value[1].serviceId).toBe('good');
  });
});

// ─── 行删除/淡出 ────────────────────────────────────────────────

describe('useLinkCheckManager.removeRowsByHistoryIds', () => {
  it('按 historyId 移除对应所有行（同 historyId 不同 serviceId 一并删）', async () => {
    const m = await freshManager();
    m.checkRows.value = [
      makeRow({ historyId: 'h1', serviceId: 'r2' }),
      makeRow({ historyId: 'h1', serviceId: 'smms' }),
      makeRow({ historyId: 'h2', serviceId: 'r2' }),
    ];
    m.removeRowsByHistoryIds(['h1']);
    expect(m.checkRows.value).toHaveLength(1);
    expect(m.checkRows.value[0].historyId).toBe('h2');
  });

  it('id 不存在时 checkRows 不变', async () => {
    const m = await freshManager();
    const initial = [makeRow({ historyId: 'h1' })];
    m.checkRows.value = initial;
    m.removeRowsByHistoryIds(['nonexistent']);
    expect(m.checkRows.value).toHaveLength(1);
  });
});

describe('useLinkCheckManager.removeRowsByKeys', () => {
  it('精准按 (historyId, serviceId) 删除，同 historyId 其他图床保留', async () => {
    const m = await freshManager();
    m.checkRows.value = [
      makeRow({ historyId: 'h1', serviceId: 'r2' }),
      makeRow({ historyId: 'h1', serviceId: 'smms' }),
    ];
    m.removeRowsByKeys([{ historyId: 'h1', serviceId: 'r2' }]);
    expect(m.checkRows.value).toHaveLength(1);
    expect(m.checkRows.value[0].serviceId).toBe('smms');
  });

  it('空数组时 checkRows 不变', async () => {
    const m = await freshManager();
    m.checkRows.value = [makeRow()];
    m.removeRowsByKeys([]);
    expect(m.checkRows.value).toHaveLength(1);
  });
});

describe('useLinkCheckManager.setFadingOutRows', () => {
  it('对匹配的 (historyId, serviceId) 设置 fadingOut=true', async () => {
    const m = await freshManager();
    m.checkRows.value = [
      makeRow({ historyId: 'h1', serviceId: 'r2' }),
      makeRow({ historyId: 'h1', serviceId: 'smms' }),
    ];
    m.setFadingOutRows([{ historyId: 'h1', serviceId: 'r2' }], true);
    expect(m.checkRows.value[0].fadingOut).toBe(true);
    expect(m.checkRows.value[1].fadingOut).toBeUndefined();
  });

  it('空 keys 时不修改任何行', async () => {
    const m = await freshManager();
    m.checkRows.value = [makeRow()];
    m.setFadingOutRows([], true);
    expect(m.checkRows.value[0].fadingOut).toBeUndefined();
  });
});

// ─── 并发守护 ──────────────────────────────────────────────────

describe('useLinkCheckManager.checkUrls', () => {
  it('空 items 立即返回 null（不调用 invoke）', async () => {
    const m = await freshManager();
    const result = await m.checkUrls([]);
    expect(result).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('isChecking=true 时阻断并提示 toast.warn', async () => {
    const m = await freshManager();
    m.isChecking.value = true;
    const result = await m.checkUrls([
      { url: 'https://x.com/1.jpg', history_id: 'h1', service_id: 'r2' },
    ]);
    expect(result).toBeNull();
    expect(toastWarnMock).toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('正常调用 batch_check_links 并返回结果', async () => {
    const m = await freshManager();
    const fakeResult = {
      results: [], total: 0, valid: 0, invalid: 0,
      timeout: 0, suspicious: 0, elapsed_ms: 100, cancelled: false,
    };
    invokeMock.mockResolvedValueOnce(fakeResult);

    const result = await m.checkUrls([
      { url: 'https://x.com/1.jpg', history_id: 'h1', service_id: 'r2' },
    ]);

    expect(result).toEqual(fakeResult);
    expect(invokeMock).toHaveBeenCalledWith('batch_check_links', expect.objectContaining({
      request: expect.objectContaining({
        links: expect.arrayContaining([expect.objectContaining({ url: 'https://x.com/1.jpg' })]),
      }),
    }));
  });

  it('完成后释放 isChecking 锁（finally 分支）', async () => {
    const m = await freshManager();
    invokeMock.mockResolvedValueOnce({
      results: [], total: 0, valid: 0, invalid: 0,
      timeout: 0, suspicious: 0, elapsed_ms: 1, cancelled: false,
    });
    await m.checkUrls([{ url: 'https://x.com/1.jpg', history_id: 'h1', service_id: 'r2' }]);
    expect(m.isChecking.value).toBe(false);
  });
});

describe('useLinkCheckManager.cancelCheck', () => {
  it('isChecking=false 时直接返回，不调用 cancel_batch_check', async () => {
    const m = await freshManager();
    await m.cancelCheck();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('isChecking=true 时调用 cancel_batch_check 并清状态', async () => {
    const m = await freshManager();
    m.isChecking.value = true;
    invokeMock.mockResolvedValueOnce(undefined);
    await m.cancelCheck();
    expect(invokeMock).toHaveBeenCalledWith('cancel_batch_check');
    expect(m.isChecking.value).toBe(false);
    expect(m.progressSource.value).toBeNull();
  });
});

describe('useLinkCheckManager.checkAllHistoryLinks', () => {
  it('isChecking=true 时阻断并提示 toast.warn', async () => {
    const m = await freshManager();
    m.isChecking.value = true;
    const result = await m.checkAllHistoryLinks();
    expect(result).toBeNull();
    expect(toastWarnMock).toHaveBeenCalled();
  });
});

describe('useLinkCheckManager.checkSubset', () => {
  it('[BUG 回归] targets 精确到 (historyId, serviceId)，不会把同图其他图床一起重检', async () => {
    const m = await freshManager();
    m.checkRows.value = [
      makeRow({ historyId: 'h1', serviceId: 'r2', url: 'https://cdn.example.com/a.jpg' }),
      makeRow({ historyId: 'h1', serviceId: 'github', url: 'https://github.example.com/a.jpg' }),
      makeRow({ historyId: 'h2', serviceId: 'r2', url: 'https://cdn.example.com/b.jpg' }),
    ];
    invokeMock.mockResolvedValueOnce({
      results: [
        {
          link: 'https://cdn.example.com/a.jpg',
          history_id: 'h1',
          service_id: 'r2',
          is_valid: true,
          error_type: 'success',
          browser_might_work: false,
        },
      ],
      total: 1, valid: 1, invalid: 0, timeout: 0, suspicious: 0, elapsed_ms: 1, cancelled: false,
    });

    await m.checkSubset({ targets: [{ historyId: 'h1', serviceId: 'r2' }] });

    const [, payload] = invokeMock.mock.calls.find(([command]) => command === 'batch_check_links')!;
    const requestPayload = payload as { request: { links: unknown[] } };
    expect(requestPayload.request.links).toHaveLength(1);
    expect(requestPayload.request.links[0]).toMatchObject({ history_id: 'h1', service_id: 'r2' });
    expect(requestPayload.request).toHaveProperty('batch_id');
  });

  it('[BUG 回归] 忽略非当前 batch_id 的进度事件，避免取消后旧批次污染新进度', async () => {
    const m = await freshManager();
    let progressHandler: ((event: { payload: any }) => void) | undefined;
    listenMock.mockImplementationOnce(async (_event, handler) => {
      progressHandler = handler as (event: { payload: any }) => void;
      return vi.fn();
    });

    m.checkRows.value = [
      makeRow({ historyId: 'h1', serviceId: 'r2', url: 'https://cdn.example.com/a.jpg' }),
    ];
    invokeMock.mockImplementationOnce(async (_command, payload) => {
      const requestPayload = payload as { request: { batch_id: string } };
      progressHandler?.({
        payload: { batch_id: 'old-batch', checked: 1, total: 1, current_url: 'old' },
      });
      progressHandler?.({
        payload: { batch_id: requestPayload.request.batch_id, checked: 1, total: 1, current_url: 'current' },
      });
      return {
        batch_id: requestPayload.request.batch_id,
        results: [],
        total: 1, valid: 0, invalid: 0, timeout: 0, suspicious: 0, elapsed_ms: 1, cancelled: false,
      };
    });

    await m.checkSubset({ targets: [{ historyId: 'h1', serviceId: 'r2' }] });

    expect(m.progress.value?.current_url).toBe('current');
  });

  it('[BUG 回归] 非当前 batch_id 的最终结果不会写入 UI/DB', async () => {
    const m = await freshManager();
    m.checkRows.value = [
      makeRow({ historyId: 'h1', serviceId: 'r2', url: 'https://cdn.example.com/a.jpg' }),
    ];
    invokeMock.mockResolvedValueOnce({
      batch_id: 'old-batch',
      results: [
        {
          link: 'https://cdn.example.com/a.jpg',
          history_id: 'h1',
          service_id: 'r2',
          is_valid: true,
          error_type: 'success',
          browser_might_work: false,
        },
      ],
      total: 1, valid: 1, invalid: 0, timeout: 0, suspicious: 0, elapsed_ms: 1, cancelled: false,
    });

    const result = await m.checkSubset({ targets: [{ historyId: 'h1', serviceId: 'r2' }] });

    expect(result).toBeNull();
    expect(m.checkRows.value[0].checkResult).toBeUndefined();
    expect(historyDBBatchUpdateLinkCheckStatusMock).not.toHaveBeenCalled();
  });
});
