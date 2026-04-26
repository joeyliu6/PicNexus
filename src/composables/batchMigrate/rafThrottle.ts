/**
 * 批量迁移 · RAF 节流刷新器
 *
 * 高频迁移完成事件（每秒数十次）走 requestAnimationFrame 合并，
 * 避免 25k+ 列表场景下每完成一项就 splat 一次响应式数组、卡爆 UI。
 *
 * 内部基于通用 `createRafScheduler`，只负责"批量迁移特有的状态推送"逻辑：
 * - 把当前批次状态拷给 `itemStatuses`
 * - 重新引用 `allItemStatuses` 让 prop 边界感知到批内状态流转
 * - 写入 `globalProgress`（current/total/percent）
 */
import type { Ref, ShallowRef } from 'vue';
import type { MigrateItemStatus } from '../../types/batchMigrate';
import { createRafScheduler } from '../../utils/rafScheduler';

export interface RafThrottleDeps {
  itemStatuses: ShallowRef<MigrateItemStatus[]>;
  allItemStatuses: ShallowRef<MigrateItemStatus[]>;
  globalProgress: Ref<{ current: number; total: number; percent: number }>;
}

export function createRafThrottle(deps: RafThrottleDeps) {
  const { itemStatuses, allItemStatuses, globalProgress } = deps;
  const scheduler = createRafScheduler();

  let pendingStatuses: MigrateItemStatus[] | null = null;
  let pendingProcessed = 0;
  let pendingTotal = 0;

  function applyPending(): void {
    if (!pendingStatuses) return;
    itemStatuses.value = [...pendingStatuses];
    // 当前批次对象是 allItemStatuses 头部的共享引用——外层 shallowRef 需要新数组引用来触发响应性，
    // 否则 MigrateProgressPhase 读 allItemStatuses 时看不到批内状态流转
    allItemStatuses.value = [...allItemStatuses.value];
    // clamp ≤ 100：preload 完成前 total 是上界估计，processed 极端情况下可能短暂超过它
    const percent = pendingTotal > 0 ? Math.min(100, Math.round((pendingProcessed / pendingTotal) * 100)) : 0;
    globalProgress.value = { current: pendingProcessed, total: pendingTotal, percent };
    pendingStatuses = null;
  }

  function scheduleStatusUpdate(statuses: MigrateItemStatus[], processed: number, total: number): void {
    pendingStatuses = statuses;
    pendingProcessed = processed;
    pendingTotal = total;
    scheduler.schedule(applyPending);
  }

  function flushStatusUpdate(): void {
    scheduler.flush();
    applyPending();
  }

  return { scheduleStatusUpdate, flushStatusUpdate };
}
