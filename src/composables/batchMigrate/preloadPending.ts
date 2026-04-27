/**
 * 批量迁移 · 预加载模块
 *
 * 在迁移正式开始前把所有待迁移项的"身份证"（id + UI 状态）拉到内存：
 * - 首 100 条让列表立刻显示
 * - 剩余按 2000 / 块流式加载，每块之间 yieldToMain 让出主线程
 * - JS 端过滤掉对所有目标都已存在的项（避免 migrateCore 空跑）
 *
 * 只保留 id 不保留完整 HistoryItem：处理阶段按 chunk 再经 getItemsByIds 拉取，
 * 避免 25k+ 条历史场景下 HistoryItem.results 数组常驻内存（峰值几百 MB）。
 *
 * 加载期间 allItemStatuses 持续增长，UI 的「全部」计数会从 100 → N 递增，
 * 配合 MigrateStatusFilterChips 的 total 提示显示「已加载 / 总数」。
 */
import { triggerRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import type { HistoryItem } from '../../config/types';
import type { MigrateItemStatus } from '../../types/batchMigrate';
import { historyDB } from '../../services/HistoryDatabase';

/** 预加载的单条：只保留 id + MigrateItemStatus，HistoryItem 处理阶段再拉 */
export interface PreloadedItem {
  id: string;
  status: MigrateItemStatus;
}

/** 预加载首屏条数：让用户立刻看到列表 */
const PRELOAD_FIRST_CHUNK = 100;
/** 预加载流式分块大小：对齐链接检测的 2000/块 */
const PRELOAD_STREAM_CHUNK = 2000;

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface PreloadArgs {
  targets: string[];
  maxSuccessCount: number;
  sourceServiceFilter: string[];
  timestampAfter: number | null;
  allItemStatuses: ShallowRef<MigrateItemStatus[]>;
  isCancelled: Ref<boolean>;
  isPaused: Ref<boolean>;
  /** 每批预加载完成后触发，用于流水线即时处理 */
  onBatch?: (batch: PreloadedItem[]) => void;
}

export async function preloadAllPending(args: PreloadArgs): Promise<PreloadedItem[]> {
  const { targets, allItemStatuses, isCancelled, isPaused } = args;
  const items: PreloadedItem[] = [];

  const params = {
    maxSuccessCount: args.maxSuccessCount,
    hasServiceId: args.sourceServiceFilter.length > 0 ? args.sourceServiceFilter : undefined,
    timestampAfter: args.timestampAfter ?? undefined,
  };

  function makePreloaded(item: HistoryItem): PreloadedItem | null {
    const existingIds = new Set(
      item.results.filter(r => r.status === 'success').map(r => r.serviceId),
    );
    // 所有勾选目标都已存在 → 该项无需迁移，提前剔除
    if (!targets.some(t => !existingIds.has(t))) return null;
    const status: MigrateItemStatus = {
      historyId: item.id,
      fileName: item.localFileName,
      // 预填源 URL：供 pending 阶段 UI 展示 tooltip
      sourceUrl: item.results.find(r => r.status === 'success' && r.result?.url)?.result?.url,
      status: 'pending',
      // 只对缺失目标建条目，已有的不重复建
      serviceResults: Object.fromEntries(
        targets.filter(t => !existingIds.has(t)).map(sid => [sid, 'pending' as const]),
      ),
      existingServiceIds: [...existingIds],
    };
    return { id: item.id, status };
  }

  function commit(batch: PreloadedItem[]) {
    if (batch.length === 0) return;
    items.push(...batch);
    // 原地 push + triggerRef 是真 O(batch)：拼接式赋值在 25k 条规模下退化为 O(N²)。
    // 与 rafThrottle 的 `[...allItemStatuses.value]` 解耦：每次 commit 重读 .value，
    // 无论上游是否替换了底层数组引用，push 都落到当前的 ref 数组上。
    const arr = allItemStatuses.value;
    for (const p of batch) arr.push(p.status);
    triggerRef(allItemStatuses);
    args.onBatch?.(batch);
  }

  // 首屏：100 条让用户立刻看到列表
  let cursorTimestamp: number | undefined;
  let cursorId: string | undefined;
  const updateCursor = (batch: HistoryItem[]) => {
    const last = batch[batch.length - 1];
    if (last) {
      cursorTimestamp = last.timestamp;
      cursorId = last.id;
    }
  };

  const first = await historyDB.getItemsByBackupCount({ ...params, limit: PRELOAD_FIRST_CHUNK, offset: 0 });
  const totalInDB = first.total;
  commit(first.items.map(makePreloaded).filter((p): p is PreloadedItem => p !== null));
  updateCursor(first.items);
  let loadedFromDb = first.items.length;

  // 流式加载剩余（每块 2000），每块之间让出主线程
  while (loadedFromDb < totalInDB && !isCancelled.value) {
    while (isPaused.value && !isCancelled.value) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (isCancelled.value) break;

    await yieldToMain();
    const chunk = await historyDB.getItemsByBackupCount({
      ...params,
      limit: PRELOAD_STREAM_CHUNK,
      offset: 0,
      cursorTimestamp,
      cursorId,
    });
    if (chunk.items.length === 0) break;
    commit(chunk.items.map(makePreloaded).filter((p): p is PreloadedItem => p !== null));
    updateCursor(chunk.items);
    loadedFromDb += chunk.items.length;
  }

  return items;
}
