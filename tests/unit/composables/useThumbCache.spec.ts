import { beforeEach, describe, it, expect, vi } from 'vitest';
import { computed, nextTick } from 'vue';

const { cacheEventHandlers } = vi.hoisted(() => ({
  cacheEventHandlers: {} as Record<string, (data?: unknown) => void>,
}));

vi.mock('@/events/cacheEvents', () => ({
  onCacheEventType: vi.fn(async (type: string, handler: (data?: unknown) => void) => {
    cacheEventHandlers[type] = handler;
    return vi.fn();
  }),
}));

vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({
    config: { value: {} },
  }),
}));
import {
  generateThumbnailUrl,
  generateMediumThumbnailUrl,
  getMetaThumbnailUrl,
  getMetaThumbnailCandidates,
  getThumbnailCandidates,
  useThumbCache,
  reportThumbnailUrlFailed,
  reportThumbnailUrlLoaded,
  resetProxyReachabilityForTest,
} from '@/composables/useThumbCache';
import type { UserConfig } from '@/config/types';
import type { ImageMeta } from '@/types/image-meta';

beforeEach(() => {
  cacheEventHandlers['history-cleared']?.();
  // proxyReachable 是模块级会话状态，不重置会跨用例污染
  resetProxyReachabilityForTest();
});

describe('generateThumbnailUrl', () => {
  it('weibo + fileKey → thumb150 URL', () => {
    expect(generateThumbnailUrl('weibo', 'http://ignored', 'abc123'))
      .toBe('https://tvax1.sinaimg.cn/thumb150/abc123.jpg');
  });

  it('weibo 无 fileKey → 回退原图', () => {
    expect(generateThumbnailUrl('weibo', 'http://orig.com/a.jpg')).toBe('http://orig.com/a.jpg');
  });

  it('r2 缺省 → 走代理（老配置没这个字段，缺省要落到「开」）', () => {
    const url = 'https://cdn.example.com/a.png';
    expect(generateThumbnailUrl('r2', url)).toContain('wsrv.nl');
  });

  it('r2 关闭代理 → 直连原图', () => {
    const url = 'https://cdn.example.com/a.png';
    const config = { services: { r2: { thumbnailProxyEnabled: false } } } as unknown as UserConfig;
    expect(generateThumbnailUrl('r2', url, undefined, config)).toBe(url);
  });

  it('r2 开启代理 → 走 wsrv.nl', () => {
    const url = 'https://cdn.example.com/a.png';
    const config = { services: { r2: { thumbnailProxyEnabled: true } } } as unknown as UserConfig;
    const out = generateThumbnailUrl('r2', url, undefined, config);
    expect(out).toContain('wsrv.nl');
    expect(out).toContain(encodeURIComponent(url));
    expect(out).toContain('w=75');
  });

  it('jd → 替换 /jfs/ 为 /s76x76_jfs/', () => {
    expect(generateThumbnailUrl('jd', 'https://img.jd.com/jfs/a.png'))
      .toBe('https://img.jd.com/s76x76_jfs/a.png');
  });

  it('zhihu → 在扩展名前加 _xs', () => {
    expect(generateThumbnailUrl('zhihu', 'https://pic.zhihu.com/a.jpg'))
      .toBe('https://pic.zhihu.com/a_xs.jpg');
  });

  it('qiyu → 加 imageView thumbnail=50x0', () => {
    expect(generateThumbnailUrl('qiyu', 'https://q.yu/a.jpg'))
      .toBe('https://q.yu/a.jpg?imageView&thumbnail=50x0');
  });

  it('nami → x-tos-process 参数', () => {
    const out = generateThumbnailUrl('nami', 'https://nami/a.jpg');
    expect(out).toContain('x-tos-process=image/resize');
    expect(out).toContain('l_75');
  });

  it('nowcoder → x-oss-process 参数', () => {
    const out = generateThumbnailUrl('nowcoder', 'https://nowcoder/a.png');
    expect(out).toContain('x-oss-process');
    expect(out).toContain('w_75');
  });

  it('bilibili → 添加 @75w_75h_1c_80q.webp', () => {
    expect(generateThumbnailUrl('bilibili', 'https://i0.hdslb.com/a.png'))
      .toBe('https://i0.hdslb.com/a.png@75w_75h_1c_80q.webp');
  });

  it('chaoxing → 替换域名 + 缩略名', () => {
    const url = 'https://p.cldisk.com/star4/hash/origin.jpg';
    expect(generateThumbnailUrl('chaoxing', url))
      .toBe('https://p.ananas.chaoxing.com/star4/hash/75_0cQ80.webp');
  });

  it('未知图床 → 返回原 URL', () => {
    expect(generateThumbnailUrl('unknown', 'http://x')).toBe('http://x');
  });
});

