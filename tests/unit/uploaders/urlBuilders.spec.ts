// 各图床 URL 构造器（getPublicUrl / getThumbnailUrl / getMediumUrl / getOriginalUrl）
// 测试的都是纯函数——从 UploadResult 推导出展示/缩略图 URL，零 IO。

import { describe, expect, it, vi } from 'vitest';
import type { UploadResult } from '@/uploaders/base/types';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { WeiboUploader } = await import('@/uploaders/weibo/WeiboUploader');
const { JDUploader } = await import('@/uploaders/jd/JDUploader');
const { ZhihuUploader } = await import('@/uploaders/zhihu/ZhihuUploader');
const { NowcoderUploader } = await import('@/uploaders/nowcoder/NowcoderUploader');
const { QiyuUploader } = await import('@/uploaders/qiyu/QiyuUploader');
const { ChaoxingUploader } = await import('@/uploaders/chaoxing/ChaoxingUploader');
const { BilibiliUploader } = await import('@/uploaders/bilibili/BilibiliUploader');

function makeResult(overrides: Partial<UploadResult> & Pick<UploadResult, 'url'>): UploadResult {
  return {
    serviceId: 'test',
    fileKey: overrides.fileKey ?? 'key-001',
    ...overrides,
  } as UploadResult;
}

describe('WeiboUploader URL 构造器', () => {
  const uploader = new WeiboUploader();

  it('getPublicUrl 直接返回 result.url', () => {
    const r = makeResult({ url: 'https://tvax1.sinaimg.cn/large/abc.jpg', fileKey: 'abc' });
    expect(uploader.getPublicUrl(r)).toBe('https://tvax1.sinaimg.cn/large/abc.jpg');
  });

  it('getThumbnailUrl 基于 fileKey 构造 thumb150 路径', () => {
    const r = makeResult({ url: 'https://tvax1.sinaimg.cn/large/abc.jpg', fileKey: 'abc' });
    expect(uploader.getThumbnailUrl(r)).toBe('https://tvax1.sinaimg.cn/thumb150/abc.jpg');
  });

  it('getOriginalUrl 基于 fileKey 构造 large 路径（即使 url 不同也以 fileKey 为准）', () => {
    const r = makeResult({ url: 'https://example.com/other.jpg', fileKey: 'pid999' });
    expect(uploader.getOriginalUrl(r)).toBe('https://tvax1.sinaimg.cn/large/pid999.jpg');
  });
});

describe('JDUploader URL 构造器', () => {
  const uploader = new JDUploader();

  it('getPublicUrl 返回原 url', () => {
    const r = makeResult({ url: 'https://img30.360buyimg.com/jfs/t1.jpg' });
    expect(uploader.getPublicUrl(r)).toBe('https://img30.360buyimg.com/jfs/t1.jpg');
  });

  it('getThumbnailUrl 把 /jfs/ 替换为 /s76x76_jfs/', () => {
    const r = makeResult({ url: 'https://img30.360buyimg.com/jfs/t1/hash.jpg' });
    expect(uploader.getThumbnailUrl(r)).toBe('https://img30.360buyimg.com/s76x76_jfs/t1/hash.jpg');
  });

  it('getThumbnailUrl 对非 /jfs/ URL 不做替换', () => {
    const r = makeResult({ url: 'https://cdn.example.com/img.jpg' });
    expect(uploader.getThumbnailUrl(r)).toBe('https://cdn.example.com/img.jpg');
  });

  it('getOriginalUrl 返回原 url', () => {
    const r = makeResult({ url: 'https://img30.360buyimg.com/jfs/x.jpg' });
    expect(uploader.getOriginalUrl(r)).toBe('https://img30.360buyimg.com/jfs/x.jpg');
  });
});

describe('ZhihuUploader URL 构造器', () => {
  const uploader = new ZhihuUploader();

  it('getPublicUrl 返回原 url', () => {
    const r = makeResult({ url: 'https://pic1.zhimg.com/abc.jpg' });
    expect(uploader.getPublicUrl(r)).toBe('https://pic1.zhimg.com/abc.jpg');
  });

  it('getThumbnailUrl 在扩展名前加 _xs 后缀（jpg）', () => {
    const r = makeResult({ url: 'https://pic1.zhimg.com/abc.jpg' });
    expect(uploader.getThumbnailUrl(r)).toBe('https://pic1.zhimg.com/abc_xs.jpg');
  });

  it('getThumbnailUrl 对 png 也能正确加 _xs', () => {
    const r = makeResult({ url: 'https://pic1.zhimg.com/abc.png' });
    expect(uploader.getThumbnailUrl(r)).toBe('https://pic1.zhimg.com/abc_xs.png');
  });

  it('getThumbnailUrl 对 webp 也能正确加 _xs', () => {
    const r = makeResult({ url: 'https://pic1.zhimg.com/hash-xyz.webp' });
    expect(uploader.getThumbnailUrl(r)).toBe('https://pic1.zhimg.com/hash-xyz_xs.webp');
  });
});

