import { describe, expect, it } from 'vitest';
import { joinCjk, listServiceNames } from '@/utils/cjkSpacing';

describe('joinCjk', () => {
  it('中文与英文 / 数字交界补空格，中文之间、标点前后不补', () => {
    expect(joinCjk('复制到', 'Cloudflare R2')).toBe('复制到 Cloudflare R2');
    expect(joinCjk('GitHub', '连不上')).toBe('GitHub 连不上');
    expect(joinCjk('复制到', '京东')).toBe('复制到京东');
    expect(joinCjk('能正常打开，', 'GitHub', '上的备份已失效')).toBe('能正常打开，GitHub 上的备份已失效');
  });

  it('不改片段内部：用户自己起的名字原样保留', () => {
    expect(joinCjk('家里NAS盘', '上的图已不存在')).toBe('家里NAS盘上的图已不存在');
  });

  it('空片段跳过', () => {
    expect(joinCjk('', 'A', '', '图')).toBe('A 图');
  });
});

describe('listServiceNames', () => {
  it('三个以内用顿号连起来，再多就说「A等 N 个图床」', () => {
    expect(listServiceNames(['京东'])).toBe('京东');
    expect(listServiceNames(['京东', 'GitHub', '微博'])).toBe('京东、GitHub、微博');
    expect(listServiceNames(['GitHub', '京东', '微博', '七鱼'])).toBe('GitHub 等 4 个图床');
  });
});
