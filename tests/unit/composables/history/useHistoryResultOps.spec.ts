import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { HistoryItem } from '@/config/types';
import { TOAST_MESSAGES } from '@/constants';
import { recomputeLinkCheckSummary } from '@/types/linkCheckSummary';
import {
  createHistoryItem,
  createHistoryResult,
  createHistoryUploadResult,
  createLinkCheckStatusEntry,
  createLinkCheckSummary,
  resetHistoryFactorySequence,
} from '../../factories';

/**
 * 单测目标：createResultOps —— 链接检测视图「按图床粒度删链接」的真实实现。
 *
 * 为什么必须新开 spec：唯一碰过该模块的 linkCheckView.spec.ts 把整个 useHistoryManager
 * 用 vi.fn() mock 掉了，真实实现一行都没跑过（覆盖率 8.42% 只是 mock factory 求值的残留）。
 *
 * 两个刻意不 mock 的依赖：
 * - `@/constants`：src/constants/index.ts 只 re-export toastMessages + uiCopy，两者纯净无副作用。
 *   用真实 TOAST_MESSAGES 才能断言到具体文案对象，比 expect.any(Object) 有价值。
 * - `@/types/linkCheckSummary`：必须跑真实的 recomputeLinkCheckSummary，否则「跨文件约定」
 *   那一组用例就是空的（见 HistoryDatabase.ts:367 的一致性声明）。
 *
 * 注意 createResultOps 只返回 2 个方法；applyChanges 是闭包内私有 helper，
 * 只能经 deleteHistoryResult / bulkDeleteHistoryResults 两个出口间接验证。
 */

const {
  getByIdMock,
  updateMock,
  deleteMock,
  toastShowConfigMock,
  confirmMock,
  emitHistoryDeletedMock,
  emitHistoryUpdatedMock,
} = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  toastShowConfigMock: vi.fn(),
  confirmMock: vi.fn(),
  emitHistoryDeletedMock: vi.fn(),
  emitHistoryUpdatedMock: vi.fn(),
}));

vi.mock('@/services/HistoryDatabase', () => ({
  historyDB: {
    getById: getByIdMock,
    update: updateMock,
    delete: deleteMock,
  },
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showConfig: toastShowConfigMock,
  }),
}));

vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirm: confirmMock,
  }),
}));

vi.mock('@/events/cacheEvents', () => ({
  emitHistoryDeleted: emitHistoryDeletedMock,
  emitHistoryUpdated: emitHistoryUpdatedMock,
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { createResultOps } = await import('@/composables/history/useHistoryResultOps');

// ─── 测试夹具 ────────────────────────────────────────────

/**
 * ctx 与 useHistoryBulkOps 的 BulkOpsContext 逐字段相同，makeCtx 直接沿用那份姿势。
 * 返回值里除了 ctx 还带一组探针，供断言 applyChanges 的副作用。
 */
function makeCtx(initialTotalCount = 5) {
  const removedFavoriteBatches: string[][] = [];
  const detailCache = {
    getDetail: vi.fn(),
    getDetails: vi.fn(),
    removeDetail: vi.fn(),
    prefetchDetails: vi.fn(),
    clearCache: vi.fn(),
    cacheStats: ref({ size: 0, maxSize: 200, hitCount: 0, missCount: 0, hitRate: 0 }),
  };
  const refreshServiceCounts = vi.fn().mockResolvedValue(undefined);

  return {
    ctx: {
      totalCount: ref(initialTotalCount),
      dataVersion: ref(1),
      detailCache,
      removeFavoritesFromIds: (ids: string[]) => {
        removedFavoriteBatches.push(ids);
      },
      refreshServiceCounts,
    } as unknown as Parameters<typeof createResultOps>[0],
    detailCache,
    removedFavoriteBatches,
    refreshServiceCounts,
  };
}

/** 三图床记录：jd（主）/ qiyu / weibo，全部 success 且带 url */
function makeMultiServiceItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return createHistoryItem({
    id: 'hist-multi',
    primaryService: 'jd',
    results: [
      createHistoryResult({ serviceId: 'jd' }),
      createHistoryResult({ serviceId: 'qiyu' }),
      createHistoryResult({ serviceId: 'weibo' }),
    ],
    ...overrides,
  });
}

/** 单图床记录：只有 jd 一条结果，删掉它就会触发「结果归零 → 整条删」 */
function makeSingleServiceItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return createHistoryItem({
    id: 'hist-single',
    primaryService: 'jd',
    results: [createHistoryResult({ serviceId: 'jd' })],
    ...overrides,
  });
}

/** 取第 n 次 historyDB.update 的 payload（第二个实参） */
function updatePayload(callIndex = 0): Partial<HistoryItem> {
  return updateMock.mock.calls[callIndex][1] as Partial<HistoryItem>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHistoryFactorySequence();
  confirmMock.mockResolvedValue(true);
  getByIdMock.mockResolvedValue(null);
  updateMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
  emitHistoryDeletedMock.mockResolvedValue(undefined);
  emitHistoryUpdatedMock.mockResolvedValue(undefined);
});

