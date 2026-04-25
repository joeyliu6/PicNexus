/**
 * 批量迁移 · RAF 节流刷新器
 *
 * 高频迁移完成事件（每秒数十次）走 requestAnimationFrame 合并，
 * 避免 25k+ 列表场景下每完成一项就 splat 一次响应式数组、卡爆 UI。
 *
 * 抽出来单独放是为了：
 * - useBatchMigrate.ts 主管理器更聚焦于业务流程
 * - 两套闭包变量（rafPending / pendingStatuses…）有自己的命名空间，不再污染外层 composable
 */
import type { Ref, ShallowRef } from 'vue';
import type { MigrateItemStatus } from '../../types/batchMigrate';

export interface RafThrottleDeps {
  itemStatuses: ShallowRef<MigrateItemStatus[]>;
  allItemStatuses: ShallowRef<MigrateItemStatus[]>;
  globalProgress: Ref<{ current: number; total: number; percent: number }>;
}

export function createRafThrottle(deps: RafThrottleDeps) {
  const { itemStatuses, allItemStatuses, globalProgress } = deps;

  let rafPending = false;
  let pendingStatuses: MigrateItemStatus[] | null = null;
  let pendingProcessed = 0;
  let pendingTotal = 0;

  function updateStatusDisplay(statuses: MigrateItemStatus[], processed: number, total: number): void {
    itemStatuses.value = [...statuses];
    // 当前批次对象是 allItemStatuses 头部的共享引用——外层 shallowRef 需要新数组引用来触发响应性，
    // 否则 MigrateProgressPhase 读 allItemStatuses 时看不到批内状态流转
    allItemStatuses.value = [...allItemStatuses.value];
    // clamp ≤ 100：preload 完成前 total 是上界估计，processed 极端情况下可能短暂超过它
    const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    globalProgress.value = { current: processed, total, percent };
  }

  function scheduleStatusUpdate(statuses: MigrateItemStatus[], processed: number, total: number) {
    pendingStatuses = statuses;
    pendingProcessed = processed;
    pendingTotal = total;

    // 页面不可见时 RAF 可能被跳过，直接同步更新
    if (document.hidden) {
      updateStatusDisplay(statuses, processed, total);
      rafPending = false;
      return;
    }

    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      if (pendingStatuses) {
        updateStatusDisplay(pendingStatuses, pendingProcessed, pendingTotal);
      }
      rafPending = false;
    });
  }

  function flushStatusUpdate() {
    if (pendingStatuses) {
      updateStatusDisplay(pendingStatuses, pendingProcessed, pendingTotal);
    }
    rafPending = false;
    pendingStatuses = null;
  }

  return { scheduleStatusUpdate, flushStatusUpdate };
}
