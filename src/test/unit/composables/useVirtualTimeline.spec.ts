import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { mountWithDefaults } from '../../helpers/vueMount';
import { useVirtualTimeline } from '../../../composables/useVirtualTimeline';
import type { PhotoGroup } from '../../../composables/timeline/types';
import type { ImageMeta } from '../../../types/image-meta';
import type { ServiceType } from '../../../config/types';

const mountedWrappers: VueWrapper[] = [];

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
}

function makeMeta(id: string, aspectRatio = 1.4): ImageMeta {
  return {
    id,
    timestamp: 1_700_000_000_000,
    localFileName: `${id}.jpg`,
    aspectRatio,
    primaryService: 'jd' as ServiceType,
    primaryUrl: `https://img.example.com/${id}.jpg`,
  };
}

function makeGroup(items: ImageMeta[]): PhotoGroup {
  return {
    id: '2024-0-2',
    label: '2024-01-02',
    year: 2024,
    month: 0,
    day: 2,
    date: new Date(2024, 0, 2),
    items,
  };
}

function setElementMetrics(
  el: HTMLElement,
  metrics: { width: number; height: number; scrollTop?: number },
) {
  Object.defineProperty(el, 'clientWidth', {
    configurable: true,
    value: metrics.width,
  });
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    value: metrics.height,
  });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    writable: true,
    value: metrics.scrollTop ?? 0,
  });
  const scrollToMock = vi.fn((optionsOrX?: ScrollToOptions | number, y?: number) => {
    if (typeof optionsOrX === 'number') {
      el.scrollTop = y ?? el.scrollTop;
      return;
    }
    if (typeof optionsOrX?.top === 'number') {
      el.scrollTop = optionsOrX.top;
    }
  });
  el.scrollTo = scrollToMock as typeof el.scrollTo;
}

function mountVirtualTimeline(initialGroups: PhotoGroup[]) {
  const groups = ref(initialGroups);
  let api!: ReturnType<typeof useVirtualTimeline>;

  const Harness = defineComponent({
    setup() {
      const container = ref<HTMLElement | null>(null);
      api = useVirtualTimeline(container, groups, {
        targetRowHeight: 100,
        maxRowHeight: 150,
        headerHeight: 24,
        groupGap: 12,
        gap: 4,
        overscan: 1,
      });
      return { container };
    },
    template: '<div ref="container"></div>',
  });

  const wrapper = mountWithDefaults(Harness, { attachTo: document.body });
  mountedWrappers.push(wrapper);
  return { api, groups, el: wrapper.element as HTMLElement };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(performance.now());
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('getComputedStyle', () => ({
    paddingLeft: '0px',
    paddingRight: '0px',
  }));
});

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount();
  }
  vi.unstubAllGlobals();
});

describe('useVirtualTimeline', () => {
  it('creates layout and visible items after container dimensions are known', () => {
    const items = [makeMeta('one'), makeMeta('two'), makeMeta('three')];
    const { api, el } = mountVirtualTimeline([makeGroup(items)]);
    setElementMetrics(el, { width: 520, height: 240 });

    api.forceUpdateVisibleArea();

    expect(api.containerWidth.value).toBe(520);
    expect(api.viewportHeight.value).toBe(240);
    expect(api.layoutResult.value?.itemPositionMap.has('one')).toBe(true);
    expect(api.visibleItems.value.map(item => item.meta.id)).toEqual(['one', 'two', 'three']);
  });

  it('updates virtual scroll state from a throttled scroll event', () => {
    const { api, el } = mountVirtualTimeline([makeGroup([makeMeta('one')])]);
    setElementMetrics(el, { width: 520, height: 240, scrollTop: 0 });
    api.forceUpdateVisibleArea();

    el.scrollTop = 80;
    api.handleScroll();

    expect(api.scrollTop.value).toBe(80);
    expect(api.viewportHeight.value).toBe(240);
  });

  it('clamps progress scrolling to the layout scroll range', () => {
    const items = Array.from({ length: 16 }, (_, index) => makeMeta(`img-${index}`, 1));
    const { api, el } = mountVirtualTimeline([makeGroup(items)]);
    setElementMetrics(el, { width: 320, height: 160 });
    api.forceUpdateVisibleArea();

    const maxScroll = api.totalHeight.value - api.viewportHeight.value;
    api.scrollToProgress(2, true);

    expect(el.scrollTop).toBe(maxScroll);
    expect(api.scrollTop.value).toBe(maxScroll);
    expect(api.displayMode.value).toBe('fast');
  });

  it('restores scrollTop after layout has been recalculated', async () => {
    const items = Array.from({ length: 12 }, (_, index) => makeMeta(`restore-${index}`, 1));
    const { api, el } = mountVirtualTimeline([makeGroup(items)]);
    setElementMetrics(el, { width: 360, height: 180 });
    api.forceUpdateVisibleArea();

    await api.restoreScrollTop(140);

    expect(el.scrollTop).toBe(140);
    expect(api.scrollTop.value).toBe(140);
  });

  it('scrolls a known item into view through the layout position map', () => {
    const items = Array.from({ length: 8 }, (_, index) => makeMeta(`target-${index}`, 1));
    const { api, el } = mountVirtualTimeline([makeGroup(items)]);
    setElementMetrics(el, { width: 300, height: 120 });
    api.forceUpdateVisibleArea();

    api.scrollToItem('target-7', 'auto');

    expect(el.scrollTo).toHaveBeenCalledWith({
      top: expect.any(Number),
      behavior: 'auto',
    });
  });
});