// ─── ① deleteHistoryResult 前置校验 ──────────────────────

describe('createResultOps - deleteHistoryResult 前置校验', () => {
  it('rejects an empty historyId with an invalid-id toast and never touches the database', async () => {
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('', 'jd');

    expect(result).toBe(false);
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', TOAST_MESSAGES.history.invalidId);
    expect(getByIdMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('rejects an empty serviceId with an invalid-id toast', async () => {
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-multi', '');

    expect(result).toBe(false);
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', TOAST_MESSAGES.history.invalidId);
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  // 参数非法与「记录不存在」共用同一条 invalidId 文案，用户侧无法区分两种失败。
  // 这里固化现状，将来若拆分文案，这条用例会主动报警。
  it('reuses the invalid-id toast when the record cannot be found', async () => {
    getByIdMock.mockResolvedValue(null);
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('missing', 'jd');

    expect(result).toBe(false);
    expect(getByIdMock).toHaveBeenCalledWith('missing');
    expect(toastShowConfigMock).toHaveBeenCalledWith('error', TOAST_MESSAGES.history.invalidId);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('warns that the whole record will be removed when only one result is left', async () => {
    getByIdMock.mockResolvedValue(makeSingleServiceItem());
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    await deleteHistoryResult('hist-single', 'jd');

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('最后一个图床链接'),
      expect.objectContaining({ header: '确认删除整条记录', acceptLabel: '删除' }),
    );
  });

  it('promises the other mirrors are kept when more than one result exists', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem());
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    await deleteHistoryResult('hist-multi', 'qiyu');

    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('其他图床结果会保留'),
      expect.objectContaining({ header: '确认删除链接' }),
    );
  });

  it('writes nothing and stays silent when the user cancels the confirmation', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem());
    confirmMock.mockResolvedValue(false);
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-multi', 'qiyu');

    expect(result).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    // 取消是用户自己的动作，UI 已经反馈过了，不再补一条 toast
    expect(toastShowConfigMock).not.toHaveBeenCalled();
  });

  // matched === false 走的是「log.warn 后静默返回」，UI 侧完全没有反馈。
  // 这是现状而非期望行为，先钉住，将来若补 toast 这条用例会提醒同步修改。
  it('returns false without any toast when the target service is not on the record', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem());
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-multi', 'not-there');

    expect(result).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).not.toHaveBeenCalled();
  });
});

// ─── ② deleteHistoryResult 剥离与降级 ────────────────────

