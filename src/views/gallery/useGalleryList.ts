// 列表视图的数据（GalleryScreen.dc.html G02）：与网格同一套筛选，按表头排序，按页取（每页 100 行），
// 只取屏幕附近的那几页。
// 换筛选 / 排序（LoadingRules ①「切换直接显示内容」）：新的第一页读回来之前屏幕上留着旧的行，读好后连同总数一次换上，
// 从最上面看起；记录有变化（上传、移除…）时屏幕上的那几页也留着，重读回来再原地换，不先变成骨架条。

import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue';
import { onCacheEventType } from '@/events/cacheEvents';
import { historyDB } from '@/services/database';
import type { DayStatsFilter } from '@/services/database/types';
import type { GalleryListRow, GalleryListSort } from '@/services/database/TimelineQueryService';
import { createLogger } from '@/utils/logger';

const log = createLogger('GalleryList');

const LIST_PAGE_SIZE = 100;

/** 列表的总数从哪来：网格屏幕上那一份的张数（同一份筛选的按天统计），以及网格是不是还在读新筛选的 */
export interface GalleryListTotalSource {
  total: Ref<number>;
  pending: Ref<boolean>;
}

/** 一份列表结果：按哪份筛选 + 排序读的，已取的页 */
interface ListResult {
  key: string;
  filter: DayStatsFilter;
  sort: GalleryListSort;
  pages: Map<number, GalleryListRow[]>;
}

const pageOf = (index: number) => Math.floor(index / LIST_PAGE_SIZE);

export function useGalleryList(filter: Ref<DayStatsFilter>, sort: Ref<GalleryListSort>, source: GalleryListTotalSource) {
  const currentKey = computed(() => JSON.stringify({ filter: filter.value, sort: sort.value }));

  /** 屏幕上的这一份 */
  const shown = shallowRef<ListResult>({ key: '', filter: filter.value, sort: sort.value, pages: new Map() });
  /** 屏幕上的总数：下一份在读的时候不变，换上时与行同一刻换 */
  const total = ref(0);
  /**
   * 正在读的下一份（换筛选 / 排序、记录有变化）：要的页都读回来、网格的总数也是这份筛选的了，才整份换上。
   * 读的过程中屏幕上照旧是 shown
   */
  let incoming: (ListResult & { wanted: Set<number> }) | null = null;
  const reading = ref(false);
  let incomingVersion = 0;

  /** 屏幕上的行在哪几页（列表组件告诉这里；列表没显示时为空） */
  let visiblePages = new Set<number>();
  /** 按需读 shown 的页：同一页并发只读一次；换上新的一份时作废 */
  const pending = new Set<number>();
  let version = 0;
  /** 每换上一份加一：屏幕上的行没变时，调用方靠它知道要把可见行补齐 */
  const generation = ref(0);

  /** 换筛选 / 排序的新结果还没换上（计数与空状态沿用上一次的） */
  const isSwitching = computed(() => shown.value.key !== currentKey.value);

  function tryCommit(): void {
    const next = incoming;
    if (!next || next.pages.size < next.wanted.size || source.pending.value) return;
    incoming = null;
    reading.value = false;
    version += 1;
    pending.clear();
    shown.value = { key: next.key, filter: next.filter, sort: next.sort, pages: next.pages };
    total.value = source.total.value;
    generation.value += 1;
  }

  /**
   * 读下一份：换了筛选 / 排序从第一页看起；同一份重读（记录有变化）读屏幕上的那几页和第一页。
   * 读好之前屏幕上照旧
   */
  function readNext(): void {
    const key = currentKey.value;
    const query = { filter: filter.value, sort: sort.value };
    const wanted = new Set(key === shown.value.key ? [0, ...visiblePages] : [0]);
    const mine = ++incomingVersion;
    const next = { key, ...query, pages: new Map<number, GalleryListRow[]>(), wanted };
    incoming = next;
    reading.value = true;
    for (const page of wanted) {
      historyDB.getListPage(query.filter, query.sort, page * LIST_PAGE_SIZE, LIST_PAGE_SIZE)
        .then((rows) => {
          if (mine !== incomingVersion) return;
          next.pages.set(page, rows);
          tryCommit();
        })
        .catch((error) => {
          if (mine === incomingVersion) log.warn(`读取第 ${page + 1} 页失败`, error);
        });
    }
  }

  watch(currentKey, readNext);
  readNext();
  // 网格读好了新筛选的统计（总数到了），等着它的那一份就可以换上
  watch(() => source.pending.value, tryCommit);
  // 没有在读的下一份时，总数跟着网格走（记录增减）
  watch(() => source.total.value, (value) => {
    if (!reading.value) total.value = value;
  });

  const unlistens: Array<() => void> = [];
  Promise.all([
    onCacheEventType('history-updated', readNext),
    onCacheEventType('history-deleted', readNext),
    onCacheEventType('history-cleared', readNext),
  ])
    .then((fns) => unlistens.push(...fns))
    .catch((error) => log.warn('事件订阅失败', error));
  onUnmounted(() => unlistens.forEach((fn) => fn()));

  /** 第 index 行所在的那一页还没取就去取（同一页并发只取一次） */
  async function ensure(index: number): Promise<void> {
    const page = pageOf(index);
    const current = shown.value;
    if (current.pages.has(page) || pending.has(page)) return;
    pending.add(page);
    const mine = version;
    try {
      const rows = await historyDB.getListPage(current.filter, current.sort, page * LIST_PAGE_SIZE, LIST_PAGE_SIZE);
      if (mine !== version) return;
      const pages = new Map(shown.value.pages);
      pages.set(page, rows);
      shown.value = { ...shown.value, pages };
    } catch (error) {
      log.warn(`读取第 ${page + 1} 页失败`, error);
    } finally {
      if (mine === version) pending.delete(page);
    }
  }

  /** 列表组件告诉这里屏幕上是哪几行（列表收起时给空）：记下它们在哪几页，没取的去取 */
  function ensureVisible(indexes: readonly number[]): void {
    visiblePages = new Set(indexes.map(pageOf));
    for (const index of indexes) void ensure(index);
  }

  function rowAt(index: number): GalleryListRow | null {
    return shown.value.pages.get(pageOf(index))?.[index % LIST_PAGE_SIZE] ?? null;
  }

  /** 这一张在列表里是第几行（只在已取到的页里找）；没找到返回 -1 */
  function indexOf(id: string): number {
    for (const [page, rows] of shown.value.pages) {
      const at = rows.findIndex((row) => row.id === id);
      if (at >= 0) return page * LIST_PAGE_SIZE + at;
    }
    return -1;
  }

  /** 已取到的行，按列表顺序（Shift 连选用） */
  const loadedRows = computed(() => [...shown.value.pages.entries()].sort(([a], [b]) => a - b).flatMap(([, rows]) => rows));

  return {
    ensure,
    ensureVisible,
    rowAt,
    indexOf,
    loadedRows,
    generation,
    total,
    isSwitching,
    /** 屏幕上这一份的筛选 + 排序（变了就是换了一份结果，列表回到最上面） */
    shownKey: computed(() => shown.value.key),
  };
}

export type GalleryListApi = ReturnType<typeof useGalleryList>;
