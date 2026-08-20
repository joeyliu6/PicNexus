import { describe, expect, it } from 'vitest';
import {
  buildUploadFailureTooltip,
  normalizeUploadFailureReason,
  cleanMigrateError,
  formatMigrateFailureSummary,
  categorizeMigrateError,
  summarizeAllServicesFailed,
} from '@/utils/uploadFailureMessage';
import type { MigrateFailureDetail } from '@/types/batchMigrate';

describe('uploadFailureMessage', () => {
  it('normalizes nested upload failure prefixes', () => {
    expect(
      normalizeUploadFailureReason(
        '又拍云',
        '又拍云上传失败: 又拍云上传失败: 上传失败: service error'
      )
    ).toBe('service error');
  });

  it('normalizes serviceId-based failure prefixes when aliases are provided', () => {
    expect(
      normalizeUploadFailureReason(
        '又拍云',
        'upyun 上传失败: 又拍云上传失败: 上传失败: service error',
        ['upyun']
      )
    ).toBe('service error');
  });

  it('builds a retry tooltip with normalized reason', () => {
    expect(
      buildUploadFailureTooltip(
        '又拍云',
        'upyun 上传失败: 又拍云图床上传失败：上传失败：service error',
        ['upyun']
      )
    ).toBe('又拍云上传失败：service error。点击右侧重试。');
  });

});

describe('normalizeUploadFailureReason - 额外分支', () => {
  it('空错误返回空字符串', () => {
    expect(normalizeUploadFailureReason('微博', '')).toBe('');
    expect(normalizeUploadFailureReason('微博', undefined)).toBe('');
  });

  it('剥掉英文 "upload failed" 前缀（大小写不敏感）', () => {
    expect(normalizeUploadFailureReason('R2', 'Upload Failed: network error')).toBe('network error');
  });

  it('不含前缀直接返回 trim 后的原文', () => {
    expect(normalizeUploadFailureReason('微博', '  纯错误  ')).toBe('纯错误');
  });
});

describe('buildUploadFailureTooltip - 额外分支', () => {
  it('无错误原因时显示默认提示', () => {
    expect(buildUploadFailureTooltip('微博', '')).toBe('微博上传失败。点击右侧重试。');
  });

  it('原因已带句号则不重复补', () => {
    expect(buildUploadFailureTooltip('微博', '微博 上传失败: cookie 过期。'))
      .toBe('微博上传失败：cookie 过期。点击右侧重试。');
  });

  it('英文问号识别为结尾', () => {
    expect(buildUploadFailureTooltip('微博', '微博 上传失败: why?'))
      .toBe('微博上传失败：why?点击右侧重试。');
  });
});

describe('cleanMigrateError', () => {
  it('无 serviceId 时仅剥通用前缀', () => {
    expect(cleanMigrateError(undefined, '上传失败: err')).toBe('err');
  });

  it('空字符串直接返回空', () => {
    expect(cleanMigrateError('weibo', '')).toBe('');
  });

  it('有 serviceId 时使用该图床的 displayName + alias', () => {
    expect(cleanMigrateError('r2', 'Cloudflare R2 上传失败: network reset')).toBe('network reset');
    expect(cleanMigrateError('r2', 'R2 上传失败: err')).toBe('err');
  });
});

describe('formatMigrateFailureSummary', () => {
  it('空数组返回空字符串', () => {
    expect(formatMigrateFailureSummary([])).toBe('');
  });

  it('单条带 serviceId 显示 displayName · message', () => {
    const details: MigrateFailureDetail[] = [
      { serviceId: 'r2', message: 'dispatch failure' } as MigrateFailureDetail,
    ];
    expect(formatMigrateFailureSummary(details)).toBe('Cloudflare R2 · dispatch failure');
  });

  it('多条用 ； 连接，无 serviceId 只显示 message', () => {
    const details: MigrateFailureDetail[] = [
      { serviceId: 'r2', message: 'err1' } as MigrateFailureDetail,
      { message: 'err2' } as MigrateFailureDetail,
    ];
    expect(formatMigrateFailureSummary(details)).toBe('Cloudflare R2 · err1；err2');
  });
});