describe('NowcoderUploader URL 构造器', () => {
  const uploader = new NowcoderUploader();

  it('getPublicUrl 返回原 url', () => {
    const r = makeResult({ url: 'https://nowcoder-img.oss-cn-beijing.aliyuncs.com/x.jpg' });
    expect(uploader.getPublicUrl(r)).toBe('https://nowcoder-img.oss-cn-beijing.aliyuncs.com/x.jpg');
  });

  it('getThumbnailUrl 追加 OSS 图片处理查询参数', () => {
    const r = makeResult({ url: 'https://nowcoder-img.oss-cn-beijing.aliyuncs.com/x.jpg' });
    const thumb = uploader.getThumbnailUrl(r);
    expect(thumb.startsWith('https://nowcoder-img.oss-cn-beijing.aliyuncs.com/x.jpg?')).toBe(true);
    expect(thumb).toContain('x-oss-process=image');
    expect(thumb).toContain('resize');
    expect(thumb).toContain('w_75');
    expect(thumb).toContain('h_75');
  });
});

describe('QiyuUploader URL 构造器', () => {
  const uploader = new QiyuUploader();

  it('getThumbnailUrl 追加 NOS thumbnail 参数', () => {
    const r = makeResult({ url: 'https://nos.netease.com/qiyu/abc.png' });
    expect(uploader.getThumbnailUrl(r)).toBe('https://nos.netease.com/qiyu/abc.png?imageView&thumbnail=50x0');
  });
});

describe('ChaoxingUploader URL 构造器', () => {
  const uploader = new ChaoxingUploader();

  it('getThumbnailUrl 同时替换域名与文件名', () => {
    const r = makeResult({
      url: 'https://p.cldisk.com/star4/abc123/origin.jpg',
    });
    expect(uploader.getThumbnailUrl(r)).toBe(
      'https://p.ananas.chaoxing.com/star4/abc123/75_0cQ80.webp'
    );
  });

  it('getThumbnailUrl 只有文件名替换（已经是 ananas 域名）', () => {
    const r = makeResult({
      url: 'https://p.ananas.chaoxing.com/star4/abc/origin.png',
    });
    expect(uploader.getThumbnailUrl(r)).toBe(
      'https://p.ananas.chaoxing.com/star4/abc/75_0cQ80.webp'
    );
  });

  it('getThumbnailUrl 忽略 origin 后的查询参数', () => {
    const r = makeResult({
      url: 'https://p.cldisk.com/star4/abc/origin.jpg?token=xyz',
    });
    expect(uploader.getThumbnailUrl(r)).toBe(
      'https://p.ananas.chaoxing.com/star4/abc/75_0cQ80.webp'
    );
  });

  it('getMediumUrl 产出 800_ 前缀的 webp', () => {
    const r = makeResult({
      url: 'https://p.cldisk.com/star4/abc/origin.jpg',
    });
    expect(uploader.getMediumUrl(r)).toBe(
      'https://p.ananas.chaoxing.com/star4/abc/800_0cQ80.webp'
    );
  });

  it('getOriginalUrl 返回原 url', () => {
    const r = makeResult({ url: 'https://p.cldisk.com/star4/abc/origin.jpg' });
    expect(uploader.getOriginalUrl(r)).toBe('https://p.cldisk.com/star4/abc/origin.jpg');
  });
});

describe('BilibiliUploader URL 构造器', () => {
  const uploader = new BilibiliUploader();

  it('getThumbnailUrl 追加 @75w_75h_1c_80q.webp', () => {
    const r = makeResult({ url: 'https://i0.hdslb.com/bfs/article/abc.jpg' });
    expect(uploader.getThumbnailUrl(r)).toBe(
      'https://i0.hdslb.com/bfs/article/abc.jpg@75w_75h_1c_80q.webp'
    );
  });

  it('getMediumUrl 追加 @800w_80q.webp', () => {
    const r = makeResult({ url: 'https://i0.hdslb.com/bfs/article/abc.jpg' });
    expect(uploader.getMediumUrl(r)).toBe(
      'https://i0.hdslb.com/bfs/article/abc.jpg@800w_80q.webp'
    );
  });

  it('getOriginalUrl 返回原 url', () => {
    const r = makeResult({ url: 'https://i0.hdslb.com/bfs/article/abc.jpg' });
    expect(uploader.getOriginalUrl(r)).toBe('https://i0.hdslb.com/bfs/article/abc.jpg');
  });
});
