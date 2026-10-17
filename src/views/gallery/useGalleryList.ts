// 列表视图的数据（GalleryScreen.dc.html G02）：与网格同一套筛选，按表头排序，按页取（每页 100 行），
// 只取屏幕附近的那几页；筛选、排序或记录有变化时整体作废重取。

import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue';
import { onCacheEventType } from '@/events/cacheEvents';
import { historyDB } from '@/services/database';
import type { DayStatsFilter } from '@/services/database/types';
import type { GalleryListRow, GalleryListSort } from '@/services/database/TimelineQueryService';
import { createLogger } from '@/utils/logger';

const log = createLogger('GalleryList');

const LIST_PAGE_SIZE = 100;

export function useGalleryList(filter: Ref<DayStatsFilter>, sort: Ref<GalleryListSort>) {
  const pages = shallowRef(new Map<number, GalleryListRow[]>());
  const pending = new Set<number>();
  let version = 0;
  /** 每作废一次加一：屏幕上的行没变时，调用方靠它知道要重新取页 */
  const generation = ref(0);

  function reset(): void {
    version += 1;
    generation.value += 1;
    pending.clear();
    pages.value = new Map();
  }

  watch([filter, sort], reset, { deep: true });

  const unlistens: Array<() => void> = [];
  Promise.all([
    onCacheEventType('history-updated', reset),
    onCacheEventType('history-deleted', reset),
    onCacheEventType('history-cleared', reset),
  ])
    .then((fns) => unlistens.push(...fns))
    .catch((error) => log.warn('事件订阅失败', error));
  onUnmounted(() => unlistens.forEach((fn) => fn()));

  /** 第 index 行所在的那一页还没取就去取（同一页并发只取一次） */
  async function ensure(index: number): Promise<void> {
    const page = Math.floor(index / LIST_PAGE_SIZE);
    if (pages.value.has(page) || pending.has(page)) return;
    pending.add(page);
    const mine = version;
    try {
      const rows = await historyDB.getListPage(filter.value, sort.value, page * LIST_PAGE_SIZE, LIST_PAGE_SIZE);
      if (mine !== version) return;
      const next = new Map(pages.value);
      next.set(page, rows);
      pages.value = next;
    } catch (error) {
      log.warn(`读取第 ${page + 1} 页失败`, error);
    } finally {
      if (mine === version) pending.delete(page);
    }
  }

  function rowAt(index: number): GalleryListRow | null {
    return pages.value.get(Math.floor(index / LIST_PAGE_SIZE))?.[index % LIST_PAGE_SIZE] ?? null;
  }

  /** 这一张在列表里是第几行（只在已取到的页里找）；没找到返回 -1 */
  function indexOf(id: string): number {
    for (const [page, rows] of pages.value) {
      const at = rows.findIndex((row) => row.id === id);
      if (at >= 0) return page * LIST_PAGE_SIZE + at;
    }
    return -1;
  }

  /** 已取到的行，按列表顺序（Shift 连选用） */
  const loadedRows = computed(() => [...pages.value.entries()].sort(([a], [b]) => a - b).flatMap(([, rows]) => rows));

  return { ensure, rowAt, indexOf, loadedRows, generation };
}

export type GalleryListApi = ReturnType<typeof useGalleryList>;
