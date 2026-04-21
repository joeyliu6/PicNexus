/**
 * 批量迁移「正在处理」UI 槽位机制
 *
 * 解耦 UI 显示节奏与数据层真实节奏，解决三个视觉故障：
 * 1. 单卡 <100ms 闪过看不清（用 MIN_STAY_MS 兜底停留）
 * 2. 批次边界空窗骨架屏抽搐（complete 槽位保留快照，直到被新条目抢占）
 * 3. 完成瞬间消失没有成就感（MAX_STAY_MS 内展示完成态收尾动画）
 *
 * 设计详见 docs/flows/batch-migrate-flow.md 图 6。
 */

import { ref, computed, watch, onBeforeUnmount, type Ref, type ComputedRef } from 'vue';
import type { MigrateItemStatus, MigratePhase } from '../../types/batchMigrate';

/**
 * 最小停留：单张卡吸附后至少展示 800ms，避免小图快图床场景下卡片闪过看不清。
 * 与 styles/motion.css 的 --duration-spinner 对齐（800ms），修改时两侧同步。
 */
const MIN_STAY_MS = 800;
/**
 * 最大停留：槽位转入 complete 后展示最长 1500ms，之后标记为 stale（可被新条目抢占，
 * 但若没有新条目也继续保留最后快照，避免批次边界空窗）。
 * 与 styles/motion.css 的 --duration-shimmer 对齐（1500ms），修改时两侧同步。
 */
const MAX_STAY_MS = 1500;
/** tick 周期：200ms 足以让 stale 升级及时，又不会烧 CPU */
const TICK_INTERVAL_MS = 200;

const SLOT_COUNT = 2;

export type SlotState = 'idle' | 'active' | 'complete';

export interface SlotView {
  /** 固定槽位索引（0 或 1），作为 Vue 渲染 key */
  id: number;
  state: SlotState;
  /** complete 态也保留 item 引用，由模板根据 state 切换视觉 */
  item: MigrateItemStatus | null;
  /** 进入 active 的时刻（performance.now()） */
  enterAt: number;
  /** 进入 complete 的时刻；idle/active 态为 null */
  completeAt: number | null;
  /** stale 表示 complete 超过 MAX_STAY_MS，优先被新条目抢占；但不立即清空 */
  priority: 'fresh' | 'stale';
}

function mkIdle(id: number): SlotView {
  return { id, state: 'idle', item: null, enterAt: 0, completeAt: null, priority: 'fresh' };
}

function isActiveStatus(s: MigrateItemStatus['status']): boolean {
  return s === 'downloading' || s === 'converting' || s === 'uploading';
}

function isTerminalStatus(s: MigrateItemStatus['status']): boolean {
  return s === 'success' || s === 'failed' || s === 'skipped';
}

