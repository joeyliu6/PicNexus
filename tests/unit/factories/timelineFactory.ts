import type { ServiceType } from '@/config/types';
import type { PhotoGroup } from '@/composables/timeline/types';
import type { ImageMeta } from '@/types/image-meta';

let timelineSequence = 0;

export function resetTimelineFactorySequence(): void {
  timelineSequence = 0;
}

export function createImageMeta(overrides: Partial<ImageMeta> = {}): ImageMeta {
  timelineSequence += 1;

  const id = overrides.id ?? `meta-${timelineSequence}`;

  return {
    id,
    timestamp: overrides.timestamp ?? 1_700_000_000_000 + timelineSequence,
    localFileName: overrides.localFileName ?? `${id}.jpg`,
    aspectRatio: overrides.aspectRatio ?? 1.5,
    primaryService: overrides.primaryService ?? ('jd' as ServiceType),
    primaryUrl: overrides.primaryUrl ?? `https://img.example.com/${id}.jpg`,
    primaryFileKey: overrides.primaryFileKey,
    mirrorServices: overrides.mirrorServices,
    isFavorited: overrides.isFavorited,
  };
}

/**
 * PhotoGroup 工厂。
 *
 * 注意 `month` 是 0-11（与 Date 对齐），`id` 的口径是 `${year}-${month}-${day}`——
 * 时间轴的 dayKey 就是这个字符串，跳转/预取都按它匹配，写用例时别自造格式。
 * 默认不传 items 时同时置 `isSkeleton: true`，对应「尚未从 DB 加载」的骨架天。
 */
export function createPhotoGroup(overrides: Partial<PhotoGroup> = {}): PhotoGroup {
  const year = overrides.year ?? 2024;
  const month = overrides.month ?? 0;
  const day = overrides.day ?? 1;
  const items = overrides.items ?? [];

  return {
    id: overrides.id ?? `${year}-${month}-${day}`,
    label: overrides.label ?? `${year}年${month + 1}月${day}日`,
    year,
    month,
    day,
    date: overrides.date ?? new Date(year, month, day),
    items,
    expectedCount: overrides.expectedCount,
    isSkeleton: overrides.isSkeleton ?? items.length === 0,
    aspectRatios: overrides.aspectRatios,
    aspectRatioSum: overrides.aspectRatioSum,
  };
}
