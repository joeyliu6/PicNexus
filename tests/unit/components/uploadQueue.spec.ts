import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick, type PropType } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithDefaults, shallowMountWithDefaults } from '../helpers/vueMount';
import UploadQueue from '@/components/UploadQueue.vue';
import { useQueueState } from '@/composables/useQueueState';
import type { QueueItem } from '@/core/UploadQueue';

const copyLinkMock = vi.hoisted(() => vi.fn());
const configMock = vi.hoisted(() => ({
  availableServices: ['weibo', 'r2'],
  linkOutput: {
    defaultFormat: 'url',
  },
}));

vi.mock('@vueuse/core', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue');

  return {
    useElementSize: () => ({
      width: ref(502),
      height: ref(0),
    }),
  };
});

vi.mock('@/composables/useConfig', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue');

  return {
    useConfigManager: () => ({
      config: ref(configMock),
    }),
  };
});

vi.mock('@/composables/useCopyLink', () => ({
  useCopyLink: () => ({
    copyLink: copyLinkMock,
  }),
}));

interface UploadQueueExpose {
  addFile: (item: QueueItem) => void;
  setRetryCallback: (callback: (itemId: string, serviceId?: string) => void) => void;
}

const InlineEmptyStateStub = defineComponent({
  name: 'InlineEmptyState',
  props: {
    icon: String,
    title: String,
  },
  template: '<div class="empty-state-stub" :data-icon="icon">{{ title }}</div>',
});

const QueueCardStub = defineComponent({
  name: 'QueueCard',
  props: {
    item: {
      type: Object as PropType<QueueItem>,
      required: true,
    },
    config: {
      type: Object,
      required: true,
    },
    copiedServiceKey: {
      type: String,
      default: null,
    },
  },
  emits: ['copy', 'retry'],
  setup(props, { emit }) {
    const uploadQueueCopyKey = `upload-queue:${props.item.id}:weibo`;
    return () => h('article', {
      class: 'queue-card-stub',
      'data-id': props.item.id,
      'data-config-services': Array.isArray((props.config as typeof configMock).availableServices)
        ? (props.config as typeof configMock).availableServices.join(',')
        : '',
      'data-copied': props.copiedServiceKey === uploadQueueCopyKey ? 'true' : 'false',
    }, [
      h('button', {
        class: 'copy-button',
        onClick: () => emit('copy', {
          url: props.item.serviceProgress.weibo?.link,
          serviceId: 'weibo',
          fileName: props.item.fileName,
          format: 'markdown',
          itemId: props.item.id,
        }),
      }, 'copy'),
      h('button', {
        class: 'retry-button',
        onClick: () => emit('retry', props.item.id, 'weibo'),
      }, 'retry'),
    ]);
  },
});

const VirtualScrollerStub = defineComponent({
  name: 'VirtualScroller',
  props: {
    items: {
      type: Array as PropType<QueueItem[]>,
      required: true,
    },
    itemSize: {
      type: Number,
      required: true,
    },
  },
  setup(props, { slots }) {
    return () => h('section', {
      class: 'virtual-scroller-stub',
      'data-item-size': String(props.itemSize),
    }, props.items.map(item => slots.item?.({ item })));
  },
});

function makeItem(index: number, overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: `queue-${index}`,
    fileName: `image-${index}.jpg`,
    filePath: `/tmp/image-${index}.jpg`,
    enabledServices: ['weibo', 'r2'],
    serviceProgress: {
      weibo: {
        serviceId: 'weibo',
        progress: 100,
        status: 'done',
        link: `https://cdn.example.com/image-${index}.jpg`,
      },
      r2: {
        serviceId: 'r2',
        progress: 0,
        status: 'pending',
      },
    },
    status: 'success',
    ...overrides,
  };
}

function mountQueue(options: Parameters<typeof mountWithDefaults>[1] = {}) {
  return mountWithDefaults(UploadQueue, {
    ...options,
    global: {
      ...options.global,
      stubs: {
        InlineEmptyState: InlineEmptyStateStub,
        QueueCard: QueueCardStub,
        VirtualScroller: VirtualScrollerStub,
        ...options.global?.stubs,
      },
    },
  });
}

