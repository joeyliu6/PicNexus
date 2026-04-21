/**
 * 批量迁移「最近完成」快照队列
 *
 * 与 useActiveSlots 职责分工：
 * - useActiveSlots：固定 2 个活跃槽位 + 完成态收尾动画（跨批次延续，解决空窗抽搐）
 * - useRecentCompleted（本文件）：一条 FIFO 队列，展示最近 N 张已落定的卡片（成功/失败/跳过）
 *
 * 设计动机：MAX_CONCURRENT=2 意味着任意时刻只能看到 2 张正在处理的卡，
 * 用户视觉信息密度太低。把刚完成的条目以快照形式多保留一会儿，
 * 能直观看到"正在发生什么"，但又不与活跃槽抢占节奏。
 */

import { ref, watch, type Ref } from 'vue';
import type { MigrateItemStatus, MigratePhase } from '../../types/batchMigrate';

const MAX_RECENT = 6;

function isTerminalStatus(s: MigrateItemStatus['status']): boolean {
  return s === 'success' || s === 'failed' || s === 'skipped';
}

export function useRecentCompleted(
  itemStatuses: Ref<MigrateItemStatus[]>,
  phase: Ref<MigratePhase>,
): {
  recent: Ref<MigrateItemStatus[]>;
  reset: () => void;
} {
  const recent = ref<MigrateItemStatus[]>([]);
  /** 已入队的 historyId，避免同一条目多次追加 */
  const seenIds = new Set<string>();

  function reset(): void {
    recent.value = [];
    seenIds.clear();
  }

  watch(itemStatuses, () => {
    if (phase.value !== 'migrating') return;
    const list = itemStatuses.value;
    let changed = false;
    const next = [...recent.value];
    for (const item of list) {
      if (!isTerminalStatus(item.status)) continue;
      if (seenIds.has(item.historyId)) continue;
      seenIds.add(item.historyId);
      // 新终态条目追加到队首（最新在前）
      next.unshift({ ...item });
      changed = true;
    }
    if (!changed) return;
    if (next.length > MAX_RECENT) next.length = MAX_RECENT;
    recent.value = next;
  }, { deep: true, flush: 'post' });

  watch(phase, (newPhase, oldPhase) => {
    if (oldPhase === 'migrating' && newPhase !== 'migrating') reset();
  });

  return { recent, reset };
}