describe('createResultOps - deleteHistoryResult 剥离与降级', () => {
  it('deletes the whole record when the last result is stripped', async () => {
    getByIdMock.mockResolvedValue(makeSingleServiceItem());
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-single', 'jd');

    expect(result).toBe('deleted');
    expect(deleteMock).toHaveBeenCalledWith('hist-single');
    expect(updateMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith(
      'success',
      TOAST_MESSAGES.common.deleteSuccess(1),
    );
  });

  it('keeps the primary service untouched when a non-primary mirror is stripped', async () => {
    const item = makeMultiServiceItem();
    getByIdMock.mockResolvedValue(item);
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-multi', 'qiyu');

    expect(result).toBe('updated');
    expect(deleteMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith('hist-multi', expect.any(Object));

    const payload = updatePayload();
    expect(payload.results?.map(r => r.serviceId)).toEqual(['jd', 'weibo']);
    expect(payload.primaryService).toBe('jd');
    expect(payload.generatedLink).toBe(item.generatedLink);
  });

  it('promotes the next successful mirror when the primary service is stripped', async () => {
    const item = makeMultiServiceItem();
    const qiyuUrl = item.results[1].result!.url;
    getByIdMock.mockResolvedValue(item);
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-multi', 'jd');

    expect(result).toBe('updated');
    const payload = updatePayload();
    // 补选取剩余 results 里的第一个 success + url，没有优先级排序
    expect(payload.primaryService).toBe('qiyu');
    expect(payload.generatedLink).toBe(qiyuUrl);
  });

  it('falls back to deleting the record when every remaining mirror failed', async () => {
    getByIdMock.mockResolvedValue(createHistoryItem({
      id: 'hist-failed-rest',
      primaryService: 'jd',
      results: [
        createHistoryResult({ serviceId: 'jd' }),
        createHistoryResult({ serviceId: 'qiyu', status: 'failed', error: '上传失败' }),
      ],
    }));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-failed-rest', 'jd');

    // 剥完还剩一条 results，但没有可接班的 success → 仍然整条删，
    // 避免留下 generatedLink='' 的孤儿记录
    expect(result).toBe('deleted');
    expect(deleteMock).toHaveBeenCalledWith('hist-failed-rest');
    expect(updateMock).not.toHaveBeenCalled();
  });

  // ⚠️ 跨文件谓词分歧（已登记，待另立条目修）：
  // 这里 useHistoryResultOps.ts:56 要求 `status === 'success' && r.result?.url`，
  // 所以「success 但没有 url」的镜像不算接班人 → 整条删库；
  // 而 HistoryDatabase.ts:354 的 removeMirror 只看 `status === 'success'`，
  // 同样的数据会判定「还剩一条可用镜像」而保留记录。两把尺子不一致。
  // 本用例只固化 composable 侧的现状，不代表这是正确行为。
  it('treats a successful mirror without a URL as unusable and deletes the record', async () => {
    getByIdMock.mockResolvedValue(createHistoryItem({
      id: 'hist-no-url',
      primaryService: 'jd',
      results: [
        createHistoryResult({ serviceId: 'jd' }),
        createHistoryResult({
          serviceId: 'qiyu',
          status: 'success',
          result: createHistoryUploadResult({ serviceId: 'qiyu', url: '' }),
        }),
      ],
    }));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-no-url', 'jd');

    expect(result).toBe('deleted');
    expect(deleteMock).toHaveBeenCalledWith('hist-no-url');
  });

  it('drops only the stripped service from linkCheckStatus and keeps the rest', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem({
      linkCheckStatus: {
        jd: createLinkCheckStatusEntry({ isValid: true }),
        qiyu: createLinkCheckStatusEntry({ isValid: false, errorType: 'http_4xx' }),
        weibo: createLinkCheckStatusEntry({ isValid: true }),
      },
    }));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    await deleteHistoryResult('hist-multi', 'qiyu');

    const payload = updatePayload();
    expect(Object.keys(payload.linkCheckStatus ?? {}).sort()).toEqual(['jd', 'weibo']);
  });

  // HistoryDatabase.update 用 hasOwnProperty 决定写哪些列，所以 payload 里必须
  // 显式带上这个 key（即使值是 undefined），link_check_status 列才会被覆盖成 NULL。
  // 断言 key 存在而不是断言值，才能钉住这个约定。
  it('still sends the linkCheckStatus key when the record never had one', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem({ linkCheckStatus: undefined }));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    await deleteHistoryResult('hist-multi', 'qiyu');

    const payload = updatePayload();
    expect(Object.prototype.hasOwnProperty.call(payload, 'linkCheckStatus')).toBe(true);
    expect(payload.linkCheckStatus).toBeUndefined();
  });

  it('reports a failure toast and leaves state untouched when getById throws', async () => {
    getByIdMock.mockRejectedValue(new Error('db offline'));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-multi', 'qiyu');

    expect(result).toBe(false);
    expect(toastShowConfigMock).toHaveBeenCalledWith(
      'error',
      TOAST_MESSAGES.common.deleteFailed('db offline'),
    );
    expect(ctx.totalCount.value).toBe(5);
    expect(ctx.dataVersion.value).toBe(1);
  });

  it('reports a failure toast and skips applyChanges when the update throws', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem());
    updateMock.mockRejectedValue(new Error('db locked'));
    const { ctx, refreshServiceCounts } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-multi', 'qiyu');

    expect(result).toBe(false);
    expect(toastShowConfigMock).toHaveBeenCalledWith(
      'error',
      TOAST_MESSAGES.common.deleteFailed('db locked'),
    );
    expect(refreshServiceCounts).not.toHaveBeenCalled();
    expect(ctx.dataVersion.value).toBe(1);
    expect(emitHistoryUpdatedMock).not.toHaveBeenCalled();
  });

  it('reports a failure toast and keeps totalCount when the delete throws', async () => {
    getByIdMock.mockResolvedValue(makeSingleServiceItem());
    deleteMock.mockRejectedValue(new Error('disk full'));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-single', 'jd');

    expect(result).toBe(false);
    expect(toastShowConfigMock).toHaveBeenCalledWith(
      'error',
      TOAST_MESSAGES.common.deleteFailed('disk full'),
    );
    expect(ctx.totalCount.value).toBe(5);
    expect(emitHistoryDeletedMock).not.toHaveBeenCalled();
  });

  // 非 Error 抛出物（Rust 侧 invoke 常抛字符串）也要能拼出可读的 detail
  it('stringifies non-Error rejections into the failure toast', async () => {
    getByIdMock.mockRejectedValue('plain string failure');
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-multi', 'qiyu');

    expect(result).toBe(false);
    expect(toastShowConfigMock).toHaveBeenCalledWith(
      'error',
      TOAST_MESSAGES.common.deleteFailed('plain string failure'),
    );
  });
});

