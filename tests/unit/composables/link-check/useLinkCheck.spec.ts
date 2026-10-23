// useLinkCheckManager 关键流程测试：
// 单例 store 用 vi.resetModules + 动态 import 隔离每个 case
// 覆盖：行操作（删除/淡出/切主链接）/ 检查子集 / 并发守护

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { getInvokeMock, getListenMock } from '../../helpers/tauriMock';
import type { LinkCheckRow } from '@/types/linkCheck';

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
  historyDBStreamMock,
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
  historyDBStreamMock: vi.fn(async function* (): AsyncGenerator<unknown[]> { /* 空流 */ }),
}));
const invokeMock = getInvokeMock();
const listenMock = getListenMock();

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    warn: toastWarnMock,
    info: toastInfoMock,
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}));

vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({ loadConfig: loadConfigMock }),
}));

vi.mock('@/services/database', () => ({
  historyDB: {
    open: historyDBOpenMock,
    getById: historyDBGetByIdMock,
    update: historyDBUpdateMock,
    batchUpdateLinkCheckStatus: historyDBBatchUpdateLinkCheckStatusMock,
    getLinkCheckContextByIds: historyDBGetLinkCheckContextByIdsMock,
    getLinkCheckStream: historyDBStreamMock,
  },
}));

vi.mock('@/events/cacheEvents', () => ({
  onCacheEvent: onCacheEventMock,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

function liteRow(id: string) {
  return {
    id,
    timestamp: 1_700_000_000_000,
    local_file_name: `${id}.jpg`,
    primary_service: 'r2',
    results: JSON.stringify([{ serviceId: 'r2', status: 'success', result: { serviceId: 'r2', fileKey: id, url: `https://r2.example/${id}.jpg` } }]),
    link_check_status: null,
  };
}

// ─── 工具：每个 case 重置模块拿到干净的单例状态 ─────────────────

async function freshManager() {
  vi.resetModules();
  const mod = await import('@/composables/link-check/useLinkCheck');
  return mod.useLinkCheckManager();
}

/** 额外拿到模块级 onCacheEvent 注册的那个 handler，用来手动派发跨窗口事件 */
async function freshManagerWithCacheEvents() {
  const manager = await freshManager();
  const handler = onCacheEventMock.mock.calls.at(-1)?.[0] as (payload: {
    type: string;
    timestamp: number;
    data?: unknown;
  }) => void;
  return { manager, emitCacheEvent: handler };
}

/** 让 invoke 在被调用时挂住，返回「已开始」信号与手动放行函数 */
function deferInvoke<T>(value: T) {
  let started!: () => void;
  let release!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const impl = () => new Promise<T>((resolve) => {
    release = () => resolve(value);
    started();
  });
  return { impl, startedPromise, release: () => release() };
}

function makeRow(overrides: Partial<LinkCheckRow> = {}): LinkCheckRow {
  return {
    historyId: 'h1',
    serviceId: 'r2',
    fileName: 'a.jpg',
    uploadedAt: 0,
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

// ─── 跨窗口事件：history-deleted ────────────────────────────────

describe('useLinkCheckManager 响应 history-deleted', () => {
  it('[BUG 回归] 收到 history-deleted 后立即摘掉对应行，不再留幽灵行', async () => {
    // 以前只处理 cleared/updated，别处删了图，检测页 5 分钟内还显示它、还计入统计、还白发请求
    const { manager, emitCacheEvent } = await freshManagerWithCacheEvents();
    manager.checkRows.value = [
      makeRow({ historyId: 'h1', serviceId: 'r2' }),
      makeRow({ historyId: 'h1', serviceId: 'smms' }),
      makeRow({ historyId: 'h2', serviceId: 'r2' }),
    ];

    emitCacheEvent({ type: 'history-deleted', timestamp: 1, data: { ids: ['h1'] } });

    expect(manager.checkRows.value).toHaveLength(1);
    expect(manager.checkRows.value[0].historyId).toBe('h2');
  });

  it('ids 在 data 里而不是 payload 顶层——放错位置会静默失效', async () => {
    const { manager, emitCacheEvent } = await freshManagerWithCacheEvents();
    manager.checkRows.value = [makeRow({ historyId: 'h1' })];

    emitCacheEvent({ type: 'history-deleted', timestamp: 1, data: { ids: ['h1'], source: 'w1' } });

    expect(manager.checkRows.value).toHaveLength(0);
  });

  it('缺少 ids 时不动 checkRows（只让 TTL 缓存失效）', async () => {
    const { manager, emitCacheEvent } = await freshManagerWithCacheEvents();
    manager.checkRows.value = [makeRow({ historyId: 'h1' })];

    emitCacheEvent({ type: 'history-deleted', timestamp: 1, data: {} });
    emitCacheEvent({ type: 'history-deleted', timestamp: 2 });

    expect(manager.checkRows.value).toHaveLength(1);
  });

});

describe('useLinkCheckManager.setPrimaryServices', () => {
  it('一次挪好几张图的「主链接」标记；只换动到的行对象，没动的保持原样', async () => {
    const m = await freshManager();
    m.checkRows.value = [
      makeRow({ historyId: 'h1', serviceId: 'webdav:a', isPrimary: true }),
      makeRow({ historyId: 'h1', serviceId: 'jd', isPrimary: false }),
      makeRow({ historyId: 'h2', serviceId: 'weibo', isPrimary: true }),
      makeRow({ historyId: 'h2', serviceId: 'jd', isPrimary: false }),
      makeRow({ historyId: 'h3', serviceId: 'jd', isPrimary: true }),
    ];
    const before = m.checkRows.value;

    m.setPrimaryServices(new Map([['h1', 'jd'], ['h2', 'jd']]));

    expect(m.checkRows.value.map((r) => r.isPrimary)).toEqual([false, true, false, true, true]);
    expect(m.checkRows.value[0]).not.toBe(before[0]);
    expect(m.checkRows.value[4]).toBe(before[4]);
  });

  it('没有任何变化时不换数组引用（免得列表白白重建）', async () => {
    const m = await freshManager();
    m.checkRows.value = [makeRow({ historyId: 'h1', serviceId: 'jd', isPrimary: true })];
    const before = m.checkRows.value;
    m.setPrimaryServices(new Map([['h1', 'jd']]));
    expect(m.checkRows.value).toBe(before);
  });
});

describe('useLinkCheckManager.recheckSingle', () => {
  it('结果先在原位停一会儿（行上显示新状态、归类不动），再落定并记下检查时间', async () => {
    vi.useFakeTimers();
    try {
      const m = await freshManager();
      // 走真实的读取流程把这一行（上次查出 404）读进来，行索引才会建好
      historyDBStreamMock.mockImplementationOnce(async function* () {
        yield [{ ...liteRow('h1'), link_check_status: JSON.stringify({ r2: { isValid: false, statusCode: 404, errorType: 'http_4xx', lastCheckTime: 1 } }) }];
      });
      const loading = m.loadHistoryRows();
      await vi.advanceTimersByTimeAsync(1);
      await loading;
      invokeMock.mockResolvedValueOnce({ link: '', is_valid: true, status_code: 200, error_type: 'success', browser_might_work: false });

      const pending = m.recheckSingle(m.checkRows.value[0]);
      await vi.advanceTimersByTimeAsync(400);

      expect(m.checkRows.value[0].recheckResult?.is_valid).toBe(true);
      expect(m.checkRows.value[0].checkResult?.is_valid).toBe(false);

      await vi.advanceTimersByTimeAsync(1200);
      await pending;

      expect(m.checkRows.value[0].checkResult?.is_valid).toBe(true);
      expect(m.checkRows.value[0].recheckResult).toBeUndefined();
      expect(m.checkRows.value[0].checkedAt).toBe(Date.now());
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useLinkCheckManager.cancelCheck', () => {
  it('isChecking=false 时直接返回，不调用 cancel_batch_check', async () => {
    const m = await freshManager();
    await m.cancelCheck();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  // Rust 命令失败时抛的是 { type, data: { message } }：通知要读出原话，不能是 [object Object]
  it('取消失败时通知写 Rust 给的原因', async () => {
    const m = await freshManager();
    m.isChecking.value = true;
    invokeMock.mockRejectedValueOnce({ type: 'EXTERNAL', data: { message: '检测任务已经结束' } });
    await m.cancelCheck();
    expect(toastErrorMock).toHaveBeenCalledWith('取消失败', '检测任务已经结束');
  });

  it('isChecking=true 时调用 cancel_batch_check 并清状态', async () => {
    const m = await freshManager();
    m.isChecking.value = true;
    invokeMock.mockResolvedValueOnce(undefined);
    await m.cancelCheck();
    expect(invokeMock).toHaveBeenCalledWith('cancel_batch_check');
    expect(m.isChecking.value).toBe(false);
    expect(m.activeRun.value).toBeNull();
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

  it('历史数据加载失败时提示用户，且不算读完', async () => {
    const m = await freshManager();
    historyDBOpenMock.mockRejectedValueOnce(new Error('database unavailable'));

    await m.loadHistoryRows();

    expect(m.loaded.value).toBe(false);
    expect(toastErrorMock).toHaveBeenCalledWith('加载历史检测数据失败', 'database unavailable');
    expect(m.isLoading.value).toBe(false);
  });
});

describe('useLinkCheckManager.loadHistoryRows', () => {
  // 链接健康的总数、日历都要全量：读到一半就交出去，状态栏会先闪错的张数
  it('读完全部批次才一次交出，期间不出现半截的行', async () => {
    let releaseSecond!: () => void;
    const gate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    historyDBStreamMock.mockImplementationOnce(async function* () {
      yield [liteRow('a')];
      await gate;
      yield [liteRow('b')];
    });
    const m = await freshManager();

    const loading = m.loadHistoryRows();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(m.checkRows.value).toHaveLength(0);
    expect(m.loaded.value).toBe(false);

    releaseSecond();
    await loading;
    expect(m.checkRows.value.map((r) => r.historyId)).toEqual(['a', 'b']);
    expect(m.checkRows.value[0].uploadedAt).toBe(1_700_000_000_000);
    expect(m.loaded.value).toBe(true);
  });
});

describe('useLinkCheckManager.checkSubset', () => {
  it('按图片重查：指定几张图，就把这几张图的每一份链接都查一遍，别的图不碰', async () => {
    const m = await freshManager();
    m.checkRows.value = [
      makeRow({ historyId: 'h1', serviceId: 'r2', url: 'https://cdn.example.com/a.jpg' }),
      makeRow({ historyId: 'h1', serviceId: 'github', url: 'https://github.example.com/a.jpg' }),
      makeRow({ historyId: 'h2', serviceId: 'r2', url: 'https://cdn.example.com/b.jpg' }),
    ];
    invokeMock.mockResolvedValueOnce({
      results: [], total: 2, valid: 0, invalid: 0, timeout: 0, suspicious: 0, elapsed_ms: 1, cancelled: false,
    });

    await m.checkSubset({ historyIds: ['h1'] });

    const [, payload] = invokeMock.mock.calls.find(([command]) => command === 'batch_check_links')!;
    expect((payload as { request: { links: unknown[] } }).request.links).toEqual([
      expect.objectContaining({ history_id: 'h1', service_id: 'r2' }),
      expect.objectContaining({ history_id: 'h1', service_id: 'github' }),
    ]);
  });

  it('只查没查过的：已有结果的链接不重发请求', async () => {
    vi.useFakeTimers();
    try {
      const m = await freshManager();
      const loadPromise = m.loadHistoryRows();
      await vi.advanceTimersByTimeAsync(400);
      await loadPromise;

      m.checkRows.value = [
        makeRow({ historyId: 'h-done', serviceId: 'r2', checkResult: { link: '', is_valid: true, error_type: 'success', browser_might_work: false } }),
        makeRow({ historyId: 'h-new', serviceId: 'r2', url: 'https://r2.example.com/new.jpg' }),
      ];
      invokeMock.mockResolvedValueOnce({
        results: [], total: 1, valid: 0, invalid: 0, timeout: 0, suspicious: 0, elapsed_ms: 1, cancelled: false,
      });

      await m.checkSubset({ statusFilter: 'unchecked' });

      const [, payload] = invokeMock.mock.calls.find(([command]) => command === 'batch_check_links')!;
      expect((payload as { request: { links: unknown[] } }).request.links).toEqual([
        expect.objectContaining({ history_id: 'h-new' }),
      ]);
    } finally {
      vi.useRealTimers();
    }
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

    await m.checkSubset({ historyIds: ['h1'] });

    expect(m.progress.value?.current_url).toBe('current');
  });

  it('检测途中逐条到达的结果带上检查时间（结论卡的「N 天前检查」要用）', async () => {
    const m = await freshManager();
    let progressHandler: ((event: { payload: any }) => void) | undefined;
    listenMock.mockImplementationOnce(async (_event, handler) => {
      progressHandler = handler as (event: { payload: any }) => void;
      return vi.fn();
    });
    vi.spyOn(Date, 'now').mockReturnValue(4242);

    // 行索引只在整表替换的入口重建：走真实的读取流程把这一行读进来
    historyDBStreamMock.mockImplementationOnce(async function* () { yield [liteRow('h1')]; });
    await m.loadHistoryRows();
    const row = m.checkRows.value[0];
    const itemResult = {
      link: row.url, history_id: 'h1', service_id: 'r2',
      is_valid: true, status_code: 200, error_type: 'success' as const, browser_might_work: false,
    };
    let checkedAtMidway: number | undefined;
    invokeMock.mockImplementationOnce(async (_command, payload) => {
      const batchId = (payload as { request: { batch_id: string } }).request.batch_id;
      progressHandler?.({
        payload: { batch_id: batchId, checked: 1, total: 1, current_url: row.url, recent_results: [itemResult] },
      });
      checkedAtMidway = row.checkedAt;
      return {
        batch_id: batchId, results: [itemResult],
        total: 1, valid: 1, invalid: 0, timeout: 0, suspicious: 0, elapsed_ms: 1, cancelled: false,
      };
    });

    await m.checkSubset({ historyIds: ['h1'] });

    expect(checkedAtMidway).toBe(4242);
    expect(m.checkRows.value[0].checkedAt).toBe(4242);
    vi.mocked(Date.now).mockRestore();
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

    const result = await m.checkSubset({ historyIds: ['h1'] });

    expect(result).toBeNull();
    expect(m.checkRows.value[0].checkResult).toBeUndefined();
    expect(historyDBBatchUpdateLinkCheckStatusMock).not.toHaveBeenCalled();
  });

  it('[BUG 回归] 取消后续检：旧批次迟到的结果仍然落库，不再整批丢弃', async () => {
    // 大批量检测中途点取消 → toast 引导「仅未检测」续检 → 旧批次的在途请求几十秒后才返回。
    // 以前会因为「会话号变了」把旧批次已完成的几千条结果连同落库一起跳过，
    // 重启后这批全部回退成「未检测」。
    const m = await freshManager();
    m.checkRows.value = [
      makeRow({ historyId: 'h-old', serviceId: 'r2', url: 'https://cdn.example.com/old.jpg' }),
      makeRow({ historyId: 'h-new', serviceId: 'r2', url: 'https://cdn.example.com/new.jpg' }),
    ];

    const oldBatch = deferInvoke({
      results: [
        {
          link: 'https://cdn.example.com/old.jpg',
          history_id: 'h-old', service_id: 'r2',
          is_valid: true, error_type: 'success', browser_might_work: false,
        },
        // 这一条同时也在新批次里——新批次的结果更新，旧结果不该盖上去
        {
          link: 'https://cdn.example.com/new.jpg',
          history_id: 'h-new', service_id: 'r2',
          is_valid: false, error_type: 'http_4xx', browser_might_work: false,
        },
      ],
      total: 2, valid: 1, invalid: 1, timeout: 0, suspicious: 0, elapsed_ms: 1, cancelled: true,
    });

    invokeMock
      .mockImplementationOnce(oldBatch.impl)   // 旧批次：挂住不返回
      .mockResolvedValueOnce(undefined)        // cancel_batch_check
      .mockResolvedValueOnce({                 // 新批次：立刻返回
        results: [], total: 0, valid: 0, invalid: 0,
        timeout: 0, suspicious: 0, elapsed_ms: 1, cancelled: false,
      });

    const oldPromise = m.checkSubset({ historyIds: ['h-old'] });
    await oldBatch.startedPromise;
    await m.cancelCheck();
    await m.checkSubset({ historyIds: ['h-new'] });

    oldBatch.release();
    expect(await oldPromise).toBeNull();

    const persistedIds = historyDBBatchUpdateLinkCheckStatusMock.mock.calls
      .flatMap((call) => (call[0] as Array<{ id: string }>).map((u) => u.id));
    expect(persistedIds).toContain('h-old');
    // 新批次已经接管了 h-new，旧批次更陈旧的结果必须避让
    expect(persistedIds).not.toContain('h-new');
  });

  it('[BUG 回归] 检测途中历史被清空：结果整批作废，不写到已删记录上', async () => {
    // 与「被新批次替代」相反——清空后结果指向的记录已经不存在，写库就是写幽灵数据
    const { manager: m, emitCacheEvent } = await freshManagerWithCacheEvents();
    m.checkRows.value = [
      makeRow({ historyId: 'h1', serviceId: 'r2', url: 'https://cdn.example.com/a.jpg' }),
    ];

    const batch = deferInvoke({
      results: [
        {
          link: 'https://cdn.example.com/a.jpg',
          history_id: 'h1', service_id: 'r2',
          is_valid: true, error_type: 'success', browser_might_work: false,
        },
      ],
      total: 1, valid: 1, invalid: 0, timeout: 0, suspicious: 0, elapsed_ms: 1, cancelled: false,
    });

    invokeMock
      .mockImplementationOnce(batch.impl)
      .mockResolvedValueOnce(undefined); // history-cleared 分支里的 cancel_batch_check

    const promise = m.checkSubset({ historyIds: ['h1'] });
    await batch.startedPromise;

    emitCacheEvent({ type: 'history-cleared', timestamp: 1 });
    batch.release();

    expect(await promise).toBeNull();
    expect(m.checkRows.value).toHaveLength(0);
    expect(historyDBBatchUpdateLinkCheckStatusMock).not.toHaveBeenCalled();
  });

  it('[BUG 回归] 检测结果保存失败时回滚 UI 状态，避免和 DB 不一致', async () => {
    const m = await freshManager();
    const oldResult = {
      link: 'https://cdn.example.com/a.jpg',
      is_valid: false,
      error_type: 'http_4xx' as const,
      status_code: 404,
      browser_might_work: false,
    };
    m.checkRows.value = [
      makeRow({
        historyId: 'h1',
        serviceId: 'r2',
        url: 'https://cdn.example.com/a.jpg',
        checkResult: oldResult,
      }),
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
    historyDBBatchUpdateLinkCheckStatusMock.mockRejectedValueOnce(new Error('database locked'));

    const result = await m.checkSubset({ historyIds: ['h1'] });

    expect(result).toBeNull();
    expect(m.checkRows.value[0].checkResult).toEqual(oldResult);
    expect(toastErrorMock).toHaveBeenCalledWith('保存检测结果失败', 'database locked');
  });
});
