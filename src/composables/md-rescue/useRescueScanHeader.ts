// MdRescueInline 顶栏 / 占位 / 完成停留状态聚合
// 抽离自 MdRescueInline.vue，让主组件保持单一关注点（模板编排）

import { ref, computed, onBeforeUnmount, type Ref, type ComputedRef } from 'vue';
import { formatTimeRemaining } from '../useLinkStatusDisplay';
import type { RescuePhase, FileHealth } from './shared';

type ScanStage = 'checking' | 'backups' | 'complete' | 'cancelling' | 'cancelled';
type CollectProgress = { scannedFiles: number; processedFiles: number; foundLinks: number; currentFile?: string } | null;
type ScanProgress = { checked: number; total: number } | null;
type BottomStats = { totalFiles: number; totalImages: number; normalFileCount: number };

interface UseRescueScanHeaderArgs {
  phase: Ref<RescuePhase>;
  scanStage: Ref<ScanStage>;
  isCollecting: Ref<boolean>;
  collectProgress: Ref<CollectProgress>;
  scanProgress: Ref<ScanProgress>;
  bottomStats: ComputedRef<BottomStats>;
  estimatedTimeRemaining: ComputedRef<number | null> | Ref<number | null>;
  currentScanFileName: ComputedRef<string>;
  readyBrokenFiles: ComputedRef<FileHealth[]>;
  onCancelCollect: () => void;
  onCancelScan: () => void;
}

const SCAN_FINISH_LINGER_MS = { complete: 1500, cancelled: 2000 } as const;

export function useRescueScanHeader(args: UseRescueScanHeaderArgs) {
  const scanFinishing = ref(false);
  let scanFinishTimer: ReturnType<typeof setTimeout> | null = null;

  const scanHeaderTitle = computed(() => {
    const stg = args.scanStage.value;
    const cp = args.collectProgress.value;
    const sp = args.scanProgress.value;
    if (scanFinishing.value) return stg === 'cancelled' ? '已取消扫描' : '扫描完成';
    if (args.isCollecting.value) {
      if (cp && cp.processedFiles > 0) return `正在读取文件 · ${cp.processedFiles} / ${cp.scannedFiles}`;
      if (cp && cp.scannedFiles > 0) return `正在扫描文件列表 · 已找到 ${cp.scannedFiles} 个文件`;
      return '正在扫描文件列表...';
    }
    if (stg === 'cancelling') return '正在取消扫描...';
    if (stg === 'backups') return '正在验证备用链接...';
    if (sp && sp.total > 0) return `正在扫描图片 · ${sp.checked} / ${sp.total}`;
    return '正在扫描图片...';
  });

  const scanHeaderSubtitle = computed(() => {
    const stg = args.scanStage.value;
    const cp = args.collectProgress.value;
    const sp = args.scanProgress.value;
    const bs = args.bottomStats.value;
    if (scanFinishing.value && stg === 'cancelled' && sp) return `已检测 ${sp.checked} / ${sp.total} 张图片`;
    if (scanFinishing.value) return `${bs.totalFiles} 文件 · ${bs.totalImages} 图片`;
    if (args.isCollecting.value && cp && cp.foundLinks > 0) return `已找到 ${cp.foundLinks} 张图片`;
    if (stg === 'checking' && args.estimatedTimeRemaining.value !== null) return `预计剩余 ${formatTimeRemaining(args.estimatedTimeRemaining.value)}`;
    if (stg === 'checking' && args.currentScanFileName.value) return args.currentScanFileName.value;
    return '';
  });

  const scanHeaderIconClass = computed(() => {
    if (scanFinishing.value && args.scanStage.value === 'cancelled') return 'pi pi-info-circle wk-scan-icon--warn';
    if (scanFinishing.value) return 'pi pi-check-circle wk-scan-icon--done';
    return 'pi pi-spin pi-spinner';
  });

  const canCancelScan = computed(() =>
    (args.isCollecting.value && !scanFinishing.value)
    || (args.phase.value === 'scanning' && ['checking', 'backups'].includes(args.scanStage.value)));

  const scanPercent = computed(() => {
    const p = args.scanProgress.value;
    if (!p || p.total === 0) return 0;
    return Math.round((p.checked / p.total) * 100);
  });

  const showScanPlaceholder = computed(() =>
    args.phase.value === 'scanning' && args.readyBrokenFiles.value.length === 0);

  const scanPlaceholderTitle = computed(() => {
    const stg = args.scanStage.value;
    const n = args.bottomStats.value.normalFileCount;
    if (stg === 'cancelled') return '已取消扫描 · 当前未发现问题';
    if (stg === 'complete') return '所有图片链接正常';
    return n > 0 ? `已扫 ${n} 个文件，均正常` : '正在检测...';
  });

  const scanPlaceholderHint = computed(() =>
    ['complete', 'cancelled'].includes(args.scanStage.value) ? '' : '继续检测中...');

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
    scanHeaderTitle,
    scanHeaderSubtitle,
    scanHeaderIconClass,
    canCancelScan,
    scanPercent,
    showScanPlaceholder,
    scanPlaceholderTitle,
    scanPlaceholderHint,
    handleCancelScan,
    triggerScanFinishing,
  };
}
