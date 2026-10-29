import { describe, expect, it } from 'vitest';
import {
  normalizeUploadFailureReason,
  cleanMigrateError,
  formatMigrateFailureSummary,
  categorizeMigrateError,
  reasonsByService,
  describeUploadFailure,
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

  it('中文的网络中断与超时（Rust 侧报的多是中文）', () => {
    expect(categorizeMigrateError('upload', '请求超时，请检查网络连接').category).toBe('请求超时');
    expect(categorizeMigrateError('upload', '上传超时（120秒）').category).toBe('请求超时');
    expect(categorizeMigrateError('upload', '连接被重置').category).toBe('网络中断');
    expect(categorizeMigrateError('upload', '域名解析失败: no record').category).toBe('网络中断');
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

describe('reasonsByService', () => {
  it("splits the all-failed message into each host's own reason, composite ids included", () => {
    const msg = [
      '所有图床上传均失败：',
      '  - jd: 京东上传失败: 请求超时',
      '  - webdav:nas: WebDAV 错误: 路径不存在',
      '',
      '请检查网络连接和服务配置',
    ].join('\n');
    expect([...reasonsByService(msg)]).toEqual([
      ['jd', '京东上传失败: 请求超时'],
      ['webdav:nas', 'WebDAV 错误: 路径不存在'],
    ]);
  });

  // 原因本身若含「- xxx: yyy」，不能被当成另一个图床
  it('only counts indented entries, not a dash line at the start', () => {
    const msg = ['所有图床上传均失败：', '  - upyun: 认证失败', '- 伪造: 这行顶格，不该被当成失败条目'].join('\n');
    expect([...reasonsByService(msg)]).toEqual([['upyun', '认证失败']]);
  });

  it('reads Windows line endings', () => {
    expect([...reasonsByService(['所有图床上传均失败：', '  - upyun: 认证失败'].join('\r\n'))]).toEqual([['upyun', '认证失败']]);
  });

  it('finds nothing in a message of another shape', () => {
    expect(reasonsByService('所有图床上传均失败：完全不是那个格式').size).toBe(0);
  });
});

// 交接说明第 9 节：错误 = 原因 + 处理办法；设计稿的说法是「网络超时。请检查网络后重试。」
describe('describeUploadFailure', () => {
  it('words a timeout the way the design does', () => {
    const timeout = { reason: '网络超时', advice: '请检查网络后重试' };
    expect(describeUploadFailure('jd', '京东图床上传失败: 请求超时，请检查网络连接')).toEqual(timeout);
    expect(describeUploadFailure('r2', 'operation timed out')).toEqual(timeout);
  });

  it('says the login expired for cookie hosts and the keys are wrong for the others', () => {
    // HomeScreen.dc.html：「微博：登录已过期，请重新登录」（登录后会自动补传）
    expect(describeUploadFailure('weibo', '微博上传失败: 认证失败: 401', { cookieLogin: true })).toEqual({ reason: '登录已过期', advice: '请重新登录' });
    expect(describeUploadFailure('r2', 'R2 上传失败: 403 forbidden').reason).toBe('凭证无效');
  });

  it('keeps a reason it cannot classify, splitting off the advice it already carries', () => {
    expect(describeUploadFailure('webdav:nas', 'WebDAV 错误: 路径不存在，请检查远程路径配置'))
      .toEqual({ reason: 'WebDAV 错误: 路径不存在', advice: '请检查远程路径配置' });
    expect(describeUploadFailure('jd', '')).toEqual({ reason: '上传失败', advice: '请稍后重试' });
  });
});
