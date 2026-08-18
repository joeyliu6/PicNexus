import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mountWithDefaults } from '../helpers/vueMount';

const { reportFailedMock, reportLoadedMock } = vi.hoisted(() => ({
  reportFailedMock: vi.fn(),
  reportLoadedMock: vi.fn(),
}));

vi.mock('@/composables/useThumbCache', () => ({
  reportThumbnailUrlFailed: reportFailedMock,
  reportThumbnailUrlLoaded: reportLoadedMock,
}));

import ThumbnailImage from '@/components/common/ThumbnailImage.vue';

describe('ThumbnailImage fallback chain', () => {
  it('tries the next image source before rendering the placeholder', async () => {
    const wrapper = mountWithDefaults(ThumbnailImage, {
      props: {
        srcs: [
          'https://cdn.example.com/broken.jpg',
          'https://cdn.example.com/fallback.jpg',
        ],
        alt: 'fallback image',
        imageClass: 'history-thumb',
      },
      slots: {
        placeholder: '<span data-testid="thumb-fallback">fallback</span>',
      },
    });

    expect(wrapper.get('img').attributes('src')).toBe('https://cdn.example.com/broken.jpg');

    await wrapper.get('img').trigger('error');
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toBe('https://cdn.example.com/fallback.jpg');
    expect(wrapper.find('[data-testid="thumb-fallback"]').exists()).toBe(false);

    await wrapper.get('img').trigger('error');
    await nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="thumb-fallback"]').text()).toBe('fallback');
  });

  it('resets the fallback index when the source list changes', async () => {
    const wrapper = mountWithDefaults(ThumbnailImage, {
      props: {
        srcs: ['https://cdn.example.com/old.jpg'],
        alt: 'changing image',
      },
    });

    await wrapper.get('img').trigger('error');
    await nextTick();
    expect(wrapper.find('.thumbnail-placeholder').exists()).toBe(true);

    await wrapper.setProps({
      srcs: ['https://cdn.example.com/new-primary.jpg', 'https://cdn.example.com/new-fallback.jpg'],
    });
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toBe('https://cdn.example.com/new-primary.jpg');
  });

  it('skips unsafe image URLs before trying the next candidate', async () => {
    const wrapper = mountWithDefaults(ThumbnailImage, {
      props: {
        srcs: [
          'javascript:alert(1)',
          'file:///tmp/local.png',
          'https://cdn.example.com/safe.jpg',
        ],
      },
    });

    expect(wrapper.get('img').attributes('src')).toBe('https://cdn.example.com/safe.jpg');
  });

  it('allows an HTTP hostname listed in confirmedHttpHosts', async () => {
    // fake-ip 逃生舱确认的是主机名，不是字面量私网 IP——不传这个 prop 就该按默认策略拒绝
    const rejecting = mountWithDefaults(ThumbnailImage, {
      props: { srcs: ['http://nas.local/img/a.jpg'] },
      slots: { placeholder: '<span data-testid="thumb-fallback">fallback</span>' },
    });
    await nextTick();
    expect(rejecting.find('img').exists()).toBe(false);
    expect(rejecting.get('[data-testid="thumb-fallback"]').text()).toBe('fallback');

    const allowing = mountWithDefaults(ThumbnailImage, {
      props: {
        srcs: ['http://nas.local/img/a.jpg'],
        confirmedHttpHosts: new Set(['nas.local']),
      },
    });
    expect(allowing.get('img').attributes('src')).toBe('http://nas.local/img/a.jpg');
  });
});

