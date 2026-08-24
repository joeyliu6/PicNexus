/**
 * `parseCloudHistoryForUpload` / `extractErrorCode` / `isWebDAVNotFoundError` 的直接测试
 *
 * Why 单独一份：这三个函数决定「云端数据拿不到时，要不要继续把本地推上去」——
 * 判错一次就是把只存在于其他设备的历史整份抹掉。可它们此前零真实覆盖：
 * 每一处消费端 spec 都把 `extractErrorCode` mock 成 `vi.fn()`，而
 * `isWebDAVNotFoundError` 更糟——两份 spec 各手抄了一份实现副本，副本已经漏掉了
 * 生产代码里的 `/file.*not.*exist/i` 分支，于是测试断言的是一段假逻辑。
 */

import { describe, expect, it } from 'vitest';
import {
  parseCloudHistoryForUpload,
  extractErrorCode,
  isWebDAVNotFoundError,
  isCloudDataAbortReason,
  CLOUD_HISTORY_EMPTY_REASON,
  CLOUD_HISTORY_NON_ARRAY_REASON,
  CLOUD_CONFIG_EMPTY_REASON,
} from '@/composables/backup-sync/backupSyncUtils';

// 不变式：三个中止文案必须都命中 isCloudDataAbortReason（含历史的两个 + 配置的一个）。
// HistorySync 靠它决定「上传失败」toast 不拼「请检查网络或 WebDAV 配置后重试」误导后缀。
// 若将来有人改了措辞导致这里不命中，此测试会先倒下。
it('三个「已中止」文案都命中 isCloudDataAbortReason 统一标记', () => {
  expect(isCloudDataAbortReason(CLOUD_HISTORY_EMPTY_REASON)).toBe(true);
  expect(isCloudDataAbortReason(CLOUD_HISTORY_NON_ARRAY_REASON)).toBe(true);
  expect(isCloudDataAbortReason(CLOUD_CONFIG_EMPTY_REASON)).toBe(true);
  // 恰好命中一次标记，不是多写了个「已中止…」的次生短语
  for (const reason of [CLOUD_HISTORY_EMPTY_REASON, CLOUD_HISTORY_NON_ARRAY_REASON, CLOUD_CONFIG_EMPTY_REASON]) {
    expect(reason.split('已中止以避免覆盖云端数据').length).toBe(2);
  }
});

describe('parseCloudHistoryForUpload', () => {
  it('null（HTTP 404）判为 absent —— 首次同步的正常路径，必须放行全量上传', () => {
    expect(parseCloudHistoryForUpload(null)).toEqual({ kind: 'absent' });
  });

  it('undefined 也判为 absent，不掉进 JSON.parse(undefined)', () => {
    expect(parseCloudHistoryForUpload(undefined)).toEqual({ kind: 'absent' });
  });

  it.each([
    ['空串', ''],
    ['纯空白', '   \n'],
  ])('%s 判为 unusable —— 文件在但是 0 字节，继续上传就等于清空云端', (_label, content) => {
    const result = parseCloudHistoryForUpload(content);
    expect(result.kind).toBe('unusable');
  });

  it('合法 JSON 但不是数组，判为 unusable', () => {
    const result = parseCloudHistoryForUpload(JSON.stringify({ items: [] }));
    expect(result.kind).toBe('unusable');
  });

  it('正常数组解析为 items', () => {
    const result = parseCloudHistoryForUpload(JSON.stringify([{ id: 'a', timestamp: 1 }]));
    expect(result).toEqual({ kind: 'items', items: [{ id: 'a', timestamp: 1 }] });
  });

  it('JSON 语法错误仍然抛出，交由调用方的 catch 处理', () => {
    expect(() => parseCloudHistoryForUpload('{not json')).toThrow();
  });

  // 这是整条修复的命门：unusable 的文案会被调用方包进 Error 抛出，而调用方的内层 catch
  // 会先过一道 isWebDAVNotFoundError（子串匹配）。文案里一旦出现「文件不存在」/404/
  // not found，中止就会被当成「云端没这个文件」吞掉，静默退化回覆盖云端。
  it('unusable 的文案不能被 isWebDAVNotFoundError 误判为「云端没有该文件」', () => {
    for (const content of ['', JSON.stringify({ items: [] })]) {
      const result = parseCloudHistoryForUpload(content);
      if (result.kind !== 'unusable') throw new Error('预期是 unusable');
      expect(isWebDAVNotFoundError(new Error(result.reason))).toBe(false);
    }
  });

  it('unusable 的文案要给出自愈路径，且短到不会被 extractErrorCode 截断', () => {
    const result = parseCloudHistoryForUpload('');
    if (result.kind !== 'unusable') throw new Error('预期是 unusable');
    expect(result.reason).toContain('强制覆盖云端');
    expect(result.reason.length).toBeLessThanOrEqual(100);
    expect(extractErrorCode(new Error(result.reason))).toBe(result.reason);
  });
});

describe('extractErrorCode', () => {
  // Tauri command 失败时 reject 的是 AppError 序列化后的**普通对象**，不是 Error 实例。
  it('解得开 AppError 对象，而不是打成 [object Object]', () => {
    const appError = {
      type: 'WEBDAV',
      data: { message: '无法连接到 WebDAV 服务器，请检查 URL 或网络' },
    };
    const msg = extractErrorCode(appError);
    expect(msg).toBe('无法连接到 WebDAV 服务器，请检查 URL 或网络');
    expect(msg).not.toContain('[object Object]');
  });

  it('Error 实例仍按 message 取（与旧行为逐字一致）', () => {
    expect(extractErrorCode(new Error('认证失败，请检查用户名和密码'))).toBe('认证失败，请检查用户名和密码');
  });

  it('带 HTTP 上下文的状态码翻译成中文提示', () => {
    expect(extractErrorCode(new Error('下载失败: HTTP 507'))).toBe('云端存储空间不足');
  });

  it('不把普通数字误判为 HTTP 状态码', () => {
    // 回归：曾经的 fallback 会把 "timeout after 500ms" 翻成「服务器返回错误 500」
    expect(extractErrorCode(new Error('Cannot connect to port 443'))).not.toContain('服务器返回错误');
  });

  it('超长文案截断到 100 字符加省略号', () => {
    const long = '错'.repeat(150);
    expect(extractErrorCode(new Error(long))).toBe('错'.repeat(100) + '…');
  });
});

describe('isWebDAVNotFoundError', () => {
  it.each([
    ['404 状态', new Error('下载失败: HTTP 404')],
    ['英文 not found', new Error('Not Found')],
    ['英文 file does not exist', new Error('file does not exist')],
    ['中文文件不存在', new Error('远端文件不存在')],
  ])('认得出「云端没有该文件」：%s', (_label, error) => {
    expect(isWebDAVNotFoundError(error)).toBe(true);
  });

  it.each([
    ['认证失败', new Error('认证失败，请检查用户名和密码')],
    ['连接超时', new Error('连接超时，请检查网络或服务器状态')],
    ['500', new Error('服务器错误 (HTTP 500)')],
  ])('不把 %s 误判成「云端没有该文件」（否则会覆盖云端）', (_label, error) => {
    expect(isWebDAVNotFoundError(error)).toBe(false);
  });

  it('AppError 对象形态同样能被正确判定', () => {
    expect(isWebDAVNotFoundError({ type: 'WEBDAV', data: { message: '远端文件不存在' } })).toBe(true);
    expect(isWebDAVNotFoundError({ type: 'WEBDAV', data: { message: '认证失败' } })).toBe(false);
  });
});