describe('generateMediumThumbnailUrl', () => {
  it('weibo + fileKey → mw690', () => {
    expect(generateMediumThumbnailUrl('weibo', 'ignored', 'abc'))
      .toBe('https://tvax1.sinaimg.cn/mw690/abc.jpg');
  });

  it('weibo 无 fileKey → 原 URL', () => {
    expect(generateMediumThumbnailUrl('weibo', 'http://orig')).toBe('http://orig');
  });

  it('r2 缺省 → 走代理', () => {
    expect(generateMediumThumbnailUrl('r2', 'http://x')).toContain('wsrv.nl');
  });

  it('r2 关闭代理 → 直连原图', () => {
    const config = { services: { r2: { thumbnailProxyEnabled: false } } } as unknown as UserConfig;
    expect(generateMediumThumbnailUrl('r2', 'http://x', undefined, config)).toBe('http://x');
  });

  it('r2 开启代理 → wsrv w=800', () => {
    const config = { services: { r2: { thumbnailProxyEnabled: true } } } as unknown as UserConfig;
    const out = generateMediumThumbnailUrl('r2', 'http://x', undefined, config);
    expect(out).toContain('wsrv.nl');
    expect(out).toContain('w=800');
  });

  it('jd → s500x0_jfs', () => {
    expect(generateMediumThumbnailUrl('jd', 'https://img/jfs/a.png'))
      .toBe('https://img/s500x0_jfs/a.png');
  });

  it('zhihu → _qhd', () => {
    expect(generateMediumThumbnailUrl('zhihu', 'https://zhihu/a.jpg'))
      .toBe('https://zhihu/a_qhd.jpg');
  });

  it('bilibili → @800w_80q', () => {
    expect(generateMediumThumbnailUrl('bilibili', 'https://b/a.png'))
      .toBe('https://b/a.png@800w_80q.webp');
  });

  it('chaoxing → 800_0cQ80.webp', () => {
    expect(generateMediumThumbnailUrl('chaoxing', 'https://p.cldisk.com/s/h/origin.jpg'))
      .toBe('https://p.ananas.chaoxing.com/s/h/800_0cQ80.webp');
  });

  it('未知图床 → 原 URL', () => {
    expect(generateMediumThumbnailUrl('unknown', 'http://x')).toBe('http://x');
  });
});

describe('getMetaThumbnailUrl', () => {
  it('委托给 generateMediumThumbnailUrl', () => {
    const meta: ImageMeta = {
      id: '1',
      timestamp: 0,
      localFileName: 'a.png',
      aspectRatio: 1,
      primaryService: 'zhihu',
      primaryUrl: 'https://zhihu/a.jpg',
    } as ImageMeta;
    expect(getMetaThumbnailUrl(meta, null)).toBe('https://zhihu/a_qhd.jpg');
  });
});