describe('categorizeMigrateError', () => {
  it('空消息返回未知错误', () => {
    expect(categorizeMigrateError('download', '')).toEqual({ category: '未知错误', raw: '' });
    expect(categorizeMigrateError('upload', '   ')).toEqual({ category: '未知错误', raw: '' });
  });

  it('网络中断关键字', () => {
    const cases = [
      'connection reset by peer',
      'connection refused',
      'network is unreachable',
      'socket hang up',
      'end of file before message length reached',
    ];
    for (const raw of cases) {
      expect(categorizeMigrateError('download', raw).category).toBe('网络中断');
    }
  });

  it('请求超时关键字', () => {
    expect(categorizeMigrateError('download', 'operation timed out').category).toBe('请求超时');
    expect(categorizeMigrateError('upload', 'deadline exceeded').category).toBe('请求超时');
    expect(categorizeMigrateError('upload', 'timeout occurred').category).toBe('请求超时');
  });

  it('源图片失效仅匹配 download 域', () => {
    expect(categorizeMigrateError('download', '404 not found').category).toBe('源图片失效');
    expect(categorizeMigrateError('download', 'HTTP 403 forbidden').category).toBe('源图片失效');
  });

  it('upload 域下 403 应被识别成权限不足', () => {
    expect(categorizeMigrateError('upload', '403 forbidden').category).toBe('权限不足');
  });

  it('文件过大', () => {
    expect(categorizeMigrateError('upload', '413 payload too large').category).toBe('文件过大');
    expect(categorizeMigrateError('upload', 'request entity too large').category).toBe('文件过大');
  });

  it('权限不足（upload）', () => {
    expect(categorizeMigrateError('upload', '401 unauthorized').category).toBe('权限不足');
    expect(categorizeMigrateError('upload', 'invalid cookie').category).toBe('权限不足');
    expect(categorizeMigrateError('upload', '鉴权失败').category).toBe('权限不足');
    expect(categorizeMigrateError('upload', 'token expired').category).toBe('权限不足');
  });

  it('格式不支持', () => {
    expect(categorizeMigrateError('upload', 'unsupported format').category).toBe('格式不支持');
    expect(categorizeMigrateError('upload', 'invalid image').category).toBe('格式不支持');
    expect(categorizeMigrateError('upload', '415 unsupported media type').category).toBe('格式不支持');
  });

  it('图床服务异常', () => {
    expect(categorizeMigrateError('upload', 'JSON 解析失败: xxx').category).toBe('图床服务异常');
    expect(categorizeMigrateError('upload', '502 bad gateway').category).toBe('图床服务异常');
    expect(categorizeMigrateError('upload', 'service unavailable').category).toBe('图床服务异常');
    expect(categorizeMigrateError('upload', 'internal server error').category).toBe('图床服务异常');
  });

  it('无法命中任何规则 → 未知错误', () => {
    expect(categorizeMigrateError(undefined, '某些奇怪错误').category).toBe('未知错误');
  });

  it('保留 raw 字段原文（trim 后）', () => {
    const result = categorizeMigrateError('upload', '  401 unauthorized  ');
    expect(result.raw).toBe('401 unauthorized');
  });
  /**
   * 2026-08-20 真机验收：WebDAV 上传失败，界面只说「未能上传至任何图床」，
   * 一个字没讲为什么，最后是靠命令行跑同一份配置才知道是「路径不存在」。
   * 原因一直在这条聚合消息里，只是被整段丢掉了。
   */
  describe('summarizeAllServicesFailed', () => {
    const single = [
      '所有图床上传均失败：',
      '  - webdav:msrlkrjz39xp49fzy: WebDAV 错误: 路径不存在，请检查远程路径配置',
      '',
      '请检查网络连接和服务配置',
    ].join('\n');

    it('单个图床失败时带出原因', () => {
      expect(summarizeAllServicesFailed(single)).toContain('路径不存在，请检查远程路径配置');
    });

    it('不把尾注那行「请检查网络连接和服务配置」当成失败条目', () => {
      expect(summarizeAllServicesFailed(single)).not.toContain('请检查网络连接和服务配置');
    });

    /**
     * 条目必须是「缩进 + 短横线」那种形状。松掉这个要求的话，失败原因本身若含
     * `- xxx: yyy` 就会被当成另一个图床，摘要里冒出个不存在的服务。
     */
    it('只认缩进条目，顶格的 - 行不算', () => {
      const tricky = [
        '所有图床上传均失败：',
        '  - upyun: 认证失败',
        '- 伪造: 这行顶格，不该被当成失败条目',
      ].join('\n');

      const summary = summarizeAllServicesFailed(tricky);
      expect(summary).toContain('认证失败');
      expect(summary).not.toContain('伪造');
    });

    /**
     * 上传器抛的错常常自带「xx 上传失败:」前缀，直接拼上去会变成
     * 「又拍云 · 又拍云上传失败: 认证失败」——同一个名字说两遍。
     */
    it('剥掉原因里重复的「xx 上传失败」前缀', () => {
      const msg = ['所有图床上传均失败：', '  - upyun: 又拍云上传失败: 认证失败'].join('\n');

      const summary = summarizeAllServicesFailed(msg);
      expect(summary).toBe('又拍云 · 认证失败');
    });

    it('多个图床各报各的，用分号隔开', () => {
      const many = [
        '所有图床上传均失败：',
        '  - upyun: 认证失败',
        '  - r2: dispatch failure',
        '',
        '请检查网络连接和服务配置',
      ].join('\n');

      const summary = summarizeAllServicesFailed(many);
      expect(summary).toContain('认证失败');
      expect(summary).toContain('dispatch failure');
      expect(summary).toContain('；');
    });

    it('已知图床用中文名而不是 serviceId', () => {
      const msg = ['所有图床上传均失败：', '  - upyun: 认证失败'].join('\n');
      expect(summarizeAllServicesFailed(msg)).toContain('又拍云');
    });

    /** 解析不出来要返回空串，让调用方退回那句笼统文案，而不是弹一句空的 */
    it('格式对不上时返回空串', () => {
      expect(summarizeAllServicesFailed('所有图床上传均失败：完全不是那个格式')).toBe('');
      expect(summarizeAllServicesFailed('')).toBe('');
    });

    it('CRLF 的消息也能解析', () => {
      const crlf = ['所有图床上传均失败：', '  - upyun: 认证失败'].join('\r\n');
      expect(summarizeAllServicesFailed(crlf)).toContain('认证失败');
    });
  });
});
