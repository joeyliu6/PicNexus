import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { mountWithDefaults } from '../helpers/vueMount';
import FavoritesView from '@/components/views/FavoritesView.vue';
import FavoritePhotoItem from '@/components/views/favorites/FavoritePhotoItem.vue';
import type { ImageMeta } from '@/types/image-meta';
import type { HistoryItem } from '@/config/types';
import { createHistoryItem } from '../factories/historyFactory';

const favoritesDataMock = vi.hoisted(() => ({
  loadFirstPage: vi.fn(),
  loadNextPage: vi.fn(),
  onFavoritesScroll: vi.fn(),
}));

const historyViewStateMock = vi.hoisted(() => ({
  toggleSelection: vi.fn(),
  bulkCopyFormatted: vi.fn(),
  bulkExport: vi.fn(),
  bulkDelete: vi.fn(),
  clearSelection: vi.fn(),
  deselect: vi.fn(),
  setFilter: vi.fn(),
  setSearchTerm: vi.fn(),
  reset: vi.fn(),
  deleteHistoryItem: vi.fn(),
  getDetail: vi.fn(),
}));

const historyManagerMock = vi.hoisted(() => ({
  toggleFavorite: vi.fn(),
  batchSetFavorite: vi.fn(),
}));

const lightboxMock = vi.hoisted(() => ({
  openLightbox: vi.fn(),
  handleLightboxNavigate: vi.fn(),
  handleLightboxDelete: vi.fn(),
}));

const mockRefs = vi.hoisted(() => ({
  data: null as null | {
    loadedMetas: { value: ImageMeta[] };
    totalCount: { value: number };
    hasMore: { value: boolean };
    isLoading: { value: boolean };
    hasLoadedOnce: { value: boolean };
    imageStates: Record<string, 'loading' | 'loaded' | 'failed'>;
  },
  viewState: null as null | {
    selectedIdList: { value: string[] };
    hasSelection: { value: boolean };
  },
  history: null as null | {
    favoriteSet: { value: Set<string> };
    isStatsLoaded: { value: boolean };
  },
  lightbox: null as null | {
    visible: { value: boolean };
    item: { value: HistoryItem | null };
    hasPrev: { value: boolean };
    hasNext: { value: boolean };
  },
  config: null as null | { value: Record<string, unknown> },
}));

/** 配置基线：不含任何「已确认的明文 HTTP 域名」，即缩略图闸门处于最严格状态 */
const BASE_CONFIG = vi.hoisted(() => ({
  linkOutput: { defaultFormat: 'url', customTemplate: '', autoCopy: false },
}));

vi.mock('@/composables/favorites/useFavoritesData', async () => {
  const { ref, shallowRef } = await import('vue');
  mockRefs.data = {
    loadedMetas: shallowRef<ImageMeta[]>([]),
    totalCount: ref(0),
    hasMore: ref(false),
    isLoading: ref(false),
    hasLoadedOnce: ref(true),
    imageStates: {},
  };

  return {
    useFavoritesData: () => ({
      loadedMetas: mockRefs.data!.loadedMetas,
      totalCount: mockRefs.data!.totalCount,
      hasMore: mockRefs.data!.hasMore,
      isLoading: mockRefs.data!.isLoading,
      hasLoadedOnce: mockRefs.data!.hasLoadedOnce,
      imageStates: mockRefs.data!.imageStates,
      getThumbnailUrls: (meta: ImageMeta) => meta.mirrorServices?.map(service => service.url) ?? [meta.primaryUrl],
      getItemService: (id: string) => mockRefs.data!.loadedMetas.value.find(meta => meta.id === id)?.primaryService,
      getItemServices: (id: string) => {
        const meta = mockRefs.data!.loadedMetas.value.find(item => item.id === id);
        if (!meta) return [];
        return Array.from(new Set([
          meta.primaryService,
          ...(meta.mirrorServices?.map(service => service.serviceId) ?? []),
        ]));
      },
      onFavoritesScroll: favoritesDataMock.onFavoritesScroll,
      loadFirstPage: favoritesDataMock.loadFirstPage,
      loadNextPage: favoritesDataMock.loadNextPage,
    }),
  };
});