describe('getMetaThumbnailCandidates', () => {
  function makeMeta(overrides: Partial<ImageMeta> = {}): ImageMeta {
    return {
      id: 'm1',
      timestamp: 0,
      localFileName: 'a.png',
      aspectRatio: 1,
      primaryService: 'zhihu',
      primaryUrl: 'https://pic.zhimg.com/a.jpg',
      mirrorServices: [
        { serviceId: 'zhihu', url: 'https://pic.zhimg.com/a.jpg' },
        { serviceId: 'jd', url: 'https://img.jd.com/jfs/b.jpg' },
      ],
      ...overrides,
    } as ImageMeta;
  }

  function makeConfig(overrides: Record<string, unknown> = {}): UserConfig {
    return {
      services: { zhihu: { sourceParamEnabled: true, sourceParamValue: 'aaa111' } },
      ...overrides,
    } as unknown as UserConfig;
  }

  it('按镜像顺序生成中等尺寸候选并去重', () => {
    const meta = makeMeta({
      mirrorServices: [
        { serviceId: 'jd', url: 'https://img.jd.com/jfs/b.jpg' },
        { serviceId: 'jd', url: 'https://img.jd.com/jfs/b.jpg' },
      ],
    } as Partial<ImageMeta>);
    expect(getMetaThumbnailCandidates(meta, null)).toEqual([
      'https://img.jd.com/s500x0_jfs/b.jpg',
    ]);
  });

  it('无 mirrorServices 时降级到主图单条', () => {
    const meta = makeMeta({ mirrorServices: undefined });
    expect(getMetaThumbnailCandidates(meta, null)).toEqual([
      'https://pic.zhimg.com/a_qhd.jpg?source=172ae18b',
    ]);
  });

  // 以下三条固化「引用稳定性契约」：模板逐行调用本函数，引用抖动会让子组件全量 re-render，
  // 后续抽 useMirrorSrcFallback 时也要依赖这个契约来判断 fallback 索引该不该重置
  it('同一个 meta + 同一份配置返回同一个数组引用', () => {
    const meta = makeMeta();
    const config = makeConfig();
    const first = getMetaThumbnailCandidates(meta, config);
    const second = getMetaThumbnailCandidates(meta, config);
    expect(second).toBe(first);
  });

  it('配置指纹变化后重算（改知乎 source 值）', () => {
    const meta = makeMeta();
    const first = getMetaThumbnailCandidates(meta, makeConfig());
    const second = getMetaThumbnailCandidates(
      meta,
      makeConfig({ services: { zhihu: { sourceParamEnabled: true, sourceParamValue: 'bbb222' } } }),
    );
    expect(second).not.toBe(first);
    expect(first[0]).toContain('source=aaa111');
    expect(second[0]).toContain('source=bbb222');
  });

  // 时间轴/收藏页从不调用 useThumbCache()，拿不到 initModuleWatchers 里那批 watch，
  // 只靠指纹失效。R2 代理开关漏进指纹的话，那两个页面切完开关缩略图永远不变。
  it('配置指纹变化后重算（切换 R2 缩略图代理开关）', () => {
    const meta = makeMeta({
      primaryService: 'r2',
      primaryUrl: 'https://cdn.example.com/a.png',
      mirrorServices: [{ serviceId: 'r2', url: 'https://cdn.example.com/a.png' }],
    } as Partial<ImageMeta>);

    const off = getMetaThumbnailCandidates(
      meta,
      makeConfig({ services: { r2: { thumbnailProxyEnabled: false } } }),
    );
    const on = getMetaThumbnailCandidates(
      meta,
      makeConfig({ services: { r2: { thumbnailProxyEnabled: true } } }),
    );

    expect(on).not.toBe(off);
    expect(off[0]).toBe('https://cdn.example.com/a.png');
    expect(on[0]).toContain('wsrv.nl');
  });

  // 现有 watch 只盯 linkPrefixConfig 的 enabled / selectedIndex，
  // 改模板内容那两项都不变——指纹取 template 本身才能兜住
  it('配置指纹变化后重算（只改选中前缀的模板内容）', () => {
    const meta = makeMeta({
      mirrorServices: [{ serviceId: 'weibo', url: 'https://ignored', fileKey: 'abc123' }],
    } as Partial<ImageMeta>);
    const withPrefix = (template: string) => makeConfig({
      linkPrefixConfig: { enabled: true, selectedIndex: 0, prefixList: [{ name: 'p', template }] },
    });

    const first = getMetaThumbnailCandidates(meta, withPrefix('https://p1.example.com/{url}'));
    const second = getMetaThumbnailCandidates(meta, withPrefix('https://p2.example.com/{url}'));

    expect(second).not.toBe(first);
    expect(first[0]).toContain('p1.example.com');
    expect(second[0]).toContain('p2.example.com');
  });

  // 切主图床 / 移除链接都会写 DB 并让视图重查，rowToImageMeta 产出新对象，
  // 所以「新 meta 对象」就是镜像变化的失效信号，不需要额外接事件
  it('换新的 meta 对象（模拟镜像变化后重查 DB）重算', () => {
    const config = makeConfig();
    const before = getMetaThumbnailCandidates(makeMeta(), config);
    const after = getMetaThumbnailCandidates(
      makeMeta({ mirrorServices: [{ serviceId: 'jd', url: 'https://img.jd.com/jfs/b.jpg' }] } as Partial<ImageMeta>),
      config,
    );
    expect(after).not.toBe(before);
    expect(before).toHaveLength(2);
    expect(after).toHaveLength(1);
  });
});