export function useActiveSlots(
  itemStatuses: Ref<MigrateItemStatus[]>,
  phase: Ref<MigratePhase>,
): {
  slots: Ref<SlotView[]>;
  hasAnyActive: ComputedRef<boolean>;
  reset: () => void;
} {
  const slots = ref<SlotView[]>(
    Array.from({ length: SLOT_COUNT }, (_, i) => mkIdle(i)),
  );

  /** 等待入槽的 historyId（MAX_CONCURRENT=2 下几乎不会排队，保底兜住异常情况） */
  const queue: string[] = [];
  /** 已被某槽吸附的 historyId，防止同一条目被重复吸附到多个槽 */
  const seenActiveIds = new Set<string>();

  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const hasAnyActive = computed(() =>
    slots.value.some(s => s.state !== 'idle' && s.item !== null),
  );

  /**
   * 将新 active 条目吸附进槽位。
   * 优先级：idle > complete 且已过 MIN_STAY_MS（其中 stale 优先于 fresh，completeAt 更早的优先于更晚的）
   * 都不满足 → 入队等待
   */
  function adoptIntoSlot(item: MigrateItemStatus): boolean {
    const now = performance.now();
    const idleSlot = slots.value.find(s => s.state === 'idle');
    if (idleSlot) {
      idleSlot.state = 'active';
      idleSlot.item = item;
      idleSlot.enterAt = now;
      idleSlot.completeAt = null;
      idleSlot.priority = 'fresh';
      seenActiveIds.add(item.historyId);
      return true;
    }
    const evictable = slots.value
      .filter(s => s.state === 'complete' && s.completeAt !== null && now - s.completeAt >= MIN_STAY_MS)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'stale' ? -1 : 1;
        return (a.completeAt ?? 0) - (b.completeAt ?? 0);
      });
    if (evictable.length > 0) {
      const slot = evictable[0];
      if (slot.item) seenActiveIds.delete(slot.item.historyId);
      slot.state = 'active';
      slot.item = item;
      slot.enterAt = now;
      slot.completeAt = null;
      slot.priority = 'fresh';
      seenActiveIds.add(item.historyId);
      return true;
    }
    if (!queue.includes(item.historyId)) queue.push(item.historyId);
    return false;
  }

  /** 槽位对应 item 进入终态 → 切 complete，保留 item 引用继续显示 */
  function completeSlot(slot: SlotView): void {
    slot.state = 'complete';
    slot.completeAt = performance.now();
    slot.priority = 'fresh';
    if (slot.item) seenActiveIds.delete(slot.item.historyId);
    drainQueue();
  }

  /** 队列消费：复查 itemStatuses 中排队的 id 是否还 active，是就走 adoptIntoSlot */
  function drainQueue(): void {
    if (queue.length === 0) return;
    const list = itemStatuses.value;
    while (queue.length > 0) {
      const id = queue[0];
      const hit = list.find(s => s.historyId === id);
      if (!hit) {
        queue.shift();
        continue;
      }
      if (!isActiveStatus(hit.status)) {
        queue.shift();
        continue;
      }
      const adopted = adoptIntoSlot(hit);
      if (!adopted) break;
      queue.shift();
    }
  }

  function syncFromItemStatuses(): void {
    const list = itemStatuses.value;
    const idToStatus = new Map<string, MigrateItemStatus>();
    for (const s of list) idToStatus.set(s.historyId, s);

    // 1. 已被槽持有的 id：刷新引用 / 检测终态 / 批次换页找不到则保留快照不动
    for (const slot of slots.value) {
      if (!slot.item) continue;
      const fresh = idToStatus.get(slot.item.historyId);
      if (!fresh) continue;
      slot.item = fresh;
      if (slot.state === 'active' && isTerminalStatus(fresh.status)) {
        completeSlot(slot);
      }
    }

    // 2. 新 active 条目：尚未被任何槽吸附 → adopt
    for (const item of list) {
      if (!isActiveStatus(item.status)) continue;
      if (seenActiveIds.has(item.historyId)) continue;
      adoptIntoSlot(item);
    }
  }

  function tick(): void {
    if (typeof document !== 'undefined' && document.hidden) return;
    const now = performance.now();
    for (const slot of slots.value) {
      if (slot.state === 'complete' && slot.completeAt !== null
          && slot.priority === 'fresh' && now - slot.completeAt >= MAX_STAY_MS) {
        slot.priority = 'stale';
      }
    }
    drainQueue();
  }

  function startTick(): void {
    if (tickTimer !== null) return;
    tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  }

  function stopTick(): void {
    if (tickTimer === null) return;
    clearInterval(tickTimer);
    tickTimer = null;
  }

  function reset(): void {
    slots.value = Array.from({ length: SLOT_COUNT }, (_, i) => mkIdle(i));
    queue.length = 0;
    seenActiveIds.clear();
  }

  watch(itemStatuses, () => { syncFromItemStatuses(); }, { deep: true, flush: 'post' });

  watch(phase, (newPhase, oldPhase) => {
    if (newPhase === 'migrating') {
      startTick();
    } else {
      stopTick();
      if (oldPhase === 'migrating') reset();
    }
  }, { immediate: true });

  onBeforeUnmount(() => {
    stopTick();
  });

  return { slots, hasAnyActive, reset };
}
