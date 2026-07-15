import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { mountWithDefaults } from '../../helpers/vueMount';
import { useTimelineLayout } from '@/composables/timeline/useTimelineLayout';
import { DEFAULT_OPTIONS, type PhotoGroup } from '@/composables/timeline/types';
import type { ImageMeta } from '@/types/image-meta';
import type { ServiceType } from '@/config/types';

const mountedWrappers: VueWrapper[] = [];

function makeMeta(id: string, aspectRatio = 1.5): ImageMeta {
  return {
    id,
    timestamp: 1_700_000_000_000,
    localFileName: `${id}.jpg`,
    aspectRatio,
    primaryService: 'jd' as ServiceType,
    primaryUrl: `https://img.example.com/${id}.jpg`,
  };
}

function makeGroup(overrides: Partial<PhotoGroup> = {}): PhotoGroup {
  return {
    id: '2024-0-2',
    label: '2024-01-02',
    year: 2024,
    month: 0,
    day: 2,
    date: new Date(2024, 0, 2),
    items: [],
    ...overrides,
  };
}

function mountLayout(initialGroups: PhotoGroup[] = [], initialWidth = 480) {
  const containerWidth = ref(initialWidth);
  const groups = ref<PhotoGroup[]>(initialGroups);
  let api!: ReturnType<typeof useTimelineLayout>;

  const Harness = defineComponent({
    setup() {
      api = useTimelineLayout(containerWidth, groups, {
        ...DEFAULT_OPTIONS,
        targetRowHeight: 100,
        maxRowHeight: 150,
        headerHeight: 24,
        groupGap: 12,
        gap: 4,
      });
      return () => null;
    },
  });

  mountedWrappers.push(mountWithDefaults(Harness));
  return { api, groups, containerWidth };
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount();
  }
});

describe('useTimelineLayout', () => {
  it('returns null until both container width and groups are available', () => {
    const { api, containerWidth, groups } = mountLayout([], 0);

    expect(api.calculateFullLayout()).toBeNull();

    containerWidth.value = 480;
    groups.value = [];

    expect(api.calculateFullLayout()).toBeNull();
  });

  it('builds real photo rows and item positions', () => {
    const first = makeMeta('first', 1);
    const second = makeMeta('second', 1.8);
    const { api } = mountLayout([makeGroup({ items: [first, second], isSkeleton: false })]);

    const layout = api.calculateFullLayout();

    expect(layout).not.toBeNull();
    expect(layout!.groupLayouts).toHaveLength(1);
    expect(layout!.allRows.length).toBeGreaterThan(0);
    expect(layout!.itemPositionMap.get('first')).toMatchObject({ groupId: '2024-0-2' });
    expect(layout!.itemPositionMap.get('second')).toMatchObject({ groupId: '2024-0-2' });
    expect(layout!.totalHeight).toBeGreaterThan(24);
  });

  it('uses precise aspect ratios for skeleton day slots when available', () => {
    const { api } = mountLayout([
      makeGroup({
        isSkeleton: true,
        expectedCount: 3,
        aspectRatios: [1, 1.5, 2],
        aspectRatioSum: 4.5,
      }),
    ]);

    const layout = api.calculateFullLayout();
    const groupLayout = layout!.groupLayouts[0];

    expect(groupLayout.rows).toEqual([]);
    expect(groupLayout.skeletonSlots).toHaveLength(3);
    expect(groupLayout.itemCount).toBe(3);
    expect(groupLayout.contentHeight).toBeGreaterThan(0);
    expect(layout!.itemPositionMap.size).toBe(0);
  });

  it('falls back to average-ratio skeleton slots when day aspect rows are missing', () => {
    const { api } = mountLayout([
      makeGroup({
        id: '2024-0-3',
        isSkeleton: true,
        expectedCount: 4,
        aspectRatioSum: 6,
      }),
    ]);

    const layout = api.calculateFullLayout();
    const groupLayout = layout!.groupLayouts[0];

    expect(groupLayout.groupId).toBe('2024-0-3');
    expect(groupLayout.skeletonSlots).toHaveLength(4);
    expect(groupLayout.skeletonSlots!.every(slot => slot.width > 0 && slot.height > 0)).toBe(true);
  });

  it('updates one group layout and refreshes the item position map', () => {
    const { api } = mountLayout([
      makeGroup({ items: [makeMeta('old-a', 1), makeMeta('old-b', 1)] }),
    ]);
    api.layoutResult.value = api.calculateFullLayout();

    api.updateGroup('2024-0-2', [makeMeta('new-a', 2)]);

    expect(api.layoutResult.value!.itemPositionMap.has('old-a')).toBe(false);
    expect(api.layoutResult.value!.itemPositionMap.get('new-a')).toMatchObject({ groupId: '2024-0-2' });
    expect(api.layoutResult.value!.groupLayouts[0].itemCount).toBe(1);
  });

  it('defers recalculation while layout is suspended and resumes once requested', () => {
    const { api, groups } = mountLayout([makeGroup({ items: [makeMeta('initial')] })]);

    api.suspendLayout();
    groups.value = [makeGroup({ items: [makeMeta('changed')] })];
    api.recalculateLayoutAsync();

    expect(api.layoutResult.value).toBeNull();

    api.resumeLayout();

    expect(api.isCalculating.value).toBe(true);
  });
});
