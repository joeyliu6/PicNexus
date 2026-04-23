import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  __resetServiceCheckRunnerForTests,
  buildServiceCheckSummarySnapshot,
  useServiceCheckRunner,
} from '../../../composables/useServiceCheckRunner';
import type { ServiceHealthStatus } from '../../../types/serviceHealth';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useServiceCheckRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetServiceCheckRunnerForTests();
  });

  afterEach(() => {
    __resetServiceCheckRunnerForTests();
    vi.useRealTimers();
  });

  it('批量检测会按 settle 顺序逐步回填，不等待慢服务完成', async () => {
    const runner = useServiceCheckRunner();
    const statuses: Record<string, ServiceHealthStatus> = {
      weibo: 'pending',
      jd: 'pending',
      qiyu: 'pending',
    };

    const weiboTask = deferred();
    const jdTask = deferred();
    const qiyuTask = deferred();

    const runPromise = runner.runServiceChecks({
      mode: 'batch',
      tasks: [
        {
          serviceId: 'weibo',
          label: '微博',
          run: async () => {
            await weiboTask.promise;
            statuses.weibo = 'verified';
          },
        },
        {
          serviceId: 'jd',
          label: '京东图床',
          run: async () => {
            await jdTask.promise;
            statuses.jd = 'verified';
          },
        },
        {
          serviceId: 'qiyu',
          label: '七鱼图床',
          run: async () => {
            await qiyuTask.promise;
            statuses.qiyu = 'error';
          },
        },
      ],
      baselineStatuses: {
        weibo: 'pending',
        jd: 'pending',
        qiyu: 'pending',
      },
      summarySnapshot: buildServiceCheckSummarySnapshot(statuses),
      resolveStatus: (serviceId) => statuses[serviceId],
    });

    await nextTick();
    expect(runner.activeSession.value?.runningIds).toEqual(['weibo', 'jd', 'qiyu']);
    expect(runner.batchTestProgress.value?.current).toBe(0);
    expect([...runner.visibleRefreshingServiceIds.value].sort()).toEqual(['jd', 'qiyu', 'weibo']);

    weiboTask.resolve();
    await Promise.resolve();
    await nextTick();
    expect(runner.batchTestProgress.value?.current).toBe(1);
    expect(runner.activeSession.value?.completedIds).toContain('weibo');
    expect(runner.activeSession.value?.resultStatuses.weibo).toBe('verified');
    expect(runner.activeSession.value?.completedIds).not.toContain('qiyu');
    expect(runner.visibleRefreshingServiceIds.value.has('weibo')).toBe(false);
    expect(runner.visibleRefreshingServiceIds.value.has('jd')).toBe(true);
    expect(runner.visibleRefreshingServiceIds.value.has('qiyu')).toBe(true);

    jdTask.resolve();
    await Promise.resolve();
    await nextTick();
    expect(runner.batchTestProgress.value?.current).toBe(2);
    expect(runner.activeSession.value?.resultStatuses.jd).toBe('verified');
    expect(runner.visibleRefreshingServiceIds.value.has('jd')).toBe(false);
    expect(runner.visibleRefreshingServiceIds.value.has('qiyu')).toBe(true);

    qiyuTask.resolve();
    await Promise.resolve();
    await nextTick();
    expect(runner.batchTestProgress.value?.current).toBe(3);
    expect(runner.activeSession.value?.resultStatuses.qiyu).toBe('error');
    expect(runner.visibleRefreshingServiceIds.value.size).toBe(0);

    await runPromise;
    expect(runner.activeSession.value).toBeNull();
  });

  it('取消批量检测后不会再启动排队中的新任务', async () => {
    const runner = useServiceCheckRunner();
    const statuses: Record<string, ServiceHealthStatus> = {
      s1: 'pending',
      s2: 'pending',
      s3: 'pending',
      s4: 'pending',
    };

    const blockers = {
      s1: deferred(),
      s2: deferred(),
      s3: deferred(),
    };
    const started: string[] = [];

    const runPromise = runner.runServiceChecks({
      mode: 'batch',
      tasks: [
        {
          serviceId: 's1',
          label: 'S1',
          run: async () => {
            started.push('s1');
            await blockers.s1.promise;
            statuses.s1 = 'verified';
          },
        },
        {
          serviceId: 's2',
          label: 'S2',
          run: async () => {
            started.push('s2');
            await blockers.s2.promise;
            statuses.s2 = 'verified';
          },
        },
        {
          serviceId: 's3',
          label: 'S3',
          run: async () => {
            started.push('s3');
            await blockers.s3.promise;
            statuses.s3 = 'verified';
          },
        },
        {
          serviceId: 's4',
          label: 'S4',
          run: async () => {
            started.push('s4');
            statuses.s4 = 'verified';
          },
        },
      ],
      baselineStatuses: {
        s1: 'pending',
        s2: 'pending',
        s3: 'pending',
        s4: 'pending',
      },
      summarySnapshot: buildServiceCheckSummarySnapshot(statuses),
      resolveStatus: (serviceId) => statuses[serviceId],
    });

    await nextTick();
    expect(started).toEqual(['s1', 's2', 's3']);

    runner.cancelBatchTest();
    await nextTick();

    blockers.s1.resolve();
    blockers.s2.resolve();
    blockers.s3.resolve();
    await nextTick();
    await runPromise;

    expect(started).toEqual(['s1', 's2', 's3']);
  });
});
