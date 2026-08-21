import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import {
  reportThumbnailUrlFailed,
  resetProxyReachabilityForTest,
} from '@/composables/useThumbCache';
import { mountWithDefaults } from '../helpers/vueMount';
import HistoryLightbox from '@/components/views/history/HistoryLightbox.vue';
import type { HistoryItem } from '@/config/types';

const { bridgeState, toastWarnMock, primaryUrl } = vi.hoisted(() => ({
  bridgeState: {
    options: null as null | {
      onLoadError?: () => void;
      onLoadSuccess?: () => void;
      imageSrc?: { value: string };
      mediumSrc?: { value: string };
    },
  },
  toastWarnMock: vi.fn(),
  // 可改写：安全闸的用例要喂不同协议 / 主机的地址
  primaryUrl: { value: 'https://example.com/image.jpg' },
}));

// ── Mock：PhotoSwipe 桥接（返回一个可 Teleport 的容器） ──

const mockPswpEl = document.createElement('div');
mockPswpEl.id = 'mock-pswp';
document.body.appendChild(mockPswpEl);

vi.mock('@/composables/history/usePhotoSwipeBridge', () => ({
  usePhotoSwipeBridge: (options: {
    onLoadError?: () => void;
    onLoadSuccess?: () => void;
    imageSrc?: { value: string };
    mediumSrc?: { value: string };
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

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    warn: toastWarnMock,
    error: vi.fn(),
  }),
}));

vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({
    config: ref({}),
  }),
}));

vi.mock('@/composables/useHistory', () => ({
  useHistoryManager: () => ({
    favoriteSet: ref(new Set<string>()),
    invalidateCache: vi.fn(),
  }),
}));

vi.mock('@/composables/useCopyLink', () => ({
  useCopyLink: () => ({
    copyLink: vi.fn().mockResolvedValue({ ok: true }),
    applyPrefix: (url: string) => url,
  }),
}));

vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({
    confirmDelete: vi.fn(),
  }),
}));

vi.mock('@/utils/imageUrl', () => ({
  getPrimaryImageUrl: () => primaryUrl.value,
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

function mountLightbox(item: HistoryItem, confirmedHttpHosts?: ReadonlySet<string>) {
  return mountWithDefaults(HistoryLightbox, {
    props: {
      visible: true,
      item,
      confirmedHttpHosts,
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
    primaryUrl.value = 'https://example.com/image.jpg';
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

  // ─── LQIP 中图跟随会话降级 ───────────────────────────────────────────────
  //
  // 回归：mediumSrc 曾直接调 generateMediumThumbnailUrl，那个函数不看会话降级状态。
  // 结果时间轴/收藏页/表格预览都降级成原图后，唯独灯箱的模糊占位和 PhotoSwipe msrc
  // 还在请求代理死链。所有取「单条 URL」的入口都必须从候选链取首条。
  describe('R2 代理降级', () => {
    afterEach(() => {
      // proxyReachable 是模块级会话状态，不重置会污染同文件其他用例
      resetProxyReachabilityForTest();
    });

    function makeR2Item(): HistoryItem {
      const item = makeHistoryItem([
        {
          serviceId: 'r2',
          status: 'success',
          result: { url: 'https://cdn.example.com/a.png' },
        } as HistoryItem['results'][number],
      ]);
      item.primaryService = 'r2';
      return item;
    }

    it('默认走代理', () => {
      mountLightbox(makeR2Item());
      expect(bridgeState.options?.mediumSrc?.value).toContain('wsrv.nl');
    });

    it('会话降级后改用原图', async () => {
      mountLightbox(makeR2Item());
      const proxyUrl = bridgeState.options!.mediumSrc!.value;
      expect(proxyUrl).toContain('wsrv.nl');

      reportThumbnailUrlFailed(proxyUrl);
      await nextTick();

      expect(bridgeState.options?.mediumSrc?.value).toBe('https://cdn.example.com/a.png');
    });
  });
  /**
   * CSP 的 `img-src` 放开 `http:` 之后（2ab296af），灯箱身上就没有闸了：
   * 在那之前私网 / 云元数据 / 未确认明文 HTTP 全靠 CSP 挡。这组用例钉住
   * 「灯箱与缩略图用同一份判据」，任何人把 safeImageUrl 摘掉都会红。
   */
  describe('URL 安全闸', () => {
    const blockedItem = () => makeHistoryItem([
      { serviceId: 'jd', status: 'success', result: { serviceId: 'jd', fileKey: 'k', url: 'x' } },
    ]);

    it('未确认的明文 HTTP 域名不进 PhotoSwipe，且给出可执行的解释', async () => {
      primaryUrl.value = 'http://cdn.example.com/a.png';

      mountLightbox(blockedItem());
      await nextTick();

      expect(bridgeState.options?.imageSrc?.value).toBe('');
      expect(toastWarnMock).toHaveBeenCalledTimes(1);
      // 只说「加载失败」等于没说；必须指向设置页的那一步操作
      expect(String(toastWarnMock.mock.calls[0][1])).toContain('测试连接');
    });

    it('用户确认过的那个主机名照常放行', async () => {
      primaryUrl.value = 'http://cdn.example.com/a.png';

      mountLightbox(blockedItem(), new Set(['cdn.example.com']));
      await nextTick();

      expect(bridgeState.options?.imageSrc?.value).toBe('http://cdn.example.com/a.png');
      expect(toastWarnMock).not.toHaveBeenCalled();
    });

    /**
     * 确认名单是按主机名存的，所以它只能担保**那一个**主机。
     * 拿它给云元数据地址开门是这道闸最不能出的错——169.254.169.254 上挂着密钥。
     */
    it('云元数据地址即使在确认名单里也照拦', async () => {
      primaryUrl.value = 'http://169.254.169.254/latest/meta-data/';

      mountLightbox(blockedItem(), new Set(['169.254.169.254']));
      await nextTick();

      expect(bridgeState.options?.imageSrc?.value).toBe('');
      expect(toastWarnMock).toHaveBeenCalled();
    });

    it('局域网 HTTP 地址放行（NAS / 自建 WebDAV 图床的常见形态）', async () => {
      primaryUrl.value = 'http://192.168.1.10:5244/pic.png';

      mountLightbox(blockedItem());
      await nextTick();

      expect(bridgeState.options?.imageSrc?.value).toBe('http://192.168.1.10:5244/pic.png');
      expect(toastWarnMock).not.toHaveBeenCalled();
    });

    it('地址正常时不弹解释（避免把安全提示变成背景噪音）', async () => {
      mountLightbox(blockedItem());
      await nextTick();

      expect(toastWarnMock).not.toHaveBeenCalled();
    });
  });
});
