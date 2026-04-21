// MdRescueInline 扫描状态聚合：取消能力 / 进度百分比 / 完成停留态 / 空态文案
// 抽离自 MdRescueInline.vue，让主组件保持单一关注点（模板编排）

import { ref, computed, onBeforeUnmount, type Ref, type ComputedRef } from 'vue';
import type { RescuePhase } from './shared';

type ScanStage = 'checking' | 'backups' | 'complete' | 'cancelling' | 'cancelled';
type CollectProgress = { scannedFiles: number; processedFiles: number; foundLinks: number; currentFile?: string } | null;
type ScanProgress = { checked: number; total: number } | null;
type BottomStats = { totalImages: number; normalFileCount: number; checkedCount: number };

interface UseRescueScanHeaderArgs {
  phase: Ref<RescuePhase>;
  scanStage: Ref<ScanStage>;
  isCollecting: Ref<boolean>;
  collectProgress: Ref<CollectProgress>;
  scanProgress: Ref<ScanProgress>;
  bottomStats: ComputedRef<BottomStats>;
  onCancelCollect: () => void;
  onCancelScan: () => void;
}

const SCAN_FINISH_LINGER_MS = { complete: 1500, cancelled: 2000 } as const;

export function useRescueScanHeader(args: UseRescueScanHeaderArgs) {
  const scanFinishing = ref(false);
  let scanFinishTimer: ReturnType<typeof setTimeout> | null = null;

  const canCancelScan = computed(() =>
    (args.isCollecting.value && !scanFinishing.value)
    || (args.phase.value === 'scanning' && ['checking', 'backups', 'cancelling'].includes(args.scanStage.value)));

  // cancelling：已点击取消但后台仍在结束本批请求的过渡窗口，按钮保留 disabled 给视觉反馈
  const isCancelling = computed(() =>
    args.phase.value === 'scanning' && args.scanStage.value === 'cancelling',
  );

  const scanPercent = computed(() => {
    const p = args.scanProgress.value;
    if (!p || p.total === 0) return 0;
    return Math.round((p.checked / p.total) * 100);
  });

  // 内容区空态（wk-body）文案 —— 三态：进行中 / 完成正常 / 取消
  // 进行中不渲染图标（扫描状态由右上角小 spinner 承担），只展示文字进度
  const emptyIcon = computed(() => {
    if (args.scanStage.value === 'complete') return 'pi pi-check-circle';
    if (args.scanStage.value === 'cancelled') return 'pi pi-info-circle';
    return '';
  });
  const emptyTitle = computed(() => {
    if (args.scanStage.value === 'complete') return '没有问题链接';
    if (args.scanStage.value === 'cancelled') return '已取消扫描';
    return '正在检测';
  });
  const emptyDesc = computed(() => {
    const s = args.bottomStats.value;
    const cp = args.collectProgress.value;
    if (args.scanStage.value === 'complete') return '所有图片链接正常';
    if (args.scanStage.value === 'cancelled') return '当前未发现问题';
    if (args.isCollecting.value && cp && cp.scannedFiles > 0) return `正在扫描文件列表 · 已找到 ${cp.scannedFiles} 个`;
    if (s.normalFileCount > 0) return `已扫 ${s.normalFileCount} 个文件 · 检测 ${s.checkedCount} / ${s.totalImages} 图片`;
    return '正在扫描文件...';
  });

  function handleCancelScan(): void {
    if (args.isCollecting.value) args.onCancelCollect();
    else args.onCancelScan();
  }

  function clearTimer(): void {
    if (scanFinishTimer) {
      clearTimeout(scanFinishTimer);
      scanFinishTimer = null;
    }
  }

  function triggerScanFinishing(stage: 'complete' | 'cancelled'): void {
    clearTimer();
    scanFinishing.value = true;
    scanFinishTimer = setTimeout(() => {
      scanFinishing.value = false;
      scanFinishTimer = null;
    }, SCAN_FINISH_LINGER_MS[stage]);
  }

  onBeforeUnmount(clearTimer);

  return {
    scanFinishing,
    canCancelScan,
    isCancelling,
    scanPercent,
    emptyIcon,
    emptyTitle,
    emptyDesc,
    handleCancelScan,
    triggerScanFinishing,
  };
}
