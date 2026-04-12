import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import HistoryLightbox from '../../../components/views/history/HistoryLightbox.vue';
import type { HistoryItem } from '../../../config/types';

// ── Mock：PhotoSwipe 桥接（返回一个可 Teleport 的容器） ──

const mockPswpEl = document.createElement('div');
mockPswpEl.id = 'mock-pswp';
document.body.appendChild(mockPswpEl);

vi.mock('../../../composables/history/usePhotoSwipeBridge', () => ({
  usePhotoSwipeBridge: () => ({
    pswpEl: ref(mockPswpEl),
  }),
}));

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

vi.mock('../../../composables/useHistory', () => ({
  useHistoryManager: () => ({
    favoriteSet: ref(new Set<string>()),
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
        Teleport: false,
      },
    },
  });
}

describe('HistoryLightbox', () => {
  /** 每次测试前清空 Teleport 容器 */
  beforeEach(() => { mockPswpEl.innerHTML = ''; });

  /** 底栏通过 Teleport 渲染到 mockPswpEl，需在 DOM 中查找 */
  function findInTeleport(selector: string) {
    return mockPswpEl.querySelector(selector);
  }

  it('shows failed services with normalized tooltip content', () => {
    mountLightbox(makeHistoryItem([
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

    const failedCell = findInTeleport('.cell-failed');
    expect(failedCell).not.toBeNull();
    expect(failedCell!.textContent).toContain('又拍云');
    expect(failedCell!.textContent).toContain('失败图床');
    expect(failedCell!.getAttribute('data-tooltip')).toBe('又拍云：service error');
  });

  it('does not render failed service section when all services succeed', () => {
    mountLightbox(makeHistoryItem([
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

    expect(findInTeleport('.cell-failed')).toBeNull();
  });
});
