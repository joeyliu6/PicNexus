import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { invoke } from '@tauri-apps/api/core';
import type { HistoryItem } from '../../../../config/types';

/**
 * 单测目标：useMirrorFallback 的三个核心动作 + 派生态
 * - switchPrimary：成功 / 同 service no-op
 * - removeMirror：非主 confirm → 删；主图床 + 有 successor → 先切再删；无 successor → toast 拦截
 * - checkMirror：成功写 DB / 失败 toast / 并发守卫 / invoke 抛错清理
 */

const {
  toastSuccessMock,
  toastWarnMock,
  toastErrorMock,
  confirmDeleteMock,
  invalidateCacheMock,
  emitHistoryUpdatedMock,
  dbSwitchPrimaryMock,
  dbRemoveMirrorMock,
  dbGetByIdMock,
  dbUpdateMock,
} = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastWarnMock: vi.fn(),
  toastErrorMock: vi.fn(),
  confirmDeleteMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
  emitHistoryUpdatedMock: vi.fn().mockResolvedValue(undefined),
  dbSwitchPrimaryMock: vi.fn().mockResolvedValue(undefined),
  dbRemoveMirrorMock: vi.fn().mockResolvedValue(undefined),
  dbGetByIdMock: vi.fn(),
  dbUpdateMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    warn: toastWarnMock,
    error: toastErrorMock,
  }),
}));

vi.mock('../../../../composables/useConfirm', () => ({
  useConfirm: () => ({
    confirmDelete: confirmDeleteMock,
  }),
}));

vi.mock('../../../../composables/useHistory', () => ({
  useHistoryManager: () => ({
    invalidateCache: invalidateCacheMock,
  }),
}));

vi.mock('../../../../events/cacheEvents', () => ({
  emitHistoryUpdated: emitHistoryUpdatedMock,
}));