describe('UploadQueue', () => {
  beforeEach(() => {
    useQueueState().clearQueue();
    copyLinkMock.mockReset();
    copyLinkMock.mockResolvedValue({ ok: true, copiedCount: 1, format: 'markdown' });
  });

  it('renders the inline empty state when the queue has no items', () => {
    const wrapper = shallowMountWithDefaults(UploadQueue, {
      global: {
        stubs: {
          InlineEmptyState: InlineEmptyStateStub,
          QueueCard: QueueCardStub,
          VirtualScroller: VirtualScrollerStub,
        },
      },
    });

    expect(wrapper.get('.empty-state-stub').attributes('data-icon')).toBe('pi pi-inbox');
    expect(wrapper.get('.empty-state-stub').text()).toBe('暂无上传队列');
    expect(wrapper.find('.queue-card-stub').exists()).toBe(false);
    expect(wrapper.find('.virtual-scroller-stub').exists()).toBe(false);
  });

  it('renders a normal QueueCard list below the virtual scrolling threshold', async () => {
    const wrapper = mountQueue();
    const exposed = wrapper.vm as unknown as UploadQueueExpose;

    exposed.addFile(makeItem(1));
    exposed.addFile(makeItem(2));
    await nextTick();

    const cards = wrapper.findAll('.queue-card-stub');
    expect(cards).toHaveLength(2);
    expect(cards.map(card => card.attributes('data-id'))).toEqual(['queue-2', 'queue-1']);
    expect(cards[0].attributes('data-config-services')).toBe('weibo,r2');
    expect(wrapper.find('.virtual-scroller-stub').exists()).toBe(false);
  });

  it('switches to VirtualScroller when the queue is larger than the threshold', () => {
    useQueueState().queueItems.value = Array.from({ length: 21 }, (_, index) => makeItem(index));

    const wrapper = mountQueue();
    const scroller = wrapper.getComponent(VirtualScrollerStub);

    expect(scroller.props('items')).toHaveLength(21);
    expect(scroller.props('itemSize')).toBeGreaterThan(0);
    expect(wrapper.findAll('.queue-card-stub')).toHaveLength(21);
  });

  it('copies links through useCopyLink from QueueCard events', async () => {
    useQueueState().queueItems.value = [makeItem(1)];
    const wrapper = mountQueue();

    await wrapper.get('.copy-button').trigger('click');
    await flushPromises();

    expect(copyLinkMock).toHaveBeenCalledWith(
      {
        url: 'https://cdn.example.com/image-1.jpg',
        serviceId: 'weibo',
        fileName: 'image-1.jpg',
      },
      {
        format: 'markdown',
      },
    );
  });

  it('marks the copied channel only after a successful copy', async () => {
    useQueueState().queueItems.value = [makeItem(1)];
    const wrapper = mountQueue();

    expect(wrapper.get('.queue-card-stub').attributes('data-copied')).toBe('false');

    await wrapper.get('.copy-button').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.get('.queue-card-stub').attributes('data-copied')).toBe('true');
  });

  it('does not mark a channel copied when copyLink reports failure', async () => {
    copyLinkMock.mockResolvedValueOnce({ ok: false, copiedCount: 0, format: 'markdown', error: 'denied' });
    useQueueState().queueItems.value = [makeItem(1)];
    const wrapper = mountQueue();

    await wrapper.get('.copy-button').trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.get('.queue-card-stub').attributes('data-copied')).toBe('false');
  });

  it('passes retry events to the registered callback from virtual cards', async () => {
    useQueueState().queueItems.value = Array.from({ length: 21 }, (_, index) => makeItem(index));
    const retryCallback = vi.fn();
    const wrapper = mountQueue();
    const exposed = wrapper.vm as unknown as UploadQueueExpose;

    exposed.setRetryCallback(retryCallback);
    await wrapper.get('.retry-button').trigger('click');

    expect(retryCallback).toHaveBeenCalledWith('queue-0', 'weibo');
  });
});