describe('getThumbnailCandidates', () => {
  it('HistoryItem - 主力图床优先', () => {
    const item: any = {
      id: 'h1',
      primaryService: 'weibo',
      results: [
        { serviceId: 'weibo', status: 'success', result: { url: 'http://weibo', fileKey: 'abc' } },
        { serviceId: 'r2', status: 'success', result: { url: 'http://r2' } },
      ],
    };
    const candidates = getThumbnailCandidates(item, null);
    // weibo 主力 → 首个为 sinaimg 缩略图
    expect(candidates[0]).toContain('sinaimg');
    // weibo 1 条 + r2 2 条（代理 + 原图兜底，config 为 null 时代理按缺省算「开」）
    expect(candidates.length).toBe(3);
  });

  it('HistoryItem - 缓存命中后返回相同结果', () => {
    const item: any = {
      id: 'h-cache',
      primaryService: 'weibo',
      results: [{ serviceId: 'weibo', status: 'success', result: { url: 'http://x', fileKey: 'k' } }],
    };
    const first = getThumbnailCandidates(item, null);
    const second = getThumbnailCandidates(item, null);
    expect(first).toEqual(second);
  });

  it('HistoryItem - history-updated invalidates cached candidates for the changed item', () => {
    useThumbCache();
    const item: any = {
      id: 'h-updated',
      primaryService: 'r2',
      results: [
        { serviceId: 'r2', status: 'success', result: { url: 'http://r2' } },
      ],
    };

    // r2 单服务 = 2 条（代理 + 原图兜底）
    expect(getThumbnailCandidates(item, null)).toHaveLength(2);
    item.results.push({ serviceId: 'weibo', status: 'success', result: { url: 'http://weibo', fileKey: 'pid' } });
    // 缓存未失效，仍是旧的 2 条
    expect(getThumbnailCandidates(item, null)).toHaveLength(2);

    cacheEventHandlers['history-updated']?.({ ids: ['h-updated'] });

    // 失效后重算：r2 2 条 + weibo 1 条
    expect(getThumbnailCandidates(item, null)).toHaveLength(3);
  });

  it('HistoryItem - 失败 / 无 url 的结果被忽略', () => {
    const item: any = {
      id: 'h2',
      primaryService: 'weibo',
      results: [
        { serviceId: 'weibo', status: 'failed' },
        { serviceId: 'r2', status: 'success', result: { url: '' } },
      ],
    };
    expect(getThumbnailCandidates(item, null)).toEqual([]);
  });

  it('QueueItem - 按 enabledServices 顺序取成功的 link', () => {
    const item: any = {
      id: 'q1',
      enabledServices: ['weibo', 'r2'],
      serviceProgress: {
        weibo: { status: 'success', link: 'http://w' },
        r2: { status: '上传完成 ✓', link: 'http://r' },
      },
    };
    const candidates = getThumbnailCandidates(item, null);
    // weibo 1 条 + r2 2 条（代理 + 原图兜底）
    expect(candidates).toHaveLength(3);
  });

  it('QueueItem - weibo 从 metadata.pid 提取 fileKey', () => {
    const item: any = {
      id: 'q-weibo',
      enabledServices: ['weibo'],
      serviceProgress: {
        weibo: { status: 'success', link: 'http://w', metadata: { pid: 'pid-from-meta' } },
      },
    };
    const candidates = getThumbnailCandidates(item, null);
    expect(candidates[0]).toContain('pid-from-meta');
  });

  it('QueueItem - weibo 无 metadata.pid 时从根 weiboPid 取', () => {
    const item: any = {
      id: 'q-weibo2',
      enabledServices: ['weibo'],
      weiboPid: 'root-pid',
      serviceProgress: {
        weibo: { status: 'success', link: 'http://w' },
      },
    };
    const candidates = getThumbnailCandidates(item, null);
    expect(candidates[0]).toContain('root-pid');
  });

  it('去重：两个"未知"图床产生相同 URL 时只保留一个', () => {
    const item: any = {
      id: 'h-dup',
      primaryService: 'custom_a',
      results: [
        { serviceId: 'custom_a', status: 'success', result: { url: 'http://same' } },
        { serviceId: 'custom_b', status: 'success', result: { url: 'http://same' } },
      ],
    };
    const candidates = getThumbnailCandidates(item, null);
    expect(candidates).toHaveLength(1);
  });

  it('QueueItem - status.includes(完成) 也被视为成功', () => {
    const item: any = {
      id: 'q-text',
      enabledServices: ['r2'],
      serviceProgress: {
        r2: { status: '上传完成', link: 'http://r' },
      },
    };
    const candidates = getThumbnailCandidates(item, null);
    // r2 单服务 = 2 条（代理 + 原图兜底）
    expect(candidates).toHaveLength(2);
  });

  // === R2 候选链兜底：issue #4 症状② 的回归护栏 ===
  // 代理链路不通时组件靠 onerror/超时往后翻，所以原图必须真的排在代理后面。

  it('R2 开代理 → 候选链是 [代理, 原图]，原图垫底兜住第三方失效', () => {
    const config = { services: { r2: { thumbnailProxyEnabled: true } } } as unknown as UserConfig;
    const item: any = {
      id: 'h-r2-proxy-on',
      primaryService: 'r2',
      results: [{ serviceId: 'r2', status: 'success', result: { url: 'https://cdn.example.com/a.png' } }],
    };
    const candidates = getThumbnailCandidates(item, config);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toContain('wsrv.nl');
    expect(candidates[1]).toBe('https://cdn.example.com/a.png');
  });

  it('R2 关代理 → 只有原图一条，不把地址交给第三方', () => {
    const config = { services: { r2: { thumbnailProxyEnabled: false } } } as unknown as UserConfig;
    const item: any = {
      id: 'h-r2-proxy-off',
      primaryService: 'r2',
      results: [{ serviceId: 'r2', status: 'success', result: { url: 'https://cdn.example.com/a.png' } }],
    };
    const candidates = getThumbnailCandidates(item, config);
    expect(candidates).toEqual(['https://cdn.example.com/a.png']);
  });

  it('非 R2 图床不加兜底条目（缩略图与原图同源，多塞一条只会多等一轮超时）', () => {
    const item: any = {
      id: 'h-bilibili',
      primaryService: 'bilibili',
      results: [{ serviceId: 'bilibili', status: 'success', result: { url: 'https://i0.hdslb.com/a.png' } }],
    };
    expect(getThumbnailCandidates(item, null)).toHaveLength(1);
  });
});