vi.mock('@/composables/favorites/useFavoritesLightbox', async () => {
  const { ref } = await import('vue');
  mockRefs.lightbox = {
    visible: ref(false),
    item: ref<HistoryItem | null>(null),
    hasPrev: ref(false),
    hasNext: ref(false),
  };

  return {
    useFavoritesLightbox: () => ({
      lightboxVisible: mockRefs.lightbox!.visible,
      lightboxItem: mockRefs.lightbox!.item,
      lightboxHasPrev: mockRefs.lightbox!.hasPrev,
      lightboxHasNext: mockRefs.lightbox!.hasNext,
      openLightbox: lightboxMock.openLightbox,
      handleLightboxNavigate: lightboxMock.handleLightboxNavigate,
      handleLightboxDelete: lightboxMock.handleLightboxDelete,
    }),
  };
});

vi.mock('@/composables/useHistoryViewState', async () => {
  const { computed: vueComputed, ref } = await import('vue');
  mockRefs.viewState = {
    selectedIdList: ref<string[]>([]),
    hasSelection: ref(false),
  };

  return {
    useHistoryViewState: () => ({
      selectedIdList: vueComputed(() => mockRefs.viewState!.selectedIdList.value),
      hasSelection: vueComputed(() => mockRefs.viewState!.hasSelection.value),
      toggleSelection: historyViewStateMock.toggleSelection,
      bulkCopyFormatted: historyViewStateMock.bulkCopyFormatted,
      bulkExport: historyViewStateMock.bulkExport,
      bulkDelete: historyViewStateMock.bulkDelete,
      clearSelection: historyViewStateMock.clearSelection,
      deselect: historyViewStateMock.deselect,
      setFilter: historyViewStateMock.setFilter,
      setSearchTerm: historyViewStateMock.setSearchTerm,
      reset: historyViewStateMock.reset,
      deleteHistoryItem: historyViewStateMock.deleteHistoryItem,
      detailCache: { getDetail: historyViewStateMock.getDetail },
    }),
  };
});

vi.mock('@/composables/useHistory', async () => {
  const { ref } = await import('vue');
  mockRefs.history = {
    favoriteSet: ref(new Set<string>()),
    isStatsLoaded: ref(true),
  };

  return {
    useHistoryManager: () => ({
      isStatsLoaded: mockRefs.history!.isStatsLoaded,
      favoriteSet: mockRefs.history!.favoriteSet,
      toggleFavorite: historyManagerMock.toggleFavorite,
      batchSetFavorite: historyManagerMock.batchSetFavorite,
    }),
  };
});

vi.mock('@/composables/useConfig', async () => {
  const { ref } = await import('vue');
  mockRefs.config = ref<Record<string, unknown>>({ ...BASE_CONFIG });
  return {
    useConfigManager: () => ({ config: mockRefs.config! }),
  };
});

vi.mock('@/composables/useLazyLoadOnVisible', () => ({
  useLazyLoadOnVisible: (_visible: unknown, loader: () => void | Promise<void>) => {
    void loader();
  },
}));

function meta(overrides: Partial<ImageMeta> = {}): ImageMeta {
  const id = overrides.id ?? 'fav-1';
  return {
    id,
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    localFileName: overrides.localFileName ?? `${id}.jpg`,
    aspectRatio: overrides.aspectRatio ?? 1,
    primaryService: overrides.primaryService ?? 'jd',
    primaryUrl: overrides.primaryUrl ?? `https://img.example.com/${id}.jpg`,
    primaryFileKey: overrides.primaryFileKey,
    mirrorServices: overrides.mirrorServices,
    isFavorited: overrides.isFavorited ?? true,
  };
}

const mountedWrappers: VueWrapper[] = [];

