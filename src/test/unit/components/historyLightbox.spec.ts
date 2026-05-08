import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import HistoryLightbox from '../../../components/views/history/HistoryLightbox.vue';
import type { HistoryItem } from '../../../config/types';

const { bridgeState, toastWarnMock } = vi.hoisted(() => ({
  bridgeState: {
    options: null as null | {
      onLoadError?: () => void;
      onLoadSuccess?: () => void;
    },
  },
  toastWarnMock: vi.fn(),
}));

// ── Mock：PhotoSwipe 桥接（返回一个可 Teleport 的容器） ──

const mockPswpEl = document.createElement('div');
mockPswpEl.id = 'mock-pswp';
document.body.appendChild(mockPswpEl);

vi.mock('../../../composables/history/usePhotoSwipeBridge', () => ({
  usePhotoSwipeBridge: (options: {
    onLoadError?: () => void;
    onLoadSuccess?: () => void;
  }) => {
    bridgeState.options = options;
    return {
      pswpEl: ref(mockPswpEl),
      blurSrc: ref(null),
      isLoading: ref(false),
      setSwitchDirection: vi.fn(),
    };
  },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    warn: toastWarnMock,
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
    invalidateCache: vi.fn(),
  }),
}));

vi.mock('../../../composables/useCopyLink', () => ({
  useCopyLink: () => ({
    copyLink: vi.fn().mockResolvedValue({ ok: true }),
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
  return mountWithDefaults(HistoryLightbox, {
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
        Transition: true,
      },
    },
  });
}

describe('HistoryLightbox', () => {
  /** 每次测试前清空 Teleport 容器 */
  beforeEach(() => {
    mockPswpEl.innerHTML = '';
    bridgeState.options = null;
    toastWarnMock.mockClear();
  });

  /** 底栏通过 Teleport 渲染到 mockPswpEl，需在 DOM 中查找 */
  function findInTeleport(selector: string) {
    return mockPswpEl.querySelector(selector);
  }

  function findAllInTeleport(selector: string) {
    return mockPswpEl.querySelectorAll(selector);
  }

  it('renders bottom bar with successful services info', () => {
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

    const sourceCell = findInTeleport('.cell-source');
    expect(sourceCell).not.toBeNull();
    expect(sourceCell!.textContent).toContain('已传图床');
    // 不应存在失败图床列
    expect(findInTeleport('.cell-failed')).toBeNull();
  });

  it('does not show mirror menu and calls copyLink directly for single service', async () => {
    const wrapper = mountLightbox(makeHistoryItem([
      {
        serviceId: 'jd',
        status: 'success',
        result: { serviceId: 'jd', fileKey: 'key-1', url: 'https://example.com/jd.jpg' },
      },
    ]));

    // 单图床点击后不弹菜单，直接调用 handleCopyLink
    const copyBtn = findInTeleport('.copy-btn-wrapper .action-btn') as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();
    await copyBtn.click();
    await wrapper.vm.$nextTick();

    expect(findInTeleport('.mirror-menu-popup')).toBeNull();
  });

  it('shows unified mirror menu when multiple services succeed', async () => {
    const wrapper = mountLightbox(makeHistoryItem([
      {
        serviceId: 'jd',
        status: 'success',
        result: { serviceId: 'jd', fileKey: 'key-1', url: 'https://example.com/jd.jpg' },
      },
      {
        serviceId: 'weibo',
        status: 'success',
        result: { serviceId: 'weibo', fileKey: 'key-2', url: 'https://example.com/weibo.jpg' },
      },
    ]));

    // 点击复制按钮应弹出统一镜像菜单
    const copyBtn = findInTeleport('.copy-btn-wrapper .action-btn') as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();
    await copyBtn.click();
    await wrapper.vm.$nextTick();

    const mirrorRows = findAllInTeleport('.mirror-menu-popup .mirror-row');
    expect(mirrorRows.length).toBe(2);
  });

  it('invokes handleCopyServiceLink and closes menu when clicking a mirror row', async () => {
    const wrapper = mountLightbox(makeHistoryItem([
      {
        serviceId: 'jd',
        status: 'success',
        result: { serviceId: 'jd', fileKey: 'key-1', url: 'https://example.com/jd.jpg' },
      },
      {
        serviceId: 'weibo',
        status: 'success',
        result: { serviceId: 'weibo', fileKey: 'key-2', url: 'https://example.com/weibo.jpg' },
      },
    ]));

    // 打开菜单
    const copyBtn = findInTeleport('.copy-btn-wrapper .action-btn') as HTMLButtonElement;
    await copyBtn.click();
    await wrapper.vm.$nextTick();

    // 点击第一行镜像，整行点击即触发复制
    const firstRow = findInTeleport('.mirror-menu-popup .mirror-row') as HTMLElement;
    expect(firstRow).not.toBeNull();
    await firstRow.click();
    await wrapper.vm.$nextTick();

    // 菜单应已关闭
    expect(findInTeleport('.mirror-menu-popup')).toBeNull();
  });

  it('marks only the current primary service as failed after a lightbox load error', async () => {
    const wrapper = mountLightbox({
      ...makeHistoryItem([
        {
          serviceId: 'weibo',
          status: 'success',
          result: { serviceId: 'weibo', fileKey: 'pid-1', url: 'https://example.com/weibo.jpg' },
        },
        {
          serviceId: 'jd',
          status: 'success',
          result: { serviceId: 'jd', fileKey: 'key-1', url: 'https://example.com/jd.jpg' },
        },
      ]),
      primaryService: 'weibo',
    });

    bridgeState.options?.onLoadError?.();
    await wrapper.vm.$nextTick();

    expect(toastWarnMock).toHaveBeenCalledWith(
      '微博 图片加载失败',
      expect.stringContaining('手动切换图床'),
    );
    expect(findInTeleport('.action-btn-dot')).not.toBeNull();

    const copyBtn = findInTeleport('.copy-btn-wrapper .action-btn') as HTMLButtonElement;
    await copyBtn.click();
    await wrapper.vm.$nextTick();

    const menu = findInTeleport('.mirror-menu-popup') as HTMLElement;
    expect(menu.textContent).toContain('微博 本次加载失败');
    expect(menu.textContent).toContain('本次失败');

    bridgeState.options?.onLoadSuccess?.();
    await wrapper.vm.$nextTick();
    expect(findInTeleport('.action-btn-dot')).toBeNull();
  });
});
