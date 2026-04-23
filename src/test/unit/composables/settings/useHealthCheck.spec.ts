import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useHealthCheck } from '../../../../composables/settings/useHealthCheck';
import type { BatchTestProgress } from '../../../../types/batchTest';

function harness(initial: {
  isBatchTesting?: boolean;
  progress?: BatchTestProgress | null;
  testing?: Record<string, boolean>;
}) {
  const isBatchTesting = ref(initial.isBatchTesting ?? false);
  const batchTestProgress = ref<BatchTestProgress | null>(initial.progress ?? null);
  const testingConnections = ref<Record<string, boolean>>({ ...(initial.testing ?? {}) });
  let api: ReturnType<typeof useHealthCheck> | null = null;

  const Harness = defineComponent({
    setup() {
      api = useHealthCheck({ isBatchTesting, batchTestProgress, testingConnections });
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  return { wrapper, api: () => api!, refs: { isBatchTesting, batchTestProgress, testingConnections } };
}

describe('useHealthCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('progressPercent - null 或 total=0 时为 0', () => {
    const a = harness({ progress: null });
    expect(a.api().progressPercent.value).toBe(0);
    const b = harness({ progress: { total: 0, current: 5, completed: [], failed: [] } as any });
    expect(b.api().progressPercent.value).toBe(0);
  });

  it('progressPercent 四舍五入', () => {
    const h = harness({ progress: { total: 3, current: 1, completed: [], failed: [] } as any });
    expect(h.api().progressPercent.value).toBe(33);
  });

  it('ringOffset 随百分比线性变化', () => {
    const h = harness({ progress: { total: 100, current: 50, completed: [], failed: [] } as any });
    expect(h.api().ringOffset.value).toBeCloseTo(56.55 * 0.5, 2);
  });

  it('ringLabel - 非 testing 时为"重新检测"', () => {
    const h = harness({ isBatchTesting: false });
    expect(h.api().ringLabel.value).toBe('重新检测');
  });

  it('ringLabel - testing + 未满为"正在检测"', () => {
    const h = harness({
      isBatchTesting: true,
      progress: { total: 10, current: 3, completed: [], failed: [] } as any,
    });
    expect(h.api().ringLabel.value).toBe('正在检测');
  });

  it('ringLabel - 100% 且 testing 时触发 isShowingCompleted', async () => {
    const h = harness({ isBatchTesting: true });
    h.refs.batchTestProgress.value = { total: 10, current: 10, completed: [], failed: [] } as any;
    await nextTick();
    expect(h.api().isShowingCompleted.value).toBe(true);
    expect(h.api().ringLabel.value).toBe('检测完成');
    vi.advanceTimersByTime(3000);
    expect(h.api().isShowingCompleted.value).toBe(false);
  });

  it('isStalled - testing 过程中超过 1500ms 无进度变化', async () => {
    const h = harness({
      isBatchTesting: true,
      progress: { total: 10, current: 1, completed: [], failed: [] } as any,
    });
    await nextTick();
    // 触发 progress 变化 → 重置 stall timer
    h.refs.batchTestProgress.value = { total: 10, current: 2, completed: [], failed: [] } as any;
    await nextTick();
    expect(h.api().isStalled.value).toBe(false);
    vi.advanceTimersByTime(1600);
    expect(h.api().isStalled.value).toBe(true);
  });

  it('停止 testing 后 isStalled 复位', async () => {
    const h = harness({
      isBatchTesting: true,
      progress: { total: 10, current: 1, completed: [], failed: [] } as any,
    });
    h.refs.batchTestProgress.value = { total: 10, current: 2, completed: [], failed: [] } as any;
    await nextTick();
    vi.advanceTimersByTime(1600);
    expect(h.api().isStalled.value).toBe(true);
    h.refs.isBatchTesting.value = false;
    await nextTick();
    expect(h.api().isStalled.value).toBe(false);
  });

  it('开始 testing 时清空已完成集合', async () => {
    const h = harness({ isBatchTesting: false });
    h.api().batchTestedServices.value.add('weibo');
    h.refs.isBatchTesting.value = true;
    await nextTick();
    expect(h.api().batchTestedServices.value.size).toBe(0);
  });

  it('单服务完成 → batchDoneServices 短暂持有然后移除', async () => {
    const h = harness({ isBatchTesting: true });
    // 先让 watcher 记录 weibo: true
    h.refs.testingConnections.value = { weibo: true };
    await nextTick();
    // 再切换为 false → 判定完成
    h.refs.testingConnections.value = { weibo: false };
    await nextTick();
    expect(h.api().batchTestedServices.value.has('weibo')).toBe(true);
    expect(h.api().batchDoneServices.value.has('weibo')).toBe(true);
    vi.advanceTimersByTime(700);
    await nextTick();
    expect(h.api().batchDoneServices.value.has('weibo')).toBe(false);
    // tested 仍保留
    expect(h.api().batchTestedServices.value.has('weibo')).toBe(true);
  });

  it('非 testing 状态下 testingConnections 变化不触发完成追踪', async () => {
    const h = harness({ isBatchTesting: false, testing: { weibo: true } });
    h.refs.testingConnections.value = { weibo: false };
    await nextTick();
    expect(h.api().batchTestedServices.value.size).toBe(0);
  });

  it('重复完成同一服务时旧 timer 被清理', async () => {
    const h = harness({ isBatchTesting: true });
    h.refs.testingConnections.value = { weibo: true };
    await nextTick();
    h.refs.testingConnections.value = { weibo: false };
    await nextTick();
    h.refs.testingConnections.value = { weibo: true };
    await nextTick();
    h.refs.testingConnections.value = { weibo: false };
    await nextTick();
    vi.advanceTimersByTime(700);
    await nextTick();
    expect(h.api().batchDoneServices.value.has('weibo')).toBe(false);
  });

  it('卸载时清理所有 timer', () => {
    const h = harness({ isBatchTesting: true, testing: { weibo: true } });
    h.refs.testingConnections.value = { weibo: false };
    h.wrapper.unmount();
    vi.advanceTimersByTime(5000);
    // 没有抛错就 ok
  });
});