/**
 * 记下挂载出来的组件，供 afterEach 统一卸载
 *
 * VTU 不会自动卸载。留着的旧 wrapper 仍然订阅着模块级的 mock ref，下一个用例改这些 ref
 * 时它会跟着重渲染、把状态写回共享的 imageStates——症状是"单跑绿、连跑红"，
 * 还会在控制台甩出一串 Vue patch 报错。
 */
function track(wrapper: VueWrapper): VueWrapper {
  mountedWrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount();
});

function mountFavoritesView() {
  return track(mountWithDefaults(FavoritesView, {
    props: {
      filter: 'all',
      searchTerm: '',
      visible: true,
    },
    global: {
      stubs: {
        EmptyState: {
          props: ['title', 'description'],
          template: '<section class="empty-state-stub">{{ title }}{{ description }}</section>',
        },
        HistoryLightbox: {
          props: ['visible', 'item', 'hasPrev', 'hasNext'],
          emits: ['delete', 'navigate', 'toggle-favorite'],
          template: '<section class="lightbox-stub" />',
        },
        FloatingActionBar: {
          props: ['selectedCount', 'visible', 'availableServices', 'favoriteState'],
          emits: ['copy', 'export', 'delete', 'clear-selection', 'batch-favorite'],
          template: `
            <section
              v-if="visible"
              class="floating-action-stub"
              :data-selected-count="selectedCount"
              :data-services="availableServices.map(s => \`\${s.serviceId}:\${s.count}\`).join('|')"
              :data-favorite-state="favoriteState"
            >
              <button class="fab-copy" @click="$emit('copy', 'markdown')">copy</button>
              <button class="fab-copy-r2" @click="$emit('copy', 'url', 'r2')">copy r2</button>
              <button class="fab-export" @click="$emit('export')">export</button>
              <button class="fab-delete" @click="$emit('delete')">delete</button>
              <button class="fab-clear" @click="$emit('clear-selection')">clear</button>
              <button class="fab-favorite" @click="$emit('batch-favorite', favoriteState === 'all' ? false : true)">favorite</button>
            </section>
          `,
        },
      },
    },
  }));
}

/**
 * 把所有共享 mock 打回初始状态
 *
 * 提成函数供多个 describe 复用：这些 ref 是模块级的，一个 describe 里挂上的
 * imageStates / selectedIdList 会原样漏进下一个 describe，症状是"单跑绿、连跑红"。
 */
function resetMocks(): void {
  vi.clearAllMocks();
  mockRefs.data!.loadedMetas.value = [];
  mockRefs.data!.totalCount.value = 0;
  mockRefs.data!.hasMore.value = false;
  mockRefs.data!.isLoading.value = false;
  mockRefs.data!.hasLoadedOnce.value = true;
  for (const key of Object.keys(mockRefs.data!.imageStates)) delete mockRefs.data!.imageStates[key];
  mockRefs.viewState!.selectedIdList.value = [];
  mockRefs.viewState!.hasSelection.value = false;
  mockRefs.history!.favoriteSet.value = new Set();
  mockRefs.history!.isStatsLoaded.value = true;
  mockRefs.lightbox!.visible.value = false;
  mockRefs.lightbox!.item.value = null;
  mockRefs.config!.value = { ...BASE_CONFIG };
  historyViewStateMock.getDetail.mockResolvedValue(createHistoryItem({ id: 'fav-1' }));
  lightboxMock.openLightbox.mockResolvedValue(undefined);
}

