// 左栏排序与第二行、目录分组 / 搜索 / 筛选（交接说明 8.4、P01 / P13）
import { describe, expect, it } from 'vitest';
import { buildCatalog, buildHostRows, problemLabel, type AddedHost } from '@/views/hosts/hostList';
import { advancedSummary, describeHost } from '@/views/hosts/hostCatalog';

const host = (id: string, name: string, selected: boolean, warning: string | null = null): AddedHost => ({ id, name, selected, warning });

describe('buildHostRows', () => {
  it('有问题的 → 已启用的 → 停用的，同组保持配置顺序', () => {
    const rows = buildHostRows([
      host('webdav:nas', '家里 NAS', false),
      host('jd', '京东', true),
      host('r2', 'Cloudflare R2', true),
      host('weibo', '微博', true, '登录已失效'),
    ], new Set());
    expect(rows.map((r) => r.id)).toEqual(['weibo', 'jd', 'r2', 'webdav:nas']);
    expect(rows.map((r) => r.sub)).toEqual(['登录失效', '公共图床', '对象存储', '已停用']);
    expect(rows[0].problem).toBe('登录失效');
    expect(rows[1].problem).toBeNull();
  });

  it('检测中第二行写「检测中…」，不改变排序', () => {
    const rows = buildHostRows([host('jd', '京东', true), host('r2', 'Cloudflare R2', true)], new Set(['r2']));
    expect(rows[1]).toMatchObject({ id: 'r2', sub: '检测中…', testing: true });
  });
});

describe('problemLabel', () => {
  it('Cookie 图床一律「登录失效」，凭证类错误「凭证无效」，认不出的「连接异常」', () => {
    expect(problemLabel('zhihu', 'whatever')).toBe('登录失效');
    expect(problemLabel('r2', 'SignatureDoesNotMatch')).toBe('凭证无效');
    expect(problemLabel('webdav:a', '图片已上传，但公开链接无法访问 (HTTP 404)')).toBe('公开链接异常');
    expect(problemLabel('r2', 'timed out')).toBe('连接异常');
  });

  it('公开链接返回 403 是公开访问的问题，不是凭证；Account ID 不对算凭证', () => {
    expect(problemLabel('tencent', '图片已写入，但公开链接无法访问（HTTP 403）')).toBe('公开链接异常');
    expect(problemLabel('r2', 'Cloudflare 找不到这个 Account ID')).toBe('凭证无效');
    expect(problemLabel('r2', '密钥没有访问这个存储桶的权限，请在 Cloudflare 后台为它授予读写权限')).toBe('凭证无效');
  });
});

describe('buildCatalog', () => {
  it('已添加的不出现，多份图床的模板一直在；没有图床的组不出现', () => {
    const groups = buildCatalog(new Set(['jd', 'r2', 'webdav:x']), '', 'all');
    expect(groups.map((g) => g.title)).toEqual(['免配置', '登录后使用', '填写 Token', '对象存储', '自建']);
    const ids = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).not.toContain('jd');
    expect(ids).not.toContain('r2');
    expect(ids).toContain('qiyu');
    expect(groups.at(-1)!.items.map((i) => i.name)).toEqual(['S3 兼容存储', 'WebDAV']);

    const allBuiltin = buildCatalog(new Set(['jd', 'qiyu']), '', 'all');
    expect(allBuiltin.map((g) => g.title)).not.toContain('免配置');
  });

  it('按接入方式筛选，搜索名字与副标题（不分大小写）', () => {
    expect(buildCatalog(new Set(), '', 'token').map((g) => g.title)).toEqual(['填写 Token']);
    expect(buildCatalog(new Set(), 'git', 'all').flatMap((g) => g.items.map((i) => i.id))).toEqual(['github']);
    expect(buildCatalog(new Set(), 'minio', 'all').flatMap((g) => g.items.map((i) => i.id))).toEqual(['s3']);
    expect(buildCatalog(new Set(), '不存在', 'all')).toEqual([]);
  });
});

describe('hostCatalog', () => {
  it('复合 id 认得出多份图床；高级选项摘要按实际收起的字段写', () => {
    expect(describeHost('webdav:abc')?.kind).toBe('webdav');
    expect(describeHost('custom_s3:abc')?.kind).toBe('s3');
    expect(describeHost('nope')).toBeUndefined();
    expect(advancedSummary(describeHost('r2')!)).toBe('自定义路径');
  });
});
