import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed, defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useRescueScanHeader } from '@/composables/md-rescue/useRescueScanHeader';

function makeHarness(args: {
  phase?: 'idle' | 'scanning' | 'fixing' | 'done';
  scanStage?: 'checking' | 'backups' | 'complete' | 'cancelling' | 'cancelled';
  isCollecting?: boolean;
  collectProgress?: { scannedFiles: number; processedFiles: number; foundLinks: number; currentFile?: string } | null;
  scanProgress?: { checked: number; total: number } | null;
  bottomStats?: { totalImages: number; normalFileCount: number; checkedCount: number };
  onCancelCollect?: () => void;
  onCancelScan?: () => void;
}) {
  const phase = ref(args.phase ?? 'idle');
  const scanStage = ref(args.scanStage ?? 'checking');
  const isCollecting = ref(args.isCollecting ?? false);
  const collectProgress = ref(args.collectProgress ?? null);
  const scanProgress = ref(args.scanProgress ?? null);
  const bottomStats = computed(() => args.bottomStats ?? { totalImages: 0, normalFileCount: 0, checkedCount: 0 });
  const onCancelCollect = args.onCancelCollect ?? vi.fn();
  const onCancelScan = args.onCancelScan ?? vi.fn();

  let api: ReturnType<typeof useRescueScanHeader> | null = null;

  const Harness = defineComponent({
    setup() {
      api = useRescueScanHeader({
        phase, scanStage, isCollecting, collectProgress, scanProgress, bottomStats,
        onCancelCollect, onCancelScan,
      });
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  return { wrapper, api: () => api!, refs: { phase, scanStage, isCollecting, collectProgress, scanProgress }, spies: { onCancelCollect, onCancelScan } };
}

describe('useRescueScanHeader', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('scanPercent 按 scanProgress 计算', () => {
    const h = makeHarness({ scanProgress: { checked: 30, total: 100 } });
    expect(h.api().scanPercent.value).toBe(30);
  });

  it('scanProgress 为 null 或 total=0 时返回 0', () => {
    const a = makeHarness({ scanProgress: null });
    expect(a.api().scanPercent.value).toBe(0);
    const b = makeHarness({ scanProgress: { checked: 5, total: 0 } });
    expect(b.api().scanPercent.value).toBe(0);
  });

  it('canCancelScan - isCollecting 时为 true', () => {
    const h = makeHarness({ isCollecting: true });
    expect(h.api().canCancelScan.value).toBe(true);
  });

  it('canCancelScan - scanning + checking/backups/cancelling 时为 true', () => {
    const h = makeHarness({ phase: 'scanning', scanStage: 'checking' });
    expect(h.api().canCancelScan.value).toBe(true);
    h.refs.scanStage.value = 'backups';
    expect(h.api().canCancelScan.value).toBe(true);
    h.refs.scanStage.value = 'cancelling';
    expect(h.api().canCancelScan.value).toBe(true);
    h.refs.scanStage.value = 'complete';
    expect(h.api().canCancelScan.value).toBe(false);
  });

  it('isCancelling 仅在 scanning + cancelling 时为 true', () => {
    const a = makeHarness({ phase: 'scanning', scanStage: 'cancelling' });
    expect(a.api().isCancelling.value).toBe(true);
    const b = makeHarness({ phase: 'scanning', scanStage: 'checking' });
    expect(b.api().isCancelling.value).toBe(false);
  });

  it('emptyIcon/Title/Desc - complete', () => {
    const h = makeHarness({ scanStage: 'complete' });
    expect(h.api().emptyIcon.value).toBe('pi pi-check-circle');
    expect(h.api().emptyTitle.value).toBe('没有问题链接');
    expect(h.api().emptyDesc.value).toBe('所有图片链接正常');
  });

  it('emptyIcon/Title/Desc - cancelled', () => {
    const h = makeHarness({ scanStage: 'cancelled' });
    expect(h.api().emptyIcon.value).toBe('pi pi-info-circle');
    expect(h.api().emptyTitle.value).toBe('已取消扫描');
    expect(h.api().emptyDesc.value).toBe('当前未发现问题');
  });

  it('emptyIcon/Title/Desc - collecting 有进度', () => {
    const h = makeHarness({
      isCollecting: true,
      collectProgress: { scannedFiles: 12, processedFiles: 0, foundLinks: 3 },
    });
    expect(h.api().emptyIcon.value).toBe('');
    expect(h.api().emptyTitle.value).toBe('正在检测');
    expect(h.api().emptyDesc.value).toBe('正在扫描文件列表 · 已找到 12 个');
  });

  it('emptyDesc - 有 normalFileCount', () => {
    const h = makeHarness({
      bottomStats: { normalFileCount: 5, checkedCount: 20, totalImages: 50 },
    });
    expect(h.api().emptyDesc.value).toBe('已扫 5 个文件 · 检测 20 / 50 图片');
  });

  it('emptyDesc - 默认文案', () => {
    const h = makeHarness({});
    expect(h.api().emptyDesc.value).toBe('正在扫描文件...');
  });

  it('handleCancelScan - collecting 时调用 onCancelCollect', () => {
    const h = makeHarness({ isCollecting: true });
    h.api().handleCancelScan();
    expect(h.spies.onCancelCollect).toHaveBeenCalled();
    expect(h.spies.onCancelScan).not.toHaveBeenCalled();
  });

  it('handleCancelScan - 非 collecting 时调用 onCancelScan', () => {
    const h = makeHarness({ isCollecting: false });
    h.api().handleCancelScan();
    expect(h.spies.onCancelScan).toHaveBeenCalled();
    expect(h.spies.onCancelCollect).not.toHaveBeenCalled();
  });

  it('triggerScanFinishing(complete) 设置 scanFinishing=true，定时后复位', async () => {
    vi.useFakeTimers();
    const h = makeHarness({});
    h.api().triggerScanFinishing('complete');
    expect(h.api().scanFinishing.value).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(h.api().scanFinishing.value).toBe(false);
  });

  it('triggerScanFinishing(cancelled) 使用更长停留时间', async () => {
    vi.useFakeTimers();
    const h = makeHarness({});
    h.api().triggerScanFinishing('cancelled');
    vi.advanceTimersByTime(1999);
    expect(h.api().scanFinishing.value).toBe(true);
    vi.advanceTimersByTime(10);
    expect(h.api().scanFinishing.value).toBe(false);
  });

  it('重复 triggerScanFinishing 会清掉之前的 timer', async () => {
    vi.useFakeTimers();
    const h = makeHarness({});
    h.api().triggerScanFinishing('complete');
    vi.advanceTimersByTime(1000);
    h.api().triggerScanFinishing('cancelled');
    vi.advanceTimersByTime(1500);
    expect(h.api().scanFinishing.value).toBe(true); // 2000ms 还没到
    vi.advanceTimersByTime(600);
    expect(h.api().scanFinishing.value).toBe(false);
  });

  it('组件卸载时清理 timer', async () => {
    vi.useFakeTimers();
    const h = makeHarness({});
    h.api().triggerScanFinishing('complete');
    h.wrapper.unmount();
    vi.advanceTimersByTime(3000);
    // 没抛错就算通过
    await nextTick();
  });
});