describe('FavoritesView P1 coverage', () => {
  beforeEach(resetMocks);

  it('shows empty state after loading an empty favorites page', () => {
    const wrapper = mountFavoritesView();

    expect(favoritesDataMock.loadFirstPage).toHaveBeenCalled();
    expect(wrapper.find('.empty-state-stub').exists()).toBe(true);
    expect(wrapper.find('.photo-item').exists()).toBe(false);
    expect(wrapper.emitted('update:totalCount')).toEqual([[0]]);
  });

  it('shows initial loading skeletons and the load-more indicator for paged lists', async () => {
    mockRefs.data!.hasLoadedOnce.value = false;
    mockRefs.data!.isLoading.value = true;
    mockRefs.history!.favoriteSet.value = new Set(['fav-1']);

    const wrapper = mountFavoritesView();

    expect(wrapper.findAll('.skeleton-cell')).toHaveLength(16);
    expect(wrapper.find('.empty-state-stub').exists()).toBe(false);

    mockRefs.data!.loadedMetas.value = [meta({ id: 'fav-1' })];
    mockRefs.data!.totalCount.value = 2;
    mockRefs.data!.hasMore.value = true;
    mockRefs.data!.isLoading.value = false;
    mockRefs.data!.hasLoadedOnce.value = true;
    mockRefs.data!.imageStates['fav-1'] = 'loaded';
    await nextTick();

    expect(wrapper.findAll('.photo-item')).toHaveLength(1);
    expect(wrapper.find('.load-more-sentinel').exists()).toBe(true);

    await wrapper.get('.favorites-scroll').trigger('scroll');

    expect(favoritesDataMock.onFavoritesScroll).toHaveBeenCalledTimes(1);
  });

  it('shows empty state directly when stats confirm there are no favorites', () => {
    mockRefs.data!.hasLoadedOnce.value = false;
    mockRefs.data!.isLoading.value = true;
    mockRefs.history!.isStatsLoaded.value = true;
    mockRefs.history!.favoriteSet.value = new Set();

    const wrapper = mountFavoritesView();

    expect(wrapper.findAll('.skeleton-cell')).toHaveLength(0);
    expect(wrapper.find('.empty-state-stub').exists()).toBe(true);
  });

  it('shows empty state directly after history clear removes the last favorite', async () => {
    mockRefs.data!.loadedMetas.value = [meta({ id: 'fav-1' })];
    mockRefs.data!.totalCount.value = 1;
    mockRefs.data!.imageStates['fav-1'] = 'loaded';

    const wrapper = mountFavoritesView();

    expect(wrapper.findAll('.photo-item')).toHaveLength(1);

    mockRefs.history!.favoriteSet.value = new Set();
    mockRefs.data!.loadedMetas.value = [];
    mockRefs.data!.totalCount.value = 0;
    mockRefs.data!.isLoading.value = false;
    mockRefs.data!.hasMore.value = false;
    await nextTick();

    expect(wrapper.findAll('.skeleton-cell')).toHaveLength(0);
    expect(wrapper.find('.empty-state-stub').exists()).toBe(true);
    expect(wrapper.find('.photo-item').exists()).toBe(false);
  });

  it('renders favorites, opens lightbox, toggles selection, and unfavorites items', async () => {
    const first = meta({ id: 'fav-1', primaryUrl: 'https://img.example.com/fav-1.jpg' });
    const second = meta({ id: 'fav-2', primaryUrl: 'https://img.example.com/fav-2.jpg' });
    mockRefs.data!.loadedMetas.value = [first, second];
    mockRefs.data!.totalCount.value = 2;
    mockRefs.data!.imageStates['fav-1'] = 'loaded';
    mockRefs.data!.imageStates['fav-2'] = 'failed';

    const wrapper = mountFavoritesView();

    expect(wrapper.findAll('.photo-item')).toHaveLength(2);

    await wrapper.findAll('.photo-item')[0].trigger('click');
    await wrapper.findAll('.checkbox')[0].trigger('click');
    await wrapper.findAll('.favorite-btn')[0].trigger('click');

    expect(lightboxMock.openLightbox).toHaveBeenCalledWith(first);
    expect(historyViewStateMock.toggleSelection).toHaveBeenCalledWith('fav-1');
    expect(historyManagerMock.toggleFavorite).toHaveBeenCalledWith('fav-1');
    expect(wrapper.findAll('.photo-error')).toHaveLength(1);
  });

  it('keeps the page stable when unfavoriting fails', async () => {
    const first = meta({ id: 'fav-1' });
    mockRefs.data!.loadedMetas.value = [first];
    mockRefs.data!.totalCount.value = 1;
    mockRefs.data!.imageStates['fav-1'] = 'loaded';
    historyManagerMock.toggleFavorite.mockRejectedValueOnce(new Error('db unavailable'));

    const wrapper = mountFavoritesView();

    await wrapper.get('.favorite-btn').trigger('click');
    await flushPromises();

    expect(historyManagerMock.toggleFavorite).toHaveBeenCalledWith('fav-1');
    expect(wrapper.findAll('.photo-item')).toHaveLength(1);
    expect(wrapper.find('.empty-state-stub').exists()).toBe(false);
  });

  it('wires selected favorites to bulk action handlers', async () => {
    mockRefs.data!.loadedMetas.value = [meta({ id: 'fav-1' })];
    mockRefs.data!.totalCount.value = 1;
    mockRefs.data!.imageStates['fav-1'] = 'loaded';
    mockRefs.viewState!.selectedIdList.value = ['fav-1'];
    mockRefs.viewState!.hasSelection.value = true;
    mockRefs.history!.favoriteSet.value = new Set(['fav-1']);

    const wrapper = mountFavoritesView();
    expect(wrapper.get('.floating-action-stub').attributes('data-favorite-state')).toBe('all');

    await wrapper.get('.fab-copy').trigger('click');
    await wrapper.get('.fab-export').trigger('click');
    await wrapper.get('.fab-delete').trigger('click');
    await wrapper.get('.fab-clear').trigger('click');
    await wrapper.get('.fab-favorite').trigger('click');

    expect(historyViewStateMock.bulkCopyFormatted).toHaveBeenCalledWith('markdown');
    expect(historyViewStateMock.bulkExport).toHaveBeenCalled();
    expect(historyViewStateMock.bulkDelete).toHaveBeenCalled();
    expect(historyViewStateMock.clearSelection).toHaveBeenCalled();
    expect(historyManagerMock.batchSetFavorite).toHaveBeenCalledWith(['fav-1'], false);
    expect(wrapper.emitted('update:selectedCount')).toEqual([[1]]);
  });

  it('removes hidden selections when selected favorites are unfavorited', async () => {
    mockRefs.data!.loadedMetas.value = [meta({ id: 'fav-1' }), meta({ id: 'fav-2' })];
    mockRefs.viewState!.selectedIdList.value = ['fav-1', 'fav-2'];
    mockRefs.viewState!.hasSelection.value = true;
    mockRefs.history!.favoriteSet.value = new Set(['fav-1', 'fav-2']);

    mountFavoritesView();
    historyViewStateMock.deselect.mockClear();

    mockRefs.history!.favoriteSet.value = new Set(['fav-2']);
    await nextTick();

    expect(historyViewStateMock.deselect).toHaveBeenCalledWith('fav-1');
    expect(historyViewStateMock.deselect).not.toHaveBeenCalledWith('fav-2');
  });

  it('exposes selected service counts and forwards service-specific copy requests', async () => {
    mockRefs.data!.loadedMetas.value = [
      meta({
        id: 'fav-jd',
        primaryService: 'jd',
        mirrorServices: [
          { serviceId: 'jd', url: 'https://img.example.com/fav-jd.jpg' },
          { serviceId: 'r2', url: 'https://r2.example.com/fav-jd.jpg' },
        ],
      }),
      meta({ id: 'fav-r2-a', primaryService: 'r2' }),
      meta({ id: 'fav-r2-b', primaryService: 'r2' }),
      meta({ id: 'fav-unselected', primaryService: 'github' }),
    ];
    mockRefs.data!.totalCount.value = 4;
    for (const meta of mockRefs.data!.loadedMetas.value) {
      mockRefs.data!.imageStates[meta.id] = 'loaded';
    }
    mockRefs.viewState!.selectedIdList.value = ['fav-r2-a', 'fav-jd', 'fav-r2-b'];
    mockRefs.viewState!.hasSelection.value = true;

    const wrapper = mountFavoritesView();
    const actions = wrapper.get('.floating-action-stub');

    expect(actions.attributes('data-selected-count')).toBe('3');
    expect(actions.attributes('data-services')).toBe('r2:3|jd:1');

    await wrapper.get('.fab-copy-r2').trigger('click');

    expect(historyViewStateMock.bulkCopyFormatted).toHaveBeenCalledWith('url', 'r2');
  });
});

