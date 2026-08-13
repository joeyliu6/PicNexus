import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UploadQueueManager, type QueueItem } from '@/core/UploadQueue';
import { useQueueState } from '@/composables/useQueueState';
import { getInvokeMock, resetTauriMocks } from '../helpers/tauriMock';
import {
  QUEUE_SERVICE_STATUS,
  createFailedServiceProgress,
  createLegacyQueueItem,
  createQueueItem,
  createQueueItems,
  createServiceProgress,
  createUploadedServiceProgress,
  resetUploadFactorySequence,
} from '../factories/uploadFactory';

const WEIBO_LINK = 'https://weibo.example/large/a.jpg';
const R2_LINK = 'https://r2.example/a.jpg';

/**
 * 排空 useQueueState 的 RAF 节流队列。
 *
 * updateItemThrottled 把更新压进模块级的 pendingUpdates，靠 requestAnimationFrame 落地。
 * scheduleFlush 先注册 flushPendingUpdates，我们这里的回调后注册，所以 await 返回时
 * flush 一定已经跑完。
 */
async function flushRaf(): Promise<void> {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await Promise.resolve();
}

/** 直接往全局队列里塞预置项：批量场景（trimQueue）和残缺数据用，绕开 addFile 的重复校验 */
function seedItems(items: QueueItem[]): void {
  const { addItem } = useQueueState();
  items.forEach(item => addItem(item));
}