// 候选链换新 / 同内容新数组的处理判据，与 useThumbnailFallbackChain 是同一套语义。
// 下面两条与 tests/unit/composables/useThumbnailFallbackChain.spec.ts 的同类用例对照着看：
// 本组件因为多一层 safeImageUrl 过滤而独立实现，两边的判据必须同步。
describe('ThumbnailImage candidate list changes', () => {
  const PROXY = 'https://wsrv.nl/?url=https%3A%2F%2Fcdn.example.com%2Fa.png&w=75';
  const ORIGIN = 'https://cdn.example.com/a.png';
  /** 未走过 fake-ip 逃生舱确认的局域网 http，safeImageUrl 会拒 */
  const UNSAFE_HTTP = 'http://nas.local/img/webdav.png';
  const OTHER = 'https://cdn.example.com/b.png';

  beforeEach(() => {
    reportFailedMock.mockClear();
    reportLoadedMock.mockClear();
  });

  // 回归：pendingFailure 不跟着候选链一起清，就会在新链的候选加载成功时套用
  // 「前一条挂、这一条通」的判据，把上一张图的代理 URL 判死，整个会话降级成原图直连。
  it('drops the pending failure when the candidate list changes', async () => {
    const wrapper = mountWithDefaults(ThumbnailImage, {
      props: { srcs: [PROXY, ORIGIN] },
    });

    await wrapper.get('img').trigger('error');
    await nextTick();
    expect(wrapper.get('img').attributes('src')).toBe(ORIGIN);

    // 候选 1 还没出结果时，组件被复用给了另一张图
    await wrapper.setProps({ srcs: ['https://other.example.com/b.png'] });
    await nextTick();
    await wrapper.get('img').trigger('load');

    expect(reportFailedMock).not.toHaveBeenCalled();
  });

  // 回归：QueueItem 的候选每个上传进度 tick 都是一份内容相同的新数组。只比引用会把图
  // 拽回候选 0 并把 isLoading 打回 true，而 src 没变 → 浏览器不再发 load 事件 → 骨架屏卡死。
  it('keeps the settled candidate when a new array has identical content', async () => {
    const wrapper = mountWithDefaults(ThumbnailImage, {
      props: { srcs: [PROXY, ORIGIN] },
    });

    await wrapper.get('img').trigger('error');
    await nextTick();
    await wrapper.get('img').trigger('load');
    await nextTick();
    expect(wrapper.get('img').attributes('src')).toBe(ORIGIN);
    expect(wrapper.find('.thumbnail-skeleton').exists()).toBe(false);

    await wrapper.setProps({ srcs: [PROXY, ORIGIN] });
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toBe(ORIGIN);
    expect(wrapper.find('.thumbnail-skeleton').exists()).toBe(false);
  });

  // 回归：R2 降级的**主路径**。原图加载成功会触发 reportThumbnailUrlFailed，useThumbCache
  // 随即清缓存重算，候选链从 [代理, 原图] 收成 [原图]——内容变了所以 hasUrlListChanged
  // 拦不住，但首条恰好是当前已渲染的那张，src 不变 → 不会再有 load 事件 → isLoading
  // 永远停在 true。代理一挂，之后每张图都会走这条路。
  it('keeps the loaded image when the chain collapses to the already-shown URL', async () => {
    const wrapper = mountWithDefaults(ThumbnailImage, {
      props: { srcs: [PROXY, ORIGIN] },
    });

    await wrapper.get('img').trigger('error');
    await nextTick();
    await wrapper.get('img').trigger('load');
    await nextTick();
    expect(reportFailedMock).toHaveBeenCalledWith(PROXY);
    expect(wrapper.find('.thumbnail-skeleton').exists()).toBe(false);

    // 会话降级后上游只剩原图这一条候选
    await wrapper.setProps({ srcs: [ORIGIN] });
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toBe(ORIGIN);
    expect(wrapper.find('.thumbnail-skeleton').exists()).toBe(false);
  });

  // 与上一条相对：同样是「首条 URL 没变」，但图**还没加载完**，这时不能走短路——
  // 候选表刚变长，新增的候选要靠超时兜底才轮得上。短路条件漏掉 !isLoading 就会退化成
  // 「列表变长了却不重新计时」，代理卡死时永远翻不到垫底的原图。
  //
  // happy-dom 提供 IntersectionObserver 但不会触发回调，hasEnteredViewport 会一直是
  // false、从不计时；删掉它让组件走「没有 IO 就视为已在视口」的退化分支。
  it('still arms the timeout when the list grows while the first candidate is loading', async () => {
    const RealIO = globalThis.IntersectionObserver;
    Reflect.deleteProperty(globalThis, 'IntersectionObserver');
    vi.useFakeTimers();
    try {
      const wrapper = mountWithDefaults(ThumbnailImage, {
        props: { srcs: [PROXY] },
      });
      await nextTick();
      expect(wrapper.get('img').attributes('src')).toBe(PROXY);

      // 只有一条候选时不该计时——掐断最后一条只会把「慢但最终能成」变成「直接失败」
      vi.advanceTimersByTime(5000);
      await nextTick();
      expect(wrapper.get('img').attributes('src')).toBe(PROXY);

      // 补上第二条后，超时必须能把卡住的首条翻过去
      await wrapper.setProps({ srcs: [PROXY, ORIGIN] });
      await nextTick();
      vi.advanceTimersByTime(5000);
      await nextTick();

      expect(wrapper.get('img').attributes('src')).toBe(ORIGIN);
    } finally {
      vi.useRealTimers();
      globalThis.IntersectionObserver = RealIO;
    }
  });

  // 回归：被 safeImageUrl 拦下的候选**压根没发出过请求**，不能当成失败证据。
  // 此前拒绝分支直接调 handleError()，而 handleError 取的是 currentSrc——那时它还是
  // 上一条链里已经加载成功的旧图，于是旧图被记进 pendingFailure，等新链的候选加载成功
  // 就把这个无辜的服务判死（reportThumbnailUrlFailed 会把整个会话降级成原图直连）。
  // 真实触发：同一个 QueueItem 里 R2 先传完（显示代理图），WebDAV 后传完，把未确认的
  // 局域网 http 地址插到候选链首位。
  it('does not blame the previous image when a candidate is rejected by the safety filter', async () => {
    const wrapper = mountWithDefaults(ThumbnailImage, {
      props: { srcs: [PROXY, ORIGIN] },
    });
    await wrapper.get('img').trigger('load');
    await nextTick();
    reportFailedMock.mockClear();

    // 新链首位是未确认的局域网 http（会被拒），第二位是一条全新 URL
    await wrapper.setProps({ srcs: [UNSAFE_HTTP, OTHER] });
    await nextTick();
    expect(wrapper.get('img').attributes('src')).toBe(OTHER);

    await wrapper.get('img').trigger('load');
    await nextTick();

    expect(reportFailedMock).not.toHaveBeenCalled();
  });

  // 同一个拒绝分支的另一半：它也不能顺手把 isLoading 打回 true，
  // 否则会用骨架屏盖住已经显示好的图，还让「目标就是当前这张」的短路失效、白等 5 秒超时。
  it('keeps showing the loaded image while skipping a rejected candidate', async () => {
    const wrapper = mountWithDefaults(ThumbnailImage, {
      props: { srcs: [PROXY, ORIGIN] },
    });
    await wrapper.get('img').trigger('load');
    await nextTick();

    await wrapper.setProps({ srcs: [UNSAFE_HTTP, PROXY, ORIGIN] });
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toBe(PROXY);
    expect(wrapper.find('.thumbnail-skeleton').exists()).toBe(false);
  });
});