describe('FavoritePhotoItem fallback and interactions', () => {
  const item = meta({ id: 'fav-item' });

  it('tries mirror URLs before reporting a failed thumbnail', async () => {
    const wrapper = track(mountWithDefaults(FavoritePhotoItem, {
      props: {
        meta: item,
        thumbnailUrls: ['https://primary.example.com/a.jpg', 'https://mirror.example.com/a.jpg'],
        imageState: undefined,
        selected: false,
      },
    }));

    expect(wrapper.get('img').attributes('src')).toBe('https://primary.example.com/a.jpg');

    await wrapper.get('img').trigger('error');
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toBe('https://mirror.example.com/a.jpg');
    expect(wrapper.emitted('image-state-change')).toBeUndefined();

    await wrapper.get('img').trigger('error');

    expect(wrapper.emitted('image-state-change')).toEqual([['failed']]);
  });

  it('does not restart fallback when parent re-renders with equal thumbnail URLs', async () => {
    const wrapper = track(mountWithDefaults(FavoritePhotoItem, {
      props: {
        meta: item,
        thumbnailUrls: ['https://primary.example.com/a.jpg', 'https://mirror.example.com/a.jpg'],
        imageState: undefined,
        selected: false,
      },
    }));

    await wrapper.get('img').trigger('error');
    await nextTick();
    expect(wrapper.get('img').attributes('src')).toBe('https://mirror.example.com/a.jpg');

    await wrapper.setProps({
      thumbnailUrls: ['https://primary.example.com/a.jpg', 'https://mirror.example.com/a.jpg'],
      imageState: 'loaded',
    });

    expect(wrapper.get('img').attributes('src')).toBe('https://mirror.example.com/a.jpg');
  });

  it('emits item, selection, favorite, and loaded events', async () => {
    const wrapper = track(mountWithDefaults(FavoritePhotoItem, {
      props: {
        meta: item,
        thumbnailUrls: ['https://primary.example.com/a.jpg'],
        imageState: 'loaded',
        selected: true,
      },
    }));

    await wrapper.get('.photo-item').trigger('click');
    await wrapper.get('.checkbox').trigger('click');
    await wrapper.get('.favorite-btn').trigger('click');
    await wrapper.get('img').trigger('load');

    expect(wrapper.emitted('click')).toHaveLength(1);
    expect(wrapper.emitted('toggle-select')).toHaveLength(1);
    expect(wrapper.emitted('toggle-favorite')).toHaveLength(1);
    expect(wrapper.emitted('image-state-change')).toContainEqual(['loaded']);
    expect(wrapper.get('.photo-item').classes()).toContain('selected');
  });
});

