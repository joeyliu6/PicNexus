import { describe, expect, it } from 'vitest';
import {
  buildUploadFailureTooltip,
  normalizeUploadFailureReason,
  cleanMigrateError,
  formatMigrateFailureSummary,
  categorizeMigrateError,
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
});