// === 会话级代理可达性探测 ===
// wsrv.nl 在境内直连不通。若每张图都先试代理再等满超时，滚动时每屏空等 5 秒，
// 比不用代理还糟。第一张试出不通就整个会话降级，后续直接出原图。
describe('代理可达性探测', () => {
  function makeR2Item(id: string) {
    return {
      id,
      primaryService: 'r2',
      results: [{ serviceId: 'r2', status: 'success', result: { url: 'https://cdn.example.com/a.png' } }],
    } as any;
  }

  it('代理条目失败后，后续候选不再产出代理条目', () => {
    const before = getThumbnailCandidates(makeR2Item('h-probe-1'), null);
    expect(before).toHaveLength(2);
    expect(before[0]).toContain('wsrv.nl');

    reportThumbnailUrlFailed(before[0]);

    // 换个 id 避开候选缓存，验证新生成的链路已经不含代理
    expect(getThumbnailCandidates(makeR2Item('h-probe-2'), null))
      .toEqual(['https://cdn.example.com/a.png']);
  });

  it('降级后清掉已有候选缓存，同一条记录再取也不会拿到旧的代理链', () => {
    const item = makeR2Item('h-probe-cached');
    const before = getThumbnailCandidates(item, null);
    expect(before).toHaveLength(2);

    reportThumbnailUrlFailed(before[0]);

    expect(getThumbnailCandidates(item, null)).toEqual(['https://cdn.example.com/a.png']);
  });

  it('非代理 URL 失败不触发降级（那是单张图自己的问题）', () => {
    reportThumbnailUrlFailed('https://cdn.example.com/missing.png');
    expect(getThumbnailCandidates(makeR2Item('h-probe-3'), null)).toHaveLength(2);
  });

  it('代理加载成功后维持代理链', () => {
    const candidates = getThumbnailCandidates(makeR2Item('h-probe-4'), null);
    reportThumbnailUrlLoaded(candidates[0]);
    expect(getThumbnailCandidates(makeR2Item('h-probe-5'), null)).toHaveLength(2);
  });

  // 回归：proxyReachable 曾是普通模块级 `let`，Vue 收集不到依赖。
  // 后果是历史表格一页 50 行的候选在渲染时一次性算好后，第一张探测失败也不会重算——
  // 已渲染的其余几十行仍持有「代理在前」的候选，滚下去每张照样空等一轮超时。
  // 这两条必须走 computed（真实的响应式链路），直接调函数是测不出来的。
  it('降级是响应式的：computed 里的表格候选会自动重算', async () => {
    const item = makeR2Item('h-reactive-table');
    const candidates = computed(() => getThumbnailCandidates(item, null));

    expect(candidates.value).toHaveLength(2);
    reportThumbnailUrlFailed(candidates.value[0]);
    await nextTick();

    expect(candidates.value).toEqual(['https://cdn.example.com/a.png']);
  });

  it('降级是响应式的：computed 里的时间轴候选会自动重算', async () => {
    const meta = {
      id: 'm-reactive',
      timestamp: 0,
      localFileName: 'a.png',
      aspectRatio: 1,
      primaryService: 'r2',
      primaryUrl: 'https://cdn.example.com/a.png',
    } as ImageMeta;
    const candidates = computed(() => getMetaThumbnailCandidates(meta, null));

    expect(candidates.value).toHaveLength(2);
    reportThumbnailUrlFailed(candidates.value[0]);
    await nextTick();

    expect(candidates.value).toEqual(['https://cdn.example.com/a.png']);
  });

  it('降级同样作用于中等尺寸候选（时间轴/收藏页）', () => {
    const meta = {
      id: 'm-probe',
      timestamp: 0,
      localFileName: 'a.png',
      aspectRatio: 1,
      primaryService: 'r2',
      primaryUrl: 'https://cdn.example.com/a.png',
    } as ImageMeta;

    const before = getMetaThumbnailCandidates(meta, null);
    expect(before).toHaveLength(2);

    reportThumbnailUrlFailed(before[0]);

    // 指纹带上了可达性，所以同一个 meta 也会重算
    expect(getMetaThumbnailCandidates(meta, null)).toEqual(['https://cdn.example.com/a.png']);
  });
});