// ─── ③ bulkDeleteHistoryResults ──────────────────────────

describe('createResultOps - bulkDeleteHistoryResults', () => {
  it('warns and returns false for an empty selection without asking for confirmation', async () => {
    const { ctx } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    const result = await bulkDeleteHistoryResults([]);

    expect(result).toBe(false);
    expect(toastShowConfigMock).toHaveBeenCalledWith('warn', TOAST_MESSAGES.common.noSelection);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  // 全部 target 非法时走的是 grouped.size === 0 早退，既不弹确认也不弹 toast
  it('returns false silently when every target has a blank id', async () => {
    const { ctx } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    const result = await bulkDeleteHistoryResults([
      { historyId: '', serviceId: 'jd' },
      { historyId: 'hist-multi', serviceId: '' },
    ]);

    expect(result).toBe(false);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).not.toHaveBeenCalled();
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  it('writes nothing when the user cancels the bulk confirmation', async () => {
    confirmMock.mockResolvedValue(false);
    const { ctx } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    const result = await bulkDeleteHistoryResults([{ historyId: 'hist-multi', serviceId: 'jd' }]);

    expect(result).toBe(false);
    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('将删除选中的 1 条图床链接'),
      expect.objectContaining({ header: '批量删除链接', acceptLabel: '删除 1 条' }),
    );
    expect(getByIdMock).not.toHaveBeenCalled();
  });

  // 同一张图的多个图床合并成一次 update，避免 N 次写库
  it('merges multiple services of the same record into a single update', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem());
    const { ctx } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    const result = await bulkDeleteHistoryResults([
      { historyId: 'hist-multi', serviceId: 'jd' },
      { historyId: 'hist-multi', serviceId: 'qiyu' },
    ]);

    expect(result).toBe(true);
    expect(getByIdMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);

    const payload = updatePayload();
    expect(payload.results?.map(r => r.serviceId)).toEqual(['weibo']);
    // 链式剥离：先剥 jd（主）→ 主力落到 qiyu，再剥 qiyu → 主力再落到 weibo
    expect(payload.primaryService).toBe('weibo');
  });

  it('deduplicates repeated targets through the serviceId set', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem());
    const { ctx } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    await bulkDeleteHistoryResults([
      { historyId: 'hist-multi', serviceId: 'qiyu' },
      { historyId: 'hist-multi', serviceId: 'qiyu' },
    ]);

    const payload = updatePayload();
    expect(payload.results?.map(r => r.serviceId)).toEqual(['jd', 'weibo']);
  });

  it('skips records that cannot be found and keeps processing the rest', async () => {
    getByIdMock.mockImplementation(async (id: string) => (
      id === 'hist-multi' ? makeMultiServiceItem() : null
    ));
    const { ctx } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    const result = await bulkDeleteHistoryResults([
      { historyId: 'missing', serviceId: 'jd' },
      { historyId: 'hist-multi', serviceId: 'qiyu' },
    ]);

    expect(result).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith('hist-multi', expect.any(Object));
  });

  it('skips a record whose services all fail to match', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem());
    const { ctx } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    const result = await bulkDeleteHistoryResults([
      { historyId: 'hist-multi', serviceId: 'not-there' },
    ]);

    expect(result).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  // 剥到 results 归零后 current 变 null，内层循环 break，剩下的 serviceId 不再处理
  it('stops stripping a record once it collapses to a whole-record delete', async () => {
    getByIdMock.mockResolvedValue(createHistoryItem({
      id: 'hist-two',
      primaryService: 'jd',
      results: [
        createHistoryResult({ serviceId: 'jd' }),
        createHistoryResult({ serviceId: 'qiyu' }),
      ],
    }));
    const { ctx } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    const result = await bulkDeleteHistoryResults([
      { historyId: 'hist-two', serviceId: 'jd' },
      { historyId: 'hist-two', serviceId: 'qiyu' },
      { historyId: 'hist-two', serviceId: 'weibo' },
    ]);

    expect(result).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith('hist-two');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('splits deleted and updated records into the right cache events', async () => {
    getByIdMock.mockImplementation(async (id: string) => (
      id === 'hist-single'
        ? makeSingleServiceItem()
        : makeMultiServiceItem()
    ));
    const { ctx, detailCache, removedFavoriteBatches } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    const result = await bulkDeleteHistoryResults([
      { historyId: 'hist-single', serviceId: 'jd' },
      { historyId: 'hist-multi', serviceId: 'jd' },
    ]);

    expect(result).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith('hist-single');
    expect(updateMock).toHaveBeenCalledWith('hist-multi', expect.any(Object));
    expect(emitHistoryDeletedMock).toHaveBeenCalledWith(['hist-single']);
    expect(emitHistoryUpdatedMock).toHaveBeenCalledWith(['hist-multi']);
    // 只有被整条删除的那条会从收藏集合里摘除；被更新的那条记录还在
    expect(removedFavoriteBatches).toEqual([['hist-single']]);
    expect(ctx.totalCount.value).toBe(4);
    expect(detailCache.removeDetail).toHaveBeenCalledWith('hist-single');
    expect(detailCache.removeDetail).toHaveBeenCalledWith('hist-multi');
  });

  it('returns false without a toast when nothing ended up being touched', async () => {
    getByIdMock.mockResolvedValue(null);
    const { ctx } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    const result = await bulkDeleteHistoryResults([{ historyId: 'missing', serviceId: 'jd' }]);

    expect(result).toBe(false);
    expect(toastShowConfigMock).not.toHaveBeenCalled();
  });

  // 成功 toast 报的是入参 targets 的原始条数，不是实际生效条数。
  // 已知会虚报，本次只固化不修（登记在 optimization-plan-2026-08-12.md）。
  it('reports the raw target count in the success toast even when some targets did nothing', async () => {
    getByIdMock.mockImplementation(async (id: string) => (
      id === 'hist-multi' ? makeMultiServiceItem() : null
    ));
    const { ctx } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    await bulkDeleteHistoryResults([
      { historyId: 'hist-multi', serviceId: 'qiyu' },
      { historyId: 'missing-a', serviceId: 'jd' },
      { historyId: 'missing-b', serviceId: 'jd' },
    ]);

    expect(toastShowConfigMock).toHaveBeenCalledWith(
      'success',
      TOAST_MESSAGES.common.deleteSuccess(3),
    );
  });

  // 批量删除不是原子操作：循环中途抛错时，前面已提交的写库不会回滚，
  // 而 applyChanges 在循环之后才执行，所以内存态（totalCount / dataVersion）完全没跟上。
  it('leaves in-memory state stale when the loop throws midway', async () => {
    getByIdMock.mockImplementation(async (id: string) => (
      id === 'hist-single' ? makeSingleServiceItem() : makeMultiServiceItem()
    ));
    updateMock.mockRejectedValue(new Error('db locked'));
    const { ctx, refreshServiceCounts } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    const result = await bulkDeleteHistoryResults([
      { historyId: 'hist-single', serviceId: 'jd' },
      { historyId: 'hist-multi', serviceId: 'jd' },
    ]);

    expect(result).toBe(false);
    // 第一条已经落库删除了，但内存计数没减、事件也没广播
    expect(deleteMock).toHaveBeenCalledWith('hist-single');
    expect(ctx.totalCount.value).toBe(5);
    expect(ctx.dataVersion.value).toBe(1);
    expect(refreshServiceCounts).not.toHaveBeenCalled();
    expect(emitHistoryDeletedMock).not.toHaveBeenCalled();
    expect(toastShowConfigMock).toHaveBeenCalledWith(
      'error',
      TOAST_MESSAGES.common.deleteFailed('db locked'),
    );
  });

  // 与单条版对称：Tauri invoke 抛出的常是字符串而非 Error，detail 不能变成 "[object Object]"
  it('stringifies non-Error rejections into the failure toast', async () => {
    getByIdMock.mockRejectedValue('plain string failure');
    const { ctx } = makeCtx();
    const { bulkDeleteHistoryResults } = createResultOps(ctx);

    const result = await bulkDeleteHistoryResults([{ historyId: 'hist-multi', serviceId: 'jd' }]);

    expect(result).toBe(false);
    expect(toastShowConfigMock).toHaveBeenCalledWith(
      'error',
      TOAST_MESSAGES.common.deleteFailed('plain string failure'),
    );
  });
});

