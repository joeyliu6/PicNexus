// 链接检测列表：按图片一行；「有问题 / 全部」两个视图 + 图床筛选 + 搜索 + 分页
//
// 归类、排序、计数都用已落定的结果（imageKind 默认口径）：单条重检的动画期间行待在原位，
// 动画结束结果落定后才挪走，用户能看清它变成了什么。

import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { watchDebounced } from '@vueuse/core';
import type { LinkCheckRow } from '@/types/linkCheck';
import { groupRowsByImage, imageKind, summarizeImages, type ImageEntry, type ImageKind } from './imageHealth';

export const IMAGE_PAGE_SIZE = 100;

/** 检查进行中重建分组的最短间隔：进度事件很密，没必要每次都把几万行重新分一遍 */
const CHECKING_REBUILD_MS = 300;

export type ImageListView = 'problems' | 'all';

/** 「有问题」视图收哪几类 */
export const PROBLEM_KINDS: ReadonlySet<ImageKind> = new Set<ImageKind>(['fixable', 'broken', 'limited', 'backup-broken']);

/** 列表里的先后：点一下就能修的最先，找不回的其次，可能受限、备份失效排后面 */
const KIND_ORDER: Record<ImageKind, number> = {
  fixable: 0,
  broken: 1,
  limited: 2,
  'backup-broken': 3,
  unchecked: 4,
  ok: 5,
};

interface UseImageListOptions {
  checkRows: Ref<LinkCheckRow[]>;
  isChecking: Ref<boolean>;
}

export function useImageList({ checkRows, isChecking }: UseImageListOptions) {
  /** 用户亲手选过的视图；没选过就跟着情况走（见下方 view） */
  const pickedView = ref<ImageListView | null>(null);
  const serviceId = ref<string | null>(null);
  const searchInput = ref('');
  const searchQuery = ref('');
  const page = ref(1);

  const entries = shallowRef<ImageEntry[]>(groupRowsByImage(checkRows.value));
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  function rebuildNow(): void {
    if (rebuildTimer !== null) {
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
    entries.value = groupRowsByImage(checkRows.value);
  }

  watch(checkRows, () => {
    if (!isChecking.value) {
      rebuildNow();
      return;
    }
    if (rebuildTimer === null) rebuildTimer = setTimeout(rebuildNow, CHECKING_REBUILD_MS);
  });
  watch(isChecking, (checking) => {
    if (!checking) rebuildNow();
  });
  onScopeDispose(() => {
    if (rebuildTimer !== null) clearTimeout(rebuildTimer);
  });

  watchDebounced(searchInput, (value) => {
    searchQuery.value = value.trim().toLowerCase();
  }, { debounce: 200 });

  const kinds = computed(() => new Map(entries.value.map((e) => [e.historyId, imageKind(e)])));
  const kindOf = (entry: ImageEntry): ImageKind => kinds.value.get(entry.historyId) ?? 'unchecked';

  const summary = computed(() => summarizeImages(entries.value));

  const scoped = computed(() => {
    const sid = serviceId.value;
    const query = searchQuery.value;
    if (!sid && !query) return entries.value;
    return entries.value.filter((e) => {
      if (sid && !e.rows.some((r) => r.serviceId === sid)) return false;
      if (query && !e.fileName.toLowerCase().includes(query) && !e.rows.some((r) => r.url.toLowerCase().includes(query))) {
        return false;
      }
      return true;
    });
  });

  const problemCount = computed(() => scoped.value.filter((e) => PROBLEM_KINDS.has(kindOf(e))).length);

  /**
   * 没问题时直接看全部（「有问题 0」的空列表没有意义），有问题或正在检查时看问题。
   * 用户亲手切过就一直照用户的来，不再自作主张。
   */
  const view = computed<ImageListView>({
    get: () => pickedView.value ?? (problemCount.value > 0 || isChecking.value ? 'problems' : 'all'),
    set: (value) => { pickedView.value = value; },
  });

  const listed = computed(() => {
    const base = view.value === 'problems'
      ? scoped.value.filter((e) => PROBLEM_KINDS.has(kindOf(e)))
      : scoped.value;
    // 检查进行中不重排：结果陆续进来，行跟着跳会让人看不清
    if (isChecking.value) return base;
    return base
      .map((entry, index) => ({ entry, index, order: KIND_ORDER[kindOf(entry)] }))
      .sort((a, b) => a.order - b.order || a.index - b.index)
      .map(({ entry }) => entry);
  });

  const totalPages = computed(() => Math.max(1, Math.ceil(listed.value.length / IMAGE_PAGE_SIZE)));
  const visible = computed(() =>
    listed.value.slice((page.value - 1) * IMAGE_PAGE_SIZE, page.value * IMAGE_PAGE_SIZE),
  );

  watch([view, serviceId, searchQuery], () => { page.value = 1; });
  watch(totalPages, (count) => {
    if (page.value > count) page.value = count;
  });

  const serviceList = computed(() => {
    const counts = new Map<string, number>();
    for (const entry of entries.value) {
      for (const row of entry.rows) counts.set(row.serviceId, (counts.get(row.serviceId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count);
  });

  return {
    view,
    serviceId,
    searchInput,
    searchQuery,
    page,
    entries,
    summary,
    kindOf,
    scoped,
    problemCount,
    listed,
    totalPages,
    visible,
    serviceList,
  };
}