// 2026-08-19 CSP 的 `img-src` 放开 `http:` 之后，收藏页原本一道 URL 闸都没有。
// 这组断言候选链的安全过滤确实生效，且配置里的「已确认域名」能一路传到格子里。
describe('FavoritePhotoItem 缩略图安全闸门', () => {
  const item = meta({ id: 'fav-gate' });

  beforeEach(resetMocks);

  it('云元数据地址被剔除，直接落到后面的安全候选', () => {
    const wrapper = track(mountWithDefaults(FavoritePhotoItem, {
      props: {
        meta: item,
        thumbnailUrls: ['http://169.254.169.254/latest/meta-data/a.jpg', 'https://mirror.example.com/a.jpg'],
        imageState: undefined,
        selected: false,
      },
    }));

    expect(wrapper.get('img').attributes('src')).toBe('https://mirror.example.com/a.jpg');
  });

  it('候选全被过滤 → 立刻报失败，不卡在骨架屏', () => {
    const wrapper = track(mountWithDefaults(FavoritePhotoItem, {
      props: {
        meta: item,
        thumbnailUrls: ['http://169.254.169.254/a.jpg'],
        imageState: undefined,
        selected: false,
      },
    }));

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.emitted('image-state-change')).toEqual([['failed']]);
  });

  it('confirmedHttpHosts 里的明文 HTTP 域名照常显示', () => {
    const wrapper = track(mountWithDefaults(FavoritePhotoItem, {
      props: {
        meta: item,
        thumbnailUrls: ['http://img.example.test/a.jpg'],
        imageState: undefined,
        selected: false,
        confirmedHttpHosts: new Set(['img.example.test']),
      },
    }));

    expect(wrapper.get('img').attributes('src')).toBe('http://img.example.test/a.jpg');
  });
});