// ─── ④ applyChanges 副作用（经两个出口间接验证） ─────────

describe('createResultOps - applyChanges 副作用', () => {
  it('drops the count, favorites, detail cache and broadcasts on a whole-record delete', async () => {
    getByIdMock.mockResolvedValue(makeSingleServiceItem());
    const { ctx, detailCache, removedFavoriteBatches, refreshServiceCounts } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    await deleteHistoryResult('hist-single', 'jd');

    expect(ctx.totalCount.value).toBe(4);
    expect(removedFavoriteBatches).toEqual([['hist-single']]);
    expect(detailCache.removeDetail).toHaveBeenCalledWith('hist-single');
    expect(refreshServiceCounts).toHaveBeenCalledTimes(1);
    expect(ctx.dataVersion.value).toBe(2);
    expect(emitHistoryDeletedMock).toHaveBeenCalledWith(['hist-single']);
    expect(emitHistoryUpdatedMock).not.toHaveBeenCalled();
  });

  it('clamps totalCount at zero instead of going negative', async () => {
    getByIdMock.mockResolvedValue(makeSingleServiceItem());
    const { ctx } = makeCtx(0);
    const { deleteHistoryResult } = createResultOps(ctx);

    await deleteHistoryResult('hist-single', 'jd');

    expect(ctx.totalCount.value).toBe(0);
  });

  // 部分更新时记录还在，所以既不减 totalCount 也不动收藏集合，只失效详情缓存
  it('only invalidates the detail cache on a partial update', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem());
    const { ctx, detailCache, removedFavoriteBatches, refreshServiceCounts } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    await deleteHistoryResult('hist-multi', 'qiyu');

    expect(ctx.totalCount.value).toBe(5);
    expect(removedFavoriteBatches).toEqual([]);
    expect(detailCache.removeDetail).toHaveBeenCalledWith('hist-multi');
    expect(refreshServiceCounts).toHaveBeenCalledTimes(1);
    expect(ctx.dataVersion.value).toBe(2);
    expect(emitHistoryUpdatedMock).toHaveBeenCalledWith(['hist-multi']);
    expect(emitHistoryDeletedMock).not.toHaveBeenCalled();
  });

  // 跨窗口广播是 fire-and-forget：失败只 log.warn，不能把已经成功的删除翻成失败
  it('still reports success when the deleted broadcast rejects', async () => {
    getByIdMock.mockResolvedValue(makeSingleServiceItem());
    emitHistoryDeletedMock.mockRejectedValue(new Error('no other window'));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-single', 'jd');

    expect(result).toBe('deleted');
    expect(toastShowConfigMock).toHaveBeenCalledWith(
      'success',
      TOAST_MESSAGES.common.deleteSuccess(1),
    );
  });

  it('still reports success when the updated broadcast rejects', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem());
    emitHistoryUpdatedMock.mockRejectedValue(new Error('no other window'));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    const result = await deleteHistoryResult('hist-multi', 'qiyu');

    expect(result).toBe('updated');
    expect(toastShowConfigMock).toHaveBeenCalledWith(
      'success',
      TOAST_MESSAGES.common.deleteSuccess(1),
    );
  });
});

