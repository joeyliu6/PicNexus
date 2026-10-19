// 图库按「失效」筛选时的两组（GalleryScreen.dc.html G06 / G07）：「失效 · 有可用备份」「失效 · 无可用备份」，
// 分组直接对应下一步（改用备份 / 找不回）。失效的图通常不多，两组各一次读全，不按天分页；其余筛选照常叠加。

import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue';
import { onCacheEventType, type CacheEventType } from '@/events/cacheEvents';
import { historyDB } from '@/services/database';
import type { DayStatsFilter } from '@/services/database/types';
import type { PhotoGroup } from '@/composables/timeline/types';
import type { ImageMeta } from '@/types/image-meta';
import { formatCount } from '@/utils/formatters';
import { createLogger } from '@/utils/logger';

const log = createLogger('GalleryDeadSections');

const SECTIONS = [
  { id: 'dead-backup', backup: 'available', title: '失效 · 有可用备份' },
  { id: 'dead-none', backup: 'none', title: '失效 · 无可用备份' },
] as const;

/** 「状态」只勾了「失效」时按这两组排，勾了别的状态仍按天 */
export function isDeadOnly(filter: DayStatsFilter): boolean {
  return filter.statusFilter?.length === 1 && filter.statusFilter[0] === 'dead';
}

export function useDeadSections(filter: Ref<DayStatsFilter>, enabled: Ref<boolean>) {
  /** 两组各自的图（与 SECTIONS 同序）；null = 还没读过 */
  const loaded = shallowRef<ImageMeta[][] | null>(null);
  const isLoading = ref(false);
  let version = 0;

  async function load(): Promise<void> {
    const mine = ++version;
    isLoading.value = true;
    try {
      const result = await Promise.all(SECTIONS.map((section) =>
        historyDB.getItemsByDayRange(0, Number.MAX_SAFE_INTEGER, { ...filter.value, backup: section.backup })));
      if (mine === version) loaded.value = result;
    } catch (error) {
      if (mine === version) log.error('读取失效图片失败', error);
    } finally {
      if (mine === version) isLoading.value = false;
    }
  }

  // 换筛选时旧结果留着直到新的回来（计数与空状态不闪）；不在这种筛选下就作废，下次进来重新读
  watch([() => JSON.stringify(filter.value), enabled], ([, on]) => {
    if (on) {
      void load();
    } else {
      version++;
      loaded.value = null;
      isLoading.value = false;
    }
  }, { immediate: true });

  const unlistens: Array<() => void> = [];
  const reload = () => { if (enabled.value) void load(); };
  const events: CacheEventType[] = ['history-updated', 'history-deleted', 'history-cleared'];
  Promise.all(events.map((type) => onCacheEventType(type, reload)))
    .then((fns) => unlistens.push(...fns))
    .catch((error) => log.warn('事件订阅失败', error));
  onUnmounted(() => unlistens.forEach((fn) => fn()));

  const groups = computed<PhotoGroup[]>(() => (loaded.value ?? []).flatMap((items, i) => {
    if (items.length === 0) return [];
    const { id, title } = SECTIONS[i];
    return [{
      id,
      label: title,
      heading: { title, sub: `${formatCount(items.length)} 张` },
      year: 0,
      month: 0,
      day: 0,
      date: new Date(0),
      items,
      expectedCount: items.length,
      isSkeleton: false,
    }];
  }));

  /** 两组首尾相接，网格眼前的顺序（灯箱翻页、Shift 连选） */
  const items = computed(() => (loaded.value ?? []).flat());

  return {
    groups,
    items,
    total: computed(() => items.value.length),
    hasLoaded: computed(() => loaded.value !== null),
    isLoading,
  };
}