vi.mock('../../../../services/HistoryDatabase', () => ({
  historyDB: {
    switchPrimaryService: dbSwitchPrimaryMock,
    removeMirror: dbRemoveMirrorMock,
    getById: dbGetByIdMock,
    update: dbUpdateMock,
  },
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

const { useMirrorFallback } = await import('../../../../composables/history/useMirrorFallback');

function makeItem(
  primaryService = 'jd',
  linkCheckStatus: HistoryItem['linkCheckStatus'] = {},
): HistoryItem {
  return {
    id: 'hist-1',
    timestamp: 1_710_000_000_000,
    localFileName: 'pic.png',
    filePath: '/tmp/pic.png',
    primaryService,
    generatedLink: 'https://jd.example/pic.png',
    width: 100,
    height: 80,
    aspectRatio: 1.25,
    fileSize: 1024,
    format: 'png',
    results: [
      {
        serviceId: 'jd',
        status: 'success',
        result: { serviceId: 'jd', fileKey: 'k-jd', url: 'https://jd.example/pic.png' },
      },
      {
        serviceId: 'qiyu',
        status: 'success',
        result: { serviceId: 'qiyu', fileKey: 'k-qiyu', url: 'https://qiyu.example/pic.png' },
      },
      {
        serviceId: 'weibo',
        status: 'success',
        result: { serviceId: 'weibo', fileKey: 'k-weibo', url: 'https://weibo.example/pic.png' },
      },
    ],
    linkCheckStatus,
  } as HistoryItem;
}

function mountHarness(initialItem: HistoryItem | null = makeItem()) {
  const item = ref(initialItem);
  let api: ReturnType<typeof useMirrorFallback> | null = null;
  const Harness = defineComponent({
    setup() {
      api = useMirrorFallback(item);
      return () => h('div');
    },
  });
  mount(Harness);
  return { item, api: () => api! };
}

const invokeMock = vi.mocked(invoke);

describe('useMirrorFallback - 派生态', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('mirrors 按主服务首位 + 过滤失败/空 URL 条目排序', () => {
    const item = makeItem('qiyu', {
      jd: { isValid: true, lastCheckTime: 1, errorType: 'success' },
      qiyu: { isValid: false, lastCheckTime: 2, errorType: 'http_4xx' },
    });
    const harness = mountHarness(item);
    const list = harness.api().mirrors.value;

    expect(list).toHaveLength(3);
    expect(list[0].serviceId).toBe('qiyu');
    expect(list[0].isPrimary).toBe(true);
    expect(list[0].checkState).toBe('invalid');
    expect(list[1].checkState).toBe('valid'); // jd
    expect(list[2].checkState).toBe('unchecked'); // weibo
  });

  it('isPrimaryBroken 仅主服务 invalid 为真；未检测不算', () => {
    const broken = mountHarness(makeItem('jd', {
      jd: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
    }));
    expect(broken.api().isPrimaryBroken.value).toBe(true);

    const unchecked = mountHarness(makeItem('jd'));
    expect(unchecked.api().isPrimaryBroken.value).toBe(false);
  });

  it('allMirrorsBroken 要求所有行都 invalid', () => {
    const allBad = mountHarness(makeItem('jd', {
      jd: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
      qiyu: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
      weibo: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
    }));
    expect(allBad.api().allMirrorsBroken.value).toBe(true);

    const mixed = mountHarness(makeItem('jd', {
      jd: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
      qiyu: { isValid: true, lastCheckTime: 1, errorType: 'success' },
    }));
    expect(mixed.api().allMirrorsBroken.value).toBe(false);
  });

  it('suggestedMirror 优先 valid，其次 unchecked，全失效返回 undefined', () => {
    const hasValid = mountHarness(makeItem('jd', {
      qiyu: { isValid: true, lastCheckTime: 1, errorType: 'success' },
    }));
    expect(hasValid.api().suggestedMirror.value?.serviceId).toBe('qiyu');

    const onlyUnchecked = mountHarness(makeItem('jd'));
    expect(onlyUnchecked.api().suggestedMirror.value?.serviceId).toBe('qiyu');

    const allBad = mountHarness(makeItem('jd', {
      qiyu: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
      weibo: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
    }));
    expect(allBad.api().suggestedMirror.value).toBeUndefined();
  });
});

describe('useMirrorFallback - switchPrimary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('成功切换：调 DB + 失效缓存 + emit 事件 + toast.success', async () => {
    const harness = mountHarness();
    await harness.api().switchPrimary('qiyu');

    expect(dbSwitchPrimaryMock).toHaveBeenCalledWith('hist-1', 'qiyu');
    expect(invalidateCacheMock).toHaveBeenCalled();
    expect(emitHistoryUpdatedMock).toHaveBeenCalledWith(['hist-1']);
    expect(toastSuccessMock).toHaveBeenCalledWith('已切换主图床', expect.any(String));
  });

  it('切到当前主图床是 no-op', async () => {
    const harness = mountHarness();
    await harness.api().switchPrimary('jd');

    expect(dbSwitchPrimaryMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('DB 抛错时走 toast.error 不中断', async () => {
    dbSwitchPrimaryMock.mockRejectedValueOnce(new Error('db offline'));
    const harness = mountHarness();
    await harness.api().switchPrimary('qiyu');

    expect(toastErrorMock).toHaveBeenCalledWith('切换失败', 'db offline');
  });
});

describe('useMirrorFallback - removeMirror', () => {
  // removeMirror 内部调 confirmDelete 但不 await 其 onConfirm 回调——
  // 为让断言看到回调内的所有 await 链完成，我们把 onConfirm 的 Promise
  // 收集起来供 test 显式等。
  let pendingConfirms: Array<Promise<unknown>> = [];
  async function flushConfirms() {
    while (pendingConfirms.length > 0) {
      const pending = pendingConfirms.splice(0);
      await Promise.all(pending);
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    pendingConfirms = [];
    confirmDeleteMock.mockImplementation((_msg: string, onConfirm: () => unknown) => {
      pendingConfirms.push(Promise.resolve(onConfirm()));
    });
  });

  it('非主图床：confirm → historyDB.removeMirror + toast.success', async () => {
    const harness = mountHarness();
    await harness.api().removeMirror('qiyu');
    await flushConfirms();

    expect(confirmDeleteMock).toHaveBeenCalled();
    expect(dbRemoveMirrorMock).toHaveBeenCalledWith('hist-1', 'qiyu');
    expect(dbSwitchPrimaryMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith('链接已移除', expect.any(String));
  });

  it('主图床 + 有 successor：确认后先 switchPrimary(successor) 再 removeMirror(原主)', async () => {
    const harness = mountHarness(makeItem('jd', {
      qiyu: { isValid: true, lastCheckTime: 1, errorType: 'success' },
    }));
    await harness.api().removeMirror('jd');
    await flushConfirms();

    expect(dbSwitchPrimaryMock).toHaveBeenCalledWith('hist-1', 'qiyu');
    expect(dbRemoveMirrorMock).toHaveBeenCalledWith('hist-1', 'jd');
    // 顺序：先切再删
    const switchOrder = dbSwitchPrimaryMock.mock.invocationCallOrder[0];
    const removeOrder = dbRemoveMirrorMock.mock.invocationCallOrder[0];
    expect(switchOrder).toBeLessThan(removeOrder);
    expect(toastSuccessMock).toHaveBeenCalledWith(
      '已移除原主链接',
      expect.stringContaining('qiyu'),
    );
  });

  it('主图床 + 全部非主图床都 invalid：无 successor，toast.warn 拦截不删', async () => {
    const harness = mountHarness(makeItem('jd', {
      qiyu: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
      weibo: { isValid: false, lastCheckTime: 1, errorType: 'http_4xx' },
    }));
    await harness.api().removeMirror('jd');

    expect(toastWarnMock).toHaveBeenCalledWith('这是唯一剩下的链接', expect.any(String));
    expect(confirmDeleteMock).not.toHaveBeenCalled();
    expect(dbRemoveMirrorMock).not.toHaveBeenCalled();
  });

  it('用户取消确认：不调 DB', async () => {
    // 覆盖默认实现：confirmDelete 被调但不触发回调 = 用户取消
    confirmDeleteMock.mockImplementation(() => { /* noop */ });
    const harness = mountHarness();
    await harness.api().removeMirror('qiyu');
    await nextTick();

    expect(confirmDeleteMock).toHaveBeenCalled();
    expect(dbRemoveMirrorMock).not.toHaveBeenCalled();
  });

  it('主图床 partial-failure：switch 已成功但 remove 抛错 → toast.warn 告知中间态', async () => {
    dbSwitchPrimaryMock.mockResolvedValueOnce(undefined);
    dbRemoveMirrorMock.mockRejectedValueOnce(new Error('db locked'));
    const harness = mountHarness(makeItem('jd', {
      qiyu: { isValid: true, lastCheckTime: 1, errorType: 'success' },
    }));
    await harness.api().removeMirror('jd');
    await flushConfirms();

    expect(dbSwitchPrimaryMock).toHaveBeenCalledWith('hist-1', 'qiyu');
    expect(dbRemoveMirrorMock).toHaveBeenCalledWith('hist-1', 'jd');
    // 已切的状态要刷出去（让 UI 反映新主图床），但不要走 success toast
    expect(emitHistoryUpdatedMock).toHaveBeenCalledWith(['hist-1']);
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastWarnMock).toHaveBeenCalledWith(
      '主图床已切换，但旧链接未移除',
      expect.stringContaining('db locked'),
    );
  });
});

describe('useMirrorFallback - checkMirror', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('成功：invoke + 写 DB + toast.success + checkingServices 清理', async () => {
    invokeMock.mockResolvedValueOnce({
      link: 'https://qiyu.example/pic.png',
      is_valid: true,
      status_code: 200,
      error_type: 'success',
      browser_might_work: true,
    });
    dbGetByIdMock.mockResolvedValueOnce(makeItem());
    const harness = mountHarness();

    await harness.api().checkMirror('qiyu');

    expect(invokeMock).toHaveBeenCalledWith('check_image_link', {
      link: 'https://qiyu.example/pic.png',
      fallbackUrl: null,
    });
    expect(dbUpdateMock).toHaveBeenCalledWith('hist-1', expect.objectContaining({
      linkCheckStatus: expect.objectContaining({
        qiyu: expect.objectContaining({ isValid: true, errorType: 'success' }),
      }),
    }));
    expect(emitHistoryUpdatedMock).toHaveBeenCalledWith(['hist-1']);
    expect(toastSuccessMock).toHaveBeenCalledWith('检测完成', expect.stringContaining('可用'));
    expect(harness.api().checkingServices.value.has('qiyu')).toBe(false);
  });

  it('失效：写 DB 标记 invalid + toast.warn', async () => {
    invokeMock.mockResolvedValueOnce({
      link: 'https://qiyu.example/pic.png',
      is_valid: false,
      status_code: 404,
      error_type: 'http_4xx',
      browser_might_work: false,
    });
    dbGetByIdMock.mockResolvedValueOnce(makeItem());
    const harness = mountHarness();

    await harness.api().checkMirror('qiyu');

    expect(dbUpdateMock).toHaveBeenCalledWith('hist-1', expect.objectContaining({
      linkCheckStatus: expect.objectContaining({
        qiyu: expect.objectContaining({ isValid: false, errorType: 'http_4xx' }),
      }),
    }));
    expect(toastWarnMock).toHaveBeenCalledWith('检测完成', expect.stringContaining('失效'));
  });

  it('并发守卫：同一 serviceId 已在检测中，再次触发被忽略', async () => {
    // invoke 挂起不 resolve，模拟检测进行中
    let release!: () => void;
    invokeMock.mockImplementationOnce(() => new Promise(r => { release = () => r({
      link: 'x', is_valid: true, error_type: 'success', browser_might_work: true,
    }); }));
    dbGetByIdMock.mockResolvedValue(makeItem());
    const harness = mountHarness();

    const first = harness.api().checkMirror('qiyu');
    await nextTick();
    expect(harness.api().checkingServices.value.has('qiyu')).toBe(true);

    // 第二次触发应早退，不会再调 invoke
    await harness.api().checkMirror('qiyu');
    expect(invokeMock).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(harness.api().checkingServices.value.has('qiyu')).toBe(false);
  });

  it('invoke 抛错：toast.error + finally 清理 checkingServices', async () => {
    invokeMock.mockRejectedValueOnce(new Error('network broken'));
    const harness = mountHarness();

    await harness.api().checkMirror('qiyu');

    expect(toastErrorMock).toHaveBeenCalledWith('检测失败', 'network broken');
    expect(harness.api().checkingServices.value.has('qiyu')).toBe(false);
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('两个不同 serviceId 并发：DB 写入串行化，前一笔结果不会被后一笔覆盖', async () => {
    // 让两次 invoke 都立刻 resolve；getById 返回的 baseline 始终是空 linkCheckStatus
    // （模拟"两个并发回写都拿到同一份 baseline"的最坏情况——若不串行化，
    // 第二笔的 update 会把 linkCheckStatus 整字段替换，第一笔的写丢失）。
    invokeMock
      .mockResolvedValueOnce({
        link: 'q', is_valid: true, error_type: 'success', browser_might_work: true,
      })
      .mockResolvedValueOnce({
        link: 'w', is_valid: false, error_type: 'http_4xx', browser_might_work: false,
      });
    dbGetByIdMock.mockResolvedValue(makeItem());

    // 让 update 在 resolve 前显式追加一笔写入快照，断言两次写都按队列 read→merge→write
    const updateSnapshots: Array<Record<string, unknown>> = [];
    dbUpdateMock.mockImplementation(async (_id: string, patch: { linkCheckStatus?: Record<string, unknown> }) => {
      updateSnapshots.push({ ...(patch.linkCheckStatus ?? {}) });
      // 写入后让"下一次 getById"看到累计后的状态
      const merged = updateSnapshots.reduce((acc, s) => ({ ...acc, ...s }), {});
      dbGetByIdMock.mockResolvedValue({ ...makeItem(), linkCheckStatus: merged });
    });

    const harness = mountHarness();
    await Promise.all([
      harness.api().checkMirror('qiyu'),
      harness.api().checkMirror('weibo'),
    ]);

    expect(dbUpdateMock).toHaveBeenCalledTimes(2);
    // 关键断言：第二笔 update 的 linkCheckStatus 必须包含第一笔写入的 key（即看到了前一笔的合并结果）
    const second = updateSnapshots[1];
    expect(second).toMatchObject({
      qiyu: expect.objectContaining({ isValid: true }),
      weibo: expect.objectContaining({ isValid: false }),
    });
  });
});