// 光测组件不够：确认状态存在配置里，得由 FavoritesView 取出来传下去。
// 这两条覆盖那段接线——断了的话已确认的 HTTP 图床在收藏页会整片裂图。
describe('FavoritesView 把已确认的 HTTP 主机名传给格子', () => {
  const httpMeta = meta({ id: 'fav-http', primaryUrl: 'http://img.example.test/fav-http.jpg' });

  beforeEach(() => {
    resetMocks();
    mockRefs.data!.loadedMetas.value = [httpMeta];
    mockRefs.data!.totalCount.value = 1;
    mockRefs.history!.favoriteSet.value = new Set(['fav-http']);
  });

  it('配置里没确认过 → 明文 HTTP 缩略图被拦下', () => {
    const wrapper = mountFavoritesView();

    expect(wrapper.find('.photo-item').exists()).toBe(true);
    expect(wrapper.find('.photo-item img').exists()).toBe(false);
  });

  it('配置里确认过 → 同一张图正常显示', () => {
    mockRefs.config!.value = {
      ...BASE_CONFIG,
      custom_s3_profiles: [
        { publicDomain: 'http://img.example.test', httpDomainConfirmedFor: 'img.example.test' },
      ],
    };

    const wrapper = mountFavoritesView();

    expect(wrapper.get('.photo-item img').attributes('src')).toBe('http://img.example.test/fav-http.jpg');
  });

  // 用户先看图（被判失败）、后去设置页确认，回来就该自己恢复，不用重启。
  // 失败态记在 imageStates 里，候选链够不着，只能由本视图撤销。
  it('看过之后才确认 → 撤销失败态，图自己恢复', async () => {
    const wrapper = mountFavoritesView();
    expect(wrapper.find('.photo-item img').exists()).toBe(false);
    expect(mockRefs.data!.imageStates['fav-http']).toBe('failed');

    mockRefs.config!.value = {
      ...BASE_CONFIG,
      custom_s3_profiles: [
        { publicDomain: 'http://img.example.test', httpDomainConfirmedFor: 'img.example.test' },
      ],
    };
    await nextTick();

    expect(mockRefs.data!.imageStates['fav-http']).toBeUndefined();
    expect(wrapper.get('.photo-item img').attributes('src')).toBe('http://img.example.test/fav-http.jpg');
  });

  // 反向判据：配置存一次就重试一轮死图是纯浪费——设置页填一个 profile 能存 26 次。
  it('配置变了但名单内容没变 → 不动失败态', async () => {
    const wrapper = mountFavoritesView();
    expect(mockRefs.data!.imageStates['fav-http']).toBe('failed');

    mockRefs.config!.value = { ...BASE_CONFIG, linkOutput: { defaultFormat: 'markdown' } };
    await nextTick();

    expect(mockRefs.data!.imageStates['fav-http']).toBe('failed');
    expect(wrapper.find('.photo-item img').exists()).toBe(false);
  });
});