// ─── ⑤ 跨文件约定：linkCheckSummary 重算 ─────────────────

describe('createResultOps - 跨文件约定：linkCheckSummary 重算', () => {
  // HistoryDatabase.ts:367 声明 removeMirror 的 summary 同步「与 stripServiceFromItem 保持一致」。
  // 这里跑真实的 recomputeLinkCheckSummary，验证 composable 侧喂进去的确实是
  // 「剥离后的 results + 剥离后的 status + 原 summary」，与 HistoryDatabase.ts:370 同款调用。
  it('feeds the stripped results and status into the shared recompute helper', async () => {
    const previousSummary = createLinkCheckSummary({
      totalLinks: 3,
      validLinks: 2,
      invalidLinks: 1,
      uncheckedLinks: 0,
    });
    getByIdMock.mockResolvedValue(makeMultiServiceItem({
      linkCheckStatus: {
        jd: createLinkCheckStatusEntry({ isValid: true }),
        qiyu: createLinkCheckStatusEntry({ isValid: false, errorType: 'http_4xx' }),
        weibo: createLinkCheckStatusEntry({ isValid: true }),
      },
      linkCheckSummary: previousSummary,
    }));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    await deleteHistoryResult('hist-multi', 'weibo');

    const payload = updatePayload();
    // 写死的期望值：删掉一条 valid 之后 3/2/1/0 → 2/1/1/0，lastCheckTime 原样保留
    expect(payload.linkCheckSummary).toEqual({
      totalLinks: 2,
      validLinks: 1,
      invalidLinks: 1,
      uncheckedLinks: 0,
      lastCheckTime: previousSummary.lastCheckTime,
    });
    // 同时确认它就是共享 helper 对同一组入参的输出，两边口径没有分叉
    expect(payload.linkCheckSummary).toEqual(
      recomputeLinkCheckSummary(payload.results!, payload.linkCheckStatus, previousSummary),
    );
  });

  it('counts a mirror without a check entry as unchecked', async () => {
    const previousSummary = createLinkCheckSummary();
    getByIdMock.mockResolvedValue(makeMultiServiceItem({
      linkCheckStatus: {
        jd: createLinkCheckStatusEntry({ isValid: true }),
        qiyu: createLinkCheckStatusEntry({ isValid: false, errorType: 'http_4xx' }),
      },
      linkCheckSummary: previousSummary,
    }));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    await deleteHistoryResult('hist-multi', 'qiyu');

    // 剩 jd(valid) + weibo(没有 status 条目) → 2 / 1 / 0 / 1
    expect(payloadSummary()).toEqual(expect.objectContaining({
      totalLinks: 2,
      validLinks: 1,
      invalidLinks: 0,
      uncheckedLinks: 1,
    }));
  });

  it('treats a pending check entry as unchecked rather than invalid', async () => {
    const previousSummary = createLinkCheckSummary();
    getByIdMock.mockResolvedValue(makeMultiServiceItem({
      linkCheckStatus: {
        jd: createLinkCheckStatusEntry({ isValid: false, errorType: 'pending' }),
        qiyu: createLinkCheckStatusEntry({ isValid: true }),
        weibo: createLinkCheckStatusEntry({ isValid: true }),
      },
      linkCheckSummary: previousSummary,
    }));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    await deleteHistoryResult('hist-multi', 'weibo');

    expect(payloadSummary()).toEqual(expect.objectContaining({
      totalLinks: 2,
      validLinks: 1,
      invalidLinks: 0,
      uncheckedLinks: 1,
    }));
  });

  // 「从未检测过就不凭空造 summary」——previousSummary 为空时重算结果必须还是空
  it('keeps the summary undefined when the record was never checked', async () => {
    getByIdMock.mockResolvedValue(makeMultiServiceItem({ linkCheckSummary: undefined }));
    const { ctx } = makeCtx();
    const { deleteHistoryResult } = createResultOps(ctx);

    await deleteHistoryResult('hist-multi', 'qiyu');

    const payload = updatePayload();
    expect(Object.prototype.hasOwnProperty.call(payload, 'linkCheckSummary')).toBe(true);
    expect(payload.linkCheckSummary).toBeUndefined();
  });
});

/** 取最近一次 update payload 里的 linkCheckSummary */
function payloadSummary(): HistoryItem['linkCheckSummary'] {
  return updatePayload().linkCheckSummary;
}
