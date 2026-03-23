import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import HistoryLightbox from '../../../components/views/history/HistoryLightbox.vue';
import type { HistoryItem } from '../../../config/types';

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    config: ref({}),
  }),
}));

vi.mock('../../../composables/useCopyLink', () => ({
  useCopyLink: () => ({
    copyLink: vi.fn(),
    applyPrefix: (url: string) => url,
  }),
}));

vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({
    confirmDelete: vi.fn(),
  }),
}));

vi.mock('../../../utils/imageUrl', () => ({
  getPrimaryImageUrl: () => 'https://example.com/image.jpg',
}));

const tooltipDirective = {
  mounted(el: HTMLElement, binding: { value?: string | null }) {
    if (binding.value) {
      el.setAttribute('data-tooltip', String(binding.value));
    }
  },
  updated(el: HTMLElement, binding: { value?: string | null }) {
    if (binding.value) {
      el.setAttribute('data-tooltip', String(binding.value));
    } else {
      el.removeAttribute('data-tooltip');
    }
  },
};

function makeHistoryItem(results: HistoryItem['results']): HistoryItem {
  return {
    id: 'history-1',
    timestamp: 1710000000000,
    localFileName: 'test.jpg',
    filePath: '/tmp/test.jpg',
    primaryService: 'jd',
    generatedLink: 'https://example.com/image.jpg',
    results,
    width: 1200,
    height: 800,
    aspectRatio: 1.5,
    fileSize: 1024,
    format: 'jpg',
  };
}

function mountLightbox(item: HistoryItem) {
  return mount(HistoryLightbox, {
    props: {
      visible: true,
      item,
    },
    global: {
      directives: {
        tooltip: tooltipDirective,
      },
      stubs: {
        Teleport: true,
        Transition: false,
      },
    },
  });
}

describe('HistoryLightbox', () => {
  it('shows failed services with normalized tooltip content', () => {
    const wrapper = mountLightbox(makeHistoryItem([
      {
        serviceId: 'jd',
        status: 'success',
        result: {
          serviceId: 'jd',
          fileKey: 'key-1',
          url: 'https://example.com/success.jpg',
        },
      },
      {
        serviceId: 'upyun',
        status: 'failed',
        error: 'upyun 上传失败: 又拍云上传失败: 上传失败: service error',
      },
    ]));

    const failedCell = wrapper.find('.cell-failed');
    expect(failedCell.exists()).toBe(true);
    expect(failedCell.text()).toContain('又拍云');
    expect(failedCell.text()).toContain('失败图床');
    expect(failedCell.attributes('data-tooltip')).toBe('又拍云：service error');
  });

  it('does not render failed service section when all services succeed', () => {
    const wrapper = mountLightbox(makeHistoryItem([
      {
        serviceId: 'jd',
        status: 'success',
        result: {
          serviceId: 'jd',
          fileKey: 'key-1',
          url: 'https://example.com/success.jpg',
        },
      },
    ]));

    expect(wrapper.find('.cell-failed').exists()).toBe(false);
  });
});