describe('UploadQueueManager', () => {
  let manager: UploadQueueManager;

  beforeEach(async () => {
    resetTauriMocks();
    resetUploadFactorySequence();

    // useQueueState 的 queueItems / pendingUpdates 都是模块级单例，
    // 必须先排空上一条用例遗留的节流更新，再清队列，否则会串味。
    await flushRaf();
    useQueueState().clearQueue();
    await flushRaf();

    getInvokeMock().mockClear();
    manager = new UploadQueueManager();
  });

  describe('addFile', () => {
    it('新文件入队并为每个图床初始化等待态进度', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'r2']);

      expect(id).toMatch(/^queue-/);
      const item = manager.getItem(id!)!;
      expect(item.status).toBe('pending');
      expect(item.fileName).toBe('a.png');
      expect(item.filePath).toBe('/img/a.png');
      expect(item.enabledServices).toEqual(['weibo', 'r2']);
      expect(item.serviceProgress.weibo).toEqual({
        serviceId: 'weibo',
        progress: 0,
        status: QUEUE_SERVICE_STATUS.waiting,
      });
      expect(item.serviceProgress.r2).toEqual({
        serviceId: 'r2',
        progress: 0,
        status: QUEUE_SERVICE_STATUS.waiting,
      });
      expect(item.retryCount).toBe(0);
      expect(item.maxRetries).toBe(3);
      expect(item.isRetrying).toBe(false);
      expect(item.lastRetryTime).toBeUndefined();
    });

    it('启用 r2 时同步向后兼容字段 uploadToR2 / r2Status', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'r2'])!;

      const item = manager.getItem(id)!;
      expect(item.uploadToR2).toBe(true);
      expect(item.r2Status).toBe(QUEUE_SERVICE_STATUS.waiting);
      expect(item.weiboStatus).toBe(QUEUE_SERVICE_STATUS.waiting);
      expect(item.weiboProgress).toBe(0);
      expect(item.r2Progress).toBe(0);
    });

    it('未启用 r2 时 uploadToR2 为 false 且 r2Status 直接置为已跳过', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      const item = manager.getItem(id)!;
      expect(item.uploadToR2).toBe(false);
      expect(item.r2Status).toBe(QUEUE_SERVICE_STATUS.skipped);
    });

    it('enabledServices 存的是副本，调用方后续改数组不会污染队列项', () => {
      const services = ['weibo'];
      const id = manager.addFile('/img/a.png', 'a.png', services)!;

      services.push('r2');

      expect(manager.getItem(id)!.enabledServices).toEqual(['weibo']);
    });

    it('新项插在队首', () => {
      manager.addFile('/img/a.png', 'a.png', ['weibo']);
      manager.addFile('/img/b.png', 'b.png', ['weibo']);

      expect(useQueueState().queueItems.value.map(item => item.fileName)).toEqual(['b.png', 'a.png']);
    });

    it('同路径文件处于 pending 时判定重复，返回 null 且不入队', () => {
      manager.addFile('/img/a.png', 'a.png', ['weibo']);

      expect(manager.addFile('/img/a.png', 'a.png', ['weibo'])).toBeNull();
      expect(manager.getQueueSize()).toBe(1);
    });

    it('同路径文件处于 uploading 时同样判定重复', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      manager.updateItem(id, { status: 'uploading' });

      expect(manager.addFile('/img/a.png', 'a.png', ['weibo'])).toBeNull();
      expect(manager.getQueueSize()).toBe(1);
    });

    it.each([['success'], ['error']] as const)(
      '同路径文件已是 %s 状态时允许再次入队',
      status => {
        const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
        manager.updateItem(id, { status });

        expect(manager.addFile('/img/a.png', 'a.png', ['weibo'])).not.toBeNull();
        expect(manager.getQueueSize()).toBe(2);
      },
    );
  });

  describe('updateServiceProgress', () => {
    it('落地百分比进度并同步 weibo 向后兼容字段', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.updateServiceProgress(id, 'weibo', 33.4);
      await flushRaf();

      const item = manager.getItem(id)!;
      expect(item.status).toBe('uploading');
      expect(item.serviceProgress.weibo).toMatchObject({ progress: 33.4, status: '33%' });
      expect(item.weiboProgress).toBe(33.4);
      expect(item.weiboStatus).toBe('33%');
    });

    it('r2 服务同步 r2 向后兼容字段', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['r2'])!;

      manager.updateServiceProgress(id, 'r2', 60);
      await flushRaf();

      const item = manager.getItem(id)!;
      expect(item.r2Progress).toBe(60);
      expect(item.r2Status).toBe('60%');
      expect(item.weiboProgress).toBe(0);
    });

    it('既非 weibo 也非 r2 的图床不写向后兼容字段', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['jd'])!;

      manager.updateServiceProgress(id, 'jd', 70);
      await flushRaf();

      const item = manager.getItem(id)!;
      expect(item.serviceProgress.jd).toMatchObject({ progress: 70, status: '70%' });
      expect(item.weiboProgress).toBe(0);
      expect(item.r2Progress).toBe(0);
    });

    it.each([
      [-20, 0, '0%'],
      [150, 100, '100%'],
    ])('把越界百分比 %s 收敛到 %s', async (input, expected, expectedText) => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.updateServiceProgress(id, 'weibo', input);
      await flushRaf();

      expect(manager.getItem(id)!.serviceProgress.weibo).toMatchObject({
        progress: expected,
        status: expectedText,
      });
    });

    it('step + stepIndex + totalSteps 齐全时状态文案带步骤序号', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.updateServiceProgress(id, 'weibo', 40, '压缩中', 1, 3);
      await flushRaf();

      const progress = manager.getItem(id)!.serviceProgress.weibo!;
      expect(progress.status).toBe('压缩中 (1/3)');
      expect(progress.metadata).toMatchObject({ step: '压缩中', stepIndex: 1, totalSteps: 3 });
    });

    it('只有 step 时状态文案就是 step 本身', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.updateServiceProgress(id, 'weibo', 40, '上传中');
      await flushRaf();

      expect(manager.getItem(id)!.serviceProgress.weibo!.status).toBe('上传中');
    });

    it('stepIndex 为 0 时退化成只显示 step（0 是 falsy，不拼序号）', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.updateServiceProgress(id, 'weibo', 40, '上传中', 0, 3);
      await flushRaf();

      expect(manager.getItem(id)!.serviceProgress.weibo!.status).toBe('上传中');
    });

    it('保留该服务已有的 metadata，只叠加步骤信息', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      manager.updateItem(id, {
        serviceProgress: { weibo: createServiceProgress({ serviceId: 'weibo', metadata: { pid: 'PID-1' } }) },
      });

      manager.updateServiceProgress(id, 'weibo', 40, '上传中');
      await flushRaf();

      expect(manager.getItem(id)!.serviceProgress.weibo!.metadata).toMatchObject({
        pid: 'PID-1',
        step: '上传中',
      });
    });

    it('找不到队列项时静默返回，不产生任何更新', () => {
      const throttled = vi.spyOn(manager, 'updateItemThrottled');

      manager.updateServiceProgress('ghost', 'weibo', 50);

      expect(throttled).not.toHaveBeenCalled();
    });

    // 下面两条走 spy 而不是断言最终状态：flushPendingUpdates 对 error/success 项会整体丢弃
    // 节流更新（见 docs/reference/troubleshooting/upload-queue-status-race-condition.md），
    // 所以「请求把状态改成什么」只能在提交给节流层的那一刻观察到。
    it('对 error 项请求切回 uploading（重试进场），但节流守卫会丢弃该更新', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      manager.updateItem(id, { status: 'error' });
      const throttled = vi.spyOn(manager, 'updateItemThrottled');

      manager.updateServiceProgress(id, 'weibo', 20);

      expect(throttled).toHaveBeenCalledWith(id, expect.objectContaining({ status: 'uploading' }));
      await flushRaf();
      expect(manager.getItem(id)!.status).toBe('error');
    });

    it('对 success 项不请求改写整体状态', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      manager.updateItem(id, { status: 'success' });
      const throttled = vi.spyOn(manager, 'updateItemThrottled');

      manager.updateServiceProgress(id, 'weibo', 20);

      expect(throttled).toHaveBeenCalledTimes(1);
      expect(throttled.mock.calls[0][1]).not.toHaveProperty('status');
    });
  });

  describe('markItemComplete', () => {
    it('把已传完的服务收口成完成态，并写入主链接与缩略图', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'r2'])!;
      manager.updateItem(id, {
        serviceProgress: {
          weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK, metadata: { pid: 'PID-1' } }),
          r2: createUploadedServiceProgress('r2', { link: R2_LINK }),
        },
      });

      manager.markItemComplete(id, WEIBO_LINK);

      const item = manager.getItem(id)!;
      expect(item.status).toBe('success');
      expect(item.primaryUrl).toBe(WEIBO_LINK);
      expect(item.thumbUrl).toBe(WEIBO_LINK);
      expect(item.serviceProgress.weibo).toMatchObject({
        status: QUEUE_SERVICE_STATUS.done,
        isRetrying: false,
      });
      expect(item.serviceProgress.r2!.status).toBe(QUEUE_SERVICE_STATUS.done);
      expect(item.weiboStatus).toBe(QUEUE_SERVICE_STATUS.done);
      expect(item.r2Status).toBe(QUEUE_SERVICE_STATUS.done);
    });

    it('从 serviceProgress 回填 weiboLink / weiboPid / r2Link', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'r2'])!;
      manager.updateItem(id, {
        serviceProgress: {
          weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK, metadata: { pid: 'PID-1' } }),
          r2: createUploadedServiceProgress('r2', { link: R2_LINK }),
        },
      });

      manager.markItemComplete(id, WEIBO_LINK);

      const item = manager.getItem(id)!;
      expect(item.weiboLink).toBe(WEIBO_LINK);
      expect(item.weiboPid).toBe('PID-1');
      expect(item.r2Link).toBe(R2_LINK);
    });

    it('weibo 的 pid 不是字符串时不回填 weiboPid', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      manager.updateItem(id, {
        serviceProgress: {
          weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK, metadata: { pid: 12345 } }),
        },
      });

      manager.markItemComplete(id, WEIBO_LINK);

      expect(manager.getItem(id)!.weiboPid).toBeUndefined();
    });

    it('没有 link 的服务不参与链接回填', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'r2'])!;
      manager.updateItem(id, {
        serviceProgress: {
          weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK }),
          r2: createUploadedServiceProgress('r2'),
        },
      });

      manager.markItemComplete(id, WEIBO_LINK);

      const item = manager.getItem(id)!;
      expect(item.weiboLink).toBe(WEIBO_LINK);
      expect(item.r2Link).toBeUndefined();
    });

    it.each([
      ['状态就是「✗ 失败」', QUEUE_SERVICE_STATUS.failed],
      ['状态含「失败」字样', '上传失败：403'],
    ])('进度虽为 100 但 %s 的服务不会被改写成完成', (_label, failedStatus) => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'r2'])!;
      manager.updateItem(id, {
        serviceProgress: {
          weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK }),
          r2: createUploadedServiceProgress('r2', { status: failedStatus }),
        },
      });

      manager.markItemComplete(id, WEIBO_LINK);

      expect(manager.getItem(id)!.serviceProgress.r2!.status).toBe(failedStatus);
    });

    it('从未启动过的服务（仍是等待中且进度为 0）标为已跳过（未配置）', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'jd'])!;
      manager.updateItem(id, {
        serviceProgress: { weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK }) },
      });

      manager.markItemComplete(id, WEIBO_LINK);

      expect(manager.getItem(id)!.serviceProgress.jd).toMatchObject({
        serviceId: 'jd',
        progress: 0,
        status: QUEUE_SERVICE_STATUS.skippedUnconfigured,
        isRetrying: false,
      });
    });

    it('enabledServices 里的服务完全没有进度记录时，既不崩溃也不凭空造一条', () => {
      // 进度表被整体替换过、少了某个已启用图床的场景：
      // currentProgress 为 undefined，两个分支的兜底（`?.status || ''` 与 `?.progress ?? 0`）
      // 一起把它挡在外面——既不收口成完成，也不标成「已跳过（未配置）」。
      seedItems([
        createQueueItem({
          id: 'partial',
          enabledServices: ['weibo', 'jd'],
          serviceProgress: { weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK }) },
        }),
      ]);

      expect(() => manager.markItemComplete('partial', WEIBO_LINK)).not.toThrow();

      const item = manager.getItem('partial')!;
      expect(item.status).toBe('success');
      expect(item.serviceProgress.weibo!.status).toBe(QUEUE_SERVICE_STATUS.done);
      expect(item.serviceProgress.jd).toBeUndefined();
    });

    it('处于中间进度的服务保持原状，不被收口也不被标跳过', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'jd'])!;
      manager.updateItem(id, {
        serviceProgress: {
          weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK }),
          jd: createServiceProgress({ serviceId: 'jd', progress: 60, status: '60%' }),
        },
      });

      manager.markItemComplete(id, WEIBO_LINK);

      expect(manager.getItem(id)!.serviceProgress.jd).toMatchObject({ progress: 60, status: '60%' });
    });

    it('未启用的图床在向后兼容字段里显示已跳过', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['jd'])!;
      manager.updateItem(id, {
        serviceProgress: { jd: createUploadedServiceProgress('jd', { link: 'https://jd.example/a.jpg' }) },
      });

      manager.markItemComplete(id, 'https://jd.example/a.jpg');

      const item = manager.getItem(id)!;
      expect(item.weiboStatus).toBe(QUEUE_SERVICE_STATUS.skipped);
      expect(item.r2Status).toBe(QUEUE_SERVICE_STATUS.skipped);
    });

    it('过时的节流进度更新不会覆盖成功状态', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      manager.updateItemThrottled(id, { status: 'uploading', weiboProgress: 5 });

      manager.markItemComplete(id, WEIBO_LINK);
      await flushRaf();

      const item = manager.getItem(id)!;
      expect(item.status).toBe('success');
      expect(item.weiboProgress).toBe(0);
    });

    it('收口后触发 trimQueue(500) 做内存修剪', () => {
      const trim = vi.spyOn(manager, 'trimQueue');
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.markItemComplete(id, WEIBO_LINK);

      expect(trim).toHaveBeenCalledWith(500);
    });

    it('找不到队列项时无副作用', () => {
      manager.addFile('/img/a.png', 'a.png', ['weibo']);

      manager.markItemComplete('ghost', WEIBO_LINK);

      expect(useQueueState().queueItems.value.every(item => item.status === 'pending')).toBe(true);
    });
  });

  describe('markItemFailed', () => {
    it('写入 error 状态与错误信息', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.markItemFailed(id, '所有图床上传均失败');

      const item = manager.getItem(id)!;
      expect(item.status).toBe('error');
      expect(item.errorMessage).toBe('所有图床上传均失败');
      expect(item.weiboStatus).toBe(QUEUE_SERVICE_STATUS.failed);
    });

    it('过时的节流进度更新不会覆盖失败状态', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      manager.updateItemThrottled(id, { status: 'uploading', weiboProgress: 80 });

      manager.markItemFailed(id, 'boom');
      await flushRaf();

      const item = manager.getItem(id)!;
      expect(item.status).toBe('error');
      expect(item.weiboProgress).toBe(0);
    });

    it('找不到队列项时无副作用', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.markItemFailed('ghost', 'boom');

      expect(manager.getItem(id)!.status).toBe('pending');
    });
  });

  describe('createProgressCallback', () => {
    let itemId: string;

    beforeEach(() => {
      itemId = manager.addFile('/img/a.png', 'a.png', ['weibo', 'r2'])!;
    });

    it('weibo_progress 写入百分比并把整体状态置为 uploading', () => {
      manager.createProgressCallback(itemId)({ type: 'weibo_progress', payload: 45 });

      const item = manager.getItem(itemId)!;
      expect(item.weiboProgress).toBe(45);
      expect(item.weiboStatus).toBe('45%');
      expect(item.status).toBe('uploading');
    });

    it.each([
      [-5, 0],
      [180, 100],
      [Number.NaN, 0],
    ])('weibo_progress 把异常 payload %s 收敛为 %s', (payload, expected) => {
      manager.createProgressCallback(itemId)({ type: 'weibo_progress', payload });

      expect(manager.getItem(itemId)!.weiboProgress).toBe(expected);
    });

    it('weibo_success 写入 pid / 大图链接 / 百度链接', () => {
      manager.createProgressCallback(itemId)({
        type: 'weibo_success',
        payload: { pid: 'PID-1', largeUrl: WEIBO_LINK, baiduLink: 'https://baidu.example/a.jpg' },
      });

      const item = manager.getItem(itemId)!;
      expect(item.weiboProgress).toBe(100);
      expect(item.weiboStatus).toBe(QUEUE_SERVICE_STATUS.done);
      expect(item.weiboPid).toBe('PID-1');
      expect(item.weiboLink).toBe(WEIBO_LINK);
      expect(item.baiduLink).toBe('https://baidu.example/a.jpg');
    });

    it.each([
      [-5, 0],
      [180, 100],
      [Number.NaN, 0],
    ])('r2_progress 把异常 payload %s 收敛为 %s', (payload, expected) => {
      manager.createProgressCallback(itemId)({ type: 'r2_progress', payload });

      const item = manager.getItem(itemId)!;
      expect(item.r2Progress).toBe(expected);
      expect(item.r2Status).toBe(`${expected}%`);
    });

    it('r2_success 写入 r2 链接', () => {
      manager.createProgressCallback(itemId)({ type: 'r2_success', payload: { r2Link: R2_LINK } });

      const item = manager.getItem(itemId)!;
      expect(item.r2Progress).toBe(100);
      expect(item.r2Status).toBe(QUEUE_SERVICE_STATUS.done);
      expect(item.r2Link).toBe(R2_LINK);
    });

    it('complete 把整体状态置为 success', () => {
      manager.createProgressCallback(itemId)({ type: 'complete' });

      expect(manager.getItem(itemId)!.status).toBe('success');
    });

    it('error 时 weibo 未传完 → 标记 weibo 失败', () => {
      manager.updateItem(itemId, { weiboProgress: 30 });

      manager.createProgressCallback(itemId)({ type: 'error', payload: 'Cookie 已过期' });

      const item = manager.getItem(itemId)!;
      expect(item.status).toBe('error');
      expect(item.errorMessage).toBe('Cookie 已过期');
      expect(item.weiboStatus).toBe(QUEUE_SERVICE_STATUS.failed);
      expect(item.r2Status).toBe(QUEUE_SERVICE_STATUS.waiting);
    });

    it('error 时 weibo 已传完而 r2 未传完 → 标记 r2 失败', () => {
      manager.updateItem(itemId, { weiboProgress: 100, r2Progress: 40 });

      manager.createProgressCallback(itemId)({ type: 'error', payload: 'R2 连接超时' });

      const item = manager.getItem(itemId)!;
      expect(item.r2Status).toBe(QUEUE_SERVICE_STATUS.failed);
      expect(item.weiboStatus).toBe(QUEUE_SERVICE_STATUS.waiting);
    });

    it('error 时两个图床都已传完 → 不改写任何服务文案', () => {
      manager.updateItem(itemId, { weiboProgress: 100, r2Progress: 100 });

      manager.createProgressCallback(itemId)({ type: 'error', payload: '收尾失败' });

      const item = manager.getItem(itemId)!;
      expect(item.weiboStatus).toBe(QUEUE_SERVICE_STATUS.waiting);
      expect(item.r2Status).toBe(QUEUE_SERVICE_STATUS.waiting);
    });

    it('error 时未启用 r2 且 weibo 已传完 → 不改写任何服务文案', () => {
      const weiboOnlyId = manager.addFile('/img/b.png', 'b.png', ['weibo'])!;
      manager.updateItem(weiboOnlyId, { weiboProgress: 100 });

      manager.createProgressCallback(weiboOnlyId)({ type: 'error', payload: '收尾失败' });

      const item = manager.getItem(weiboOnlyId)!;
      expect(item.weiboStatus).toBe(QUEUE_SERVICE_STATUS.waiting);
      expect(item.r2Status).toBe(QUEUE_SERVICE_STATUS.skipped);
    });

    it('队列项已不存在时回调不抛错，也不误伤其他项', () => {
      expect(() =>
        manager.createProgressCallback('ghost')({ type: 'error', payload: 'boom' }),
      ).not.toThrow();

      expect(manager.getItem(itemId)!.status).toBe('pending');
    });
  });

  describe('resetItemForRetry', () => {
    it('把所有服务重置回等待态并清空上一次的结果', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'r2'])!;
      manager.updateItem(id, {
        status: 'error',
        errorMessage: 'boom',
        primaryUrl: WEIBO_LINK,
        thumbUrl: WEIBO_LINK,
        weiboLink: WEIBO_LINK,
        weiboPid: 'PID-1',
        baiduLink: 'https://baidu.example/a.jpg',
        r2Link: R2_LINK,
        weiboProgress: 100,
        r2Progress: 100,
        serviceProgress: {
          weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK }),
          r2: createFailedServiceProgress('r2'),
        },
      });

      manager.resetItemForRetry(id);

      const item = manager.getItem(id)!;
      expect(item.status).toBe('pending');
      expect(item.errorMessage).toBeUndefined();
      expect(item.primaryUrl).toBeUndefined();
      expect(item.thumbUrl).toBeUndefined();
      expect(item.weiboLink).toBeUndefined();
      expect(item.weiboPid).toBeUndefined();
      expect(item.baiduLink).toBeUndefined();
      expect(item.r2Link).toBeUndefined();
      expect(item.weiboProgress).toBe(0);
      expect(item.r2Progress).toBe(0);
      expect(item.weiboStatus).toBe(QUEUE_SERVICE_STATUS.waiting);
      expect(item.r2Status).toBe(QUEUE_SERVICE_STATUS.waiting);
      expect(item.serviceProgress.weibo).toMatchObject({
        serviceId: 'weibo',
        progress: 0,
        status: QUEUE_SERVICE_STATUS.waiting,
      });
      expect(item.serviceProgress.r2).toMatchObject({
        serviceId: 'r2',
        progress: 0,
        status: QUEUE_SERVICE_STATUS.waiting,
      });
    });

    // ⚠️ 现状记录（非期望行为）：resetItemForRetry 传给 updateItem 的是一份「全新的等待态」，
    // 但 useQueueState.updateItem 对 serviceProgress 做的是深度合并（`{...currentProgress, ...value}`），
    // 新对象里没有 link/error 键，于是上一轮的 link 和 error 原样留在进度表里。
    // 顶层的 weiboLink / r2Link 因为显式传了 undefined 所以确实被清掉了，两边并不一致。
    // 若将来修掉这个泄漏，请一并更新本用例。
    it('重置后服务级 link / error 仍会残留（深度合并导致，与顶层链接字段行为不一致）', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'r2'])!;
      manager.updateItem(id, {
        weiboLink: WEIBO_LINK,
        r2Link: R2_LINK,
        serviceProgress: {
          weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK }),
          r2: createFailedServiceProgress('r2', { error: '连接超时' }),
        },
      });

      manager.resetItemForRetry(id);

      const item = manager.getItem(id)!;
      expect(item.weiboLink).toBeUndefined();
      expect(item.r2Link).toBeUndefined();
      expect(item.serviceProgress.weibo!.link).toBe(WEIBO_LINK);
      expect(item.serviceProgress.r2!.error).toBe('连接超时');
    });

    it('未启用 r2 的项重置后 r2Status 仍是已跳过', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.resetItemForRetry(id);

      expect(manager.getItem(id)!.r2Status).toBe(QUEUE_SERVICE_STATUS.skipped);
    });

    it('缺 enabledServices 的历史遗留项走空进度表兜底，而不是崩溃', () => {
      seedItems([createLegacyQueueItem({ id: 'legacy', status: 'error', serviceProgress: {} })]);

      expect(() => manager.resetItemForRetry('legacy')).not.toThrow();

      const item = manager.getItem('legacy')!;
      expect(item.status).toBe('pending');
      expect(item.serviceProgress).toEqual({});
    });

    it('找不到队列项时无副作用', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      manager.updateItem(id, { status: 'error' });

      manager.resetItemForRetry('ghost');

      expect(manager.getItem(id)!.status).toBe('error');
    });
  });

  describe('resetServiceForRetry', () => {
    it('只重置目标服务并打上重试标记，其他服务不受影响', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'r2'])!;
      manager.updateItem(id, {
        serviceProgress: {
          weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK }),
          r2: createFailedServiceProgress('r2', { error: '连接超时' }),
        },
      });

      manager.resetServiceForRetry(id, 'r2');

      const item = manager.getItem(id)!;
      expect(item.serviceProgress.r2).toMatchObject({
        progress: 0,
        status: QUEUE_SERVICE_STATUS.waiting,
        isRetrying: true,
      });
      expect(item.serviceProgress.r2!.error).toBeUndefined();
      expect(item.serviceProgress.weibo).toMatchObject({
        progress: 100,
        link: WEIBO_LINK,
      });
    });

    it('整体状态为 error 时临时改为 uploading，避免 UI 仍显示失败样式', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      manager.updateItem(id, { status: 'error' });

      manager.resetServiceForRetry(id, 'weibo');

      expect(manager.getItem(id)!.status).toBe('uploading');
    });

    it('整体状态不是 error 时不改写整体状态', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      manager.updateItem(id, { status: 'success' });

      manager.resetServiceForRetry(id, 'weibo');

      expect(manager.getItem(id)!.status).toBe('success');
    });

    it('目标服务不在该项的进度表里时无副作用', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      manager.updateItem(id, { status: 'error' });

      manager.resetServiceForRetry(id, 'r2');

      const item = manager.getItem(id)!;
      expect(item.status).toBe('error');
      expect(item.serviceProgress.r2).toBeUndefined();
    });

    it('找不到队列项时无副作用', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.resetServiceForRetry('ghost', 'weibo');

      expect(manager.getItem(id)!.serviceProgress.weibo!.isRetrying).toBeUndefined();
    });
  });

  describe('trimQueue', () => {
    it('默认只保留最近 100 条已完成记录', () => {
      seedItems(createQueueItems(101, index => ({ id: `done-${index}`, status: 'success' })));

      manager.trimQueue();

      // addItem 走 unshift，队列是「新→旧」，最先塞进去的 done-0 最旧
      expect(manager.getQueueSize()).toBe(100);
      expect(manager.getItem('done-0')).toBeUndefined();
      expect(manager.getItem('done-1')).toBeDefined();
    });

    it('已完成记录未超限时不删除任何项', () => {
      seedItems(createQueueItems(3, index => ({ id: `done-${index}`, status: 'success' })));

      manager.trimQueue(5);

      expect(manager.getQueueSize()).toBe(3);
    });

    it('pending / uploading 项不计入配额也不会被删除', () => {
      seedItems([
        createQueueItem({ id: 'old-success', status: 'success' }),
        createQueueItem({ id: 'pending-1', status: 'pending' }),
        createQueueItem({ id: 'new-error', status: 'error' }),
        createQueueItem({ id: 'uploading-1', status: 'uploading' }),
      ]);

      manager.trimQueue(1);

      expect(manager.getItem('old-success')).toBeUndefined();
      expect(manager.getItem('new-error')).toBeDefined();
      expect(manager.getItem('pending-1')).toBeDefined();
      expect(manager.getItem('uploading-1')).toBeDefined();
    });

    it('被裁掉的项会清理其剪贴板临时文件', async () => {
      seedItems([
        createQueueItem({ id: 'clip-old', status: 'success', filePath: 'C:/Temp/clipboard_image_old.png' }),
        createQueueItem({ id: 'clip-new', status: 'success', filePath: 'C:/Temp/clipboard_image_new.png' }),
      ]);

      manager.trimQueue(1);
      await Promise.resolve();

      expect(getInvokeMock()).toHaveBeenCalledWith('cleanup_clipboard_temp_file', {
        path: 'C:/Temp/clipboard_image_old.png',
      });
      expect(getInvokeMock()).not.toHaveBeenCalledWith('cleanup_clipboard_temp_file', {
        path: 'C:/Temp/clipboard_image_new.png',
      });
    });
  });

  describe('队列基础操作', () => {
    it('getQueueSize 反映当前队列长度', () => {
      expect(manager.getQueueSize()).toBe(0);

      manager.addFile('/img/a.png', 'a.png', ['weibo']);
      manager.addFile('/img/b.png', 'b.png', ['weibo']);

      expect(manager.getQueueSize()).toBe(2);
    });

    it('getItem 对不存在的 id 返回 undefined', () => {
      expect(manager.getItem('ghost')).toBeUndefined();
    });

    it('updateItem 对 serviceProgress 做深度合并而非整体替换', () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo', 'r2'])!;

      manager.updateItem(id, {
        serviceProgress: { weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK }) },
      });

      const item = manager.getItem(id)!;
      expect(item.serviceProgress.weibo!.link).toBe(WEIBO_LINK);
      expect(item.serviceProgress.r2).toMatchObject({
        progress: 0,
        status: QUEUE_SERVICE_STATUS.waiting,
      });
    });

    it('updateItemThrottled 的更新要等到下一帧才落地', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.updateItemThrottled(id, { weiboProgress: 70 });
      expect(manager.getItem(id)!.weiboProgress).toBe(0);

      await flushRaf();
      expect(manager.getItem(id)!.weiboProgress).toBe(70);
    });

    it('updateItemThrottled 合并同一帧内的多次更新', async () => {
      const id = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;

      manager.updateItemThrottled(id, { weiboProgress: 10 });
      manager.updateItemThrottled(id, { weiboProgress: 60 });
      manager.updateItemThrottled(id, { weiboStatus: '60%' });
      await flushRaf();

      const item = manager.getItem(id)!;
      expect(item.weiboProgress).toBe(60);
      expect(item.weiboStatus).toBe('60%');
    });

    it('clearQueue 清空整个队列', () => {
      manager.addFile('/img/a.png', 'a.png', ['weibo']);
      manager.addFile('/img/b.png', 'b.png', ['weibo']);

      manager.clearQueue();

      expect(manager.getQueueSize()).toBe(0);
    });

    it('setRetryCallback 保留接口兼容，调用不抛错', () => {
      const callback = vi.fn();

      expect(() => manager.setRetryCallback(callback)).not.toThrow();
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('多项并发隔离', () => {
    it('两个队列项各自的服务进度互不串扰', async () => {
      const first = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      const second = manager.addFile('/img/b.png', 'b.png', ['weibo'])!;

      manager.updateServiceProgress(first, 'weibo', 20);
      manager.updateServiceProgress(second, 'weibo', 80);
      await flushRaf();

      expect(manager.getItem(first)!.serviceProgress.weibo!.progress).toBe(20);
      expect(manager.getItem(second)!.serviceProgress.weibo!.progress).toBe(80);
    });

    it('一个项失败不影响另一个项收口成功', () => {
      const failing = manager.addFile('/img/a.png', 'a.png', ['weibo'])!;
      const succeeding = manager.addFile('/img/b.png', 'b.png', ['weibo'])!;
      manager.updateItem(succeeding, {
        serviceProgress: { weibo: createUploadedServiceProgress('weibo', { link: WEIBO_LINK }) },
      });

      manager.markItemFailed(failing, 'boom');
      manager.markItemComplete(succeeding, WEIBO_LINK);

      expect(manager.getItem(failing)!.status).toBe('error');
      expect(manager.getItem(succeeding)!.status).toBe('success');
      expect(manager.getItem(succeeding)!.serviceProgress.weibo!.status).toBe(QUEUE_SERVICE_STATUS.done);
    });
  });
});
