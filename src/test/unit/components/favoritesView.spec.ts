import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import FavoritesView from '../../../components/views/FavoritesView.vue';
import FavoritePhotoItem from '../../../components/views/favorites/FavoritePhotoItem.vue';
import type { ImageMeta } from '../../../types/image-meta';
import type { HistoryItem } from '../../../config/types';
import { createHistoryItem } from '../../factories/historyFactory';

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
  },
  lightbox: null as null | {
    visible: { value: boolean };
    item: { value: HistoryItem | null };
    hasPrev: { value: boolean };
    hasNext: { value: boolean };
  },
}));

vi.mock('../../../composables/favorites/useFavoritesData', async () => {
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
      onFavoritesScroll: favoritesDataMock.onFavoritesScroll,
      loadFirstPage: favoritesDataMock.loadFirstPage,
      loadNextPage: favoritesDataMock.loadNextPage,
    }),
  };
});

vi.mock('../../../composables/favorites/useFavoritesLightbox', async () => {
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

vi.mock('../../../composables/useHistoryViewState', async () => {
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
      setFilter: historyViewStateMock.setFilter,
      setSearchTerm: historyViewStateMock.setSearchTerm,
      reset: historyViewStateMock.reset,
      deleteHistoryItem: historyViewStateMock.deleteHistoryItem,
      detailCache: { getDetail: historyViewStateMock.getDetail },
    }),
  };
});

vi.mock('../../../composables/useHistory', async () => {
  const { ref } = await import('vue');
  mockRefs.history = {
    favoriteSet: ref(new Set<string>()),
  };

  return {
    useHistoryManager: () => ({
      favoriteSet: mockRefs.history!.favoriteSet,
      toggleFavorite: historyManagerMock.toggleFavorite,
      batchSetFavorite: historyManagerMock.batchSetFavorite,
    }),
  };
});

vi.mock('../../../composables/useConfig', async () => {
  const { ref } = await import('vue');
  return {
    useConfigManager: () => ({
      config: ref({
        linkOutput: { defaultFormat: 'url', customTemplate: '', autoCopy: false },
      }),
    }),
  };
});

vi.mock('../../../composables/useLazyLoadOnVisible', () => ({
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

function mountFavoritesView() {
  return mountWithDefaults(FavoritesView, {
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
          props: ['selectedCount', 'visible', 'availableServices'],
          emits: ['copy', 'export', 'delete', 'clear-selection', 'batch-favorite'],
          template: `
            <section v-if="visible" class="floating-action-stub">
              <button class="fab-copy" @click="$emit('copy', 'markdown')">copy</button>
              <button class="fab-delete" @click="$emit('delete')">delete</button>
              <button class="fab-favorite" @click="$emit('batch-favorite', false)">favorite</button>
            </section>
          `,
        },
      },
    },
  });
}

describe('FavoritesView P1 coverage', () => {
  beforeEach(() => {
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
    mockRefs.lightbox!.visible.value = false;
    mockRefs.lightbox!.item.value = null;
    historyViewStateMock.getDetail.mockResolvedValue(createHistoryItem({ id: 'fav-1' }));
    lightboxMock.openLightbox.mockResolvedValue(undefined);
  });

  it('shows empty state after loading an empty favorites page', () => {
    const wrapper = mountFavoritesView();

    expect(favoritesDataMock.loadFirstPage).toHaveBeenCalled();
    expect(wrapper.find('.empty-state-stub').exists()).toBe(true);
    expect(wrapper.find('.photo-item').exists()).toBe(false);
    expect(wrapper.emitted('update:totalCount')).toEqual([[0]]);
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

  it('wires selected favorites to bulk action handlers', async () => {
    mockRefs.data!.loadedMetas.value = [meta({ id: 'fav-1' })];
    mockRefs.data!.totalCount.value = 1;
    mockRefs.data!.imageStates['fav-1'] = 'loaded';
    mockRefs.viewState!.selectedIdList.value = ['fav-1'];
    mockRefs.viewState!.hasSelection.value = true;

    const wrapper = mountFavoritesView();

    await wrapper.get('.fab-copy').trigger('click');
    await wrapper.get('.fab-delete').trigger('click');
    await wrapper.get('.fab-favorite').trigger('click');

    expect(historyViewStateMock.bulkCopyFormatted).toHaveBeenCalledWith('markdown');
    expect(historyViewStateMock.bulkDelete).toHaveBeenCalled();
    expect(historyManagerMock.batchSetFavorite).toHaveBeenCalledWith(['fav-1'], false);
    expect(wrapper.emitted('update:selectedCount')).toEqual([[1]]);
  });
});

describe('FavoritePhotoItem fallback and interactions', () => {
  const item = meta({ id: 'fav-item' });

  it('tries mirror URLs before reporting a failed thumbnail', async () => {
    const wrapper = mountWithDefaults(FavoritePhotoItem, {
      props: {
        meta: item,
        thumbnailUrls: ['https://primary.example.com/a.jpg', 'https://mirror.example.com/a.jpg'],
        imageState: undefined,
        selected: false,
      },
    });

    expect(wrapper.get('img').attributes('src')).toBe('https://primary.example.com/a.jpg');

    await wrapper.get('img').trigger('error');
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toBe('https://mirror.example.com/a.jpg');
    expect(wrapper.emitted('image-state-change')).toBeUndefined();

    await wrapper.get('img').trigger('error');

    expect(wrapper.emitted('image-state-change')).toEqual([['failed']]);
  });

  it('emits item, selection, favorite, and loaded events', async () => {
    const wrapper = mountWithDefaults(FavoritePhotoItem, {
      props: {
        meta: item,
        thumbnailUrls: ['https://primary.example.com/a.jpg'],
        imageState: 'loaded',
        selected: true,
      },
    });

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
