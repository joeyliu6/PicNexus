import { beforeEach, describe, it, expect, vi } from 'vitest';

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
} from '@/composables/useThumbCache';
import type { UserConfig } from '@/config/types';
import type { ImageMeta } from '@/types/image-meta';

beforeEach(() => {
  cacheEventHandlers['history-cleared']?.();
});

describe('generateThumbnailUrl', () => {
  it('weibo + fileKey → thumb150 URL', () => {
    expect(generateThumbnailUrl('weibo', 'http://ignored', 'abc123'))
      .toBe('https://tvax1.sinaimg.cn/thumb150/abc123.jpg');
  });

  it('weibo 无 fileKey → 回退原图', () => {
    expect(generateThumbnailUrl('weibo', 'http://orig.com/a.jpg')).toBe('http://orig.com/a.jpg');
  });

  it('r2 → 走 wsrv.nl 代理', () => {
    const url = 'https://cdn.example.com/a.png';
    const out = generateThumbnailUrl('r2', url);
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

  it('r2 → wsrv w=800', () => {
    const out = generateMediumThumbnailUrl('r2', 'http://x');
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
    expect(candidates.length).toBe(2);
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

    expect(getThumbnailCandidates(item, null)).toHaveLength(1);
    item.results.push({ serviceId: 'weibo', status: 'success', result: { url: 'http://weibo', fileKey: 'pid' } });
    expect(getThumbnailCandidates(item, null)).toHaveLength(1);

    cacheEventHandlers['history-updated']?.({ ids: ['h-updated'] });

    expect(getThumbnailCandidates(item, null)).toHaveLength(2);
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
    expect(candidates).toHaveLength(2);
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
    expect(candidates).toHaveLength(1);
  });
});
