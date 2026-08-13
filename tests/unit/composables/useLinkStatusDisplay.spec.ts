import { describe, expect, it } from 'vitest';
import {
  extractFilenameFromUrl,
  extractHost,
  formatTimeRemaining,
  getStatusDisplay,
  isDefunctHost,
  statusBadgeLabel,
  statusDotColor,
  statusTooltip,
} from '@/composables/useLinkStatusDisplay';
import type { CheckLinkResult } from '@/types/linkCheck';

function makeResult(overrides: Partial<CheckLinkResult> = {}): CheckLinkResult {
  return {
    link: 'https://cdn.example.com/image.png',
    is_valid: false,
    error_type: 'network',
    browser_might_work: false,
    ...overrides,
  };
}

describe('useLinkStatusDisplay', () => {
  it('maps check results to display colors and fallback labels', () => {
    expect(getStatusDisplay(null).color).toBe('red');
    expect(getStatusDisplay(makeResult({ is_valid: true, error_type: 'success' })).color).toBe('green');
    expect(getStatusDisplay(makeResult({ browser_might_work: true })).color).toBe('purple');
    expect(getStatusDisplay(makeResult({ error_type: 'timeout' })).color).toBe('amber');
    expect(getStatusDisplay(makeResult({ error_type: 'http_4xx' })).label).toBeTruthy();
    expect(getStatusDisplay(makeResult({ error_type: 'success' })).color).toBe('red');
  });

  it('chooses compact badge labels for valid, failed, timeout, network, and suspicious states', () => {
    expect(statusBadgeLabel(undefined)).toBeTruthy();
    expect(statusBadgeLabel(makeResult({ is_valid: true, error_type: 'success', status_code: 204 }))).toBe('204');
    expect(statusBadgeLabel(makeResult({ is_valid: true, error_type: 'success' }))).toContain('200');
    expect(statusBadgeLabel(makeResult({ status_code: 404, error_type: 'http_4xx' }))).toBe('404');
    expect(statusBadgeLabel(makeResult({ error_type: 'timeout' }))).toBeTruthy();
    expect(statusBadgeLabel(makeResult({ error_type: 'network' }))).toBeTruthy();
    expect(statusBadgeLabel(makeResult({ error_type: 'suspicious' }))).toBeTruthy();
    expect(statusBadgeLabel(makeResult({ error_type: 'network', browser_might_work: true }))).toBeTruthy();
    expect(statusBadgeLabel(makeResult({ error_type: 'success' }))).toBeTruthy();
  });

  it('returns stable dot colors for each status family', () => {
    expect(statusDotColor(null)).toBe('var(--error)');
    expect(statusDotColor(makeResult({ is_valid: true, error_type: 'success' }))).toBe('var(--success)');
    expect(statusDotColor(makeResult({ error_type: 'timeout' }))).toBe('var(--warning)');
    expect(statusDotColor(makeResult({ error_type: 'suspicious' }))).toBe('var(--pending)');
    expect(statusDotColor(makeResult({ error_type: 'network', browser_might_work: true }))).toBe('var(--pending)');
    expect(statusDotColor(makeResult({ error_type: 'network' }))).toBe('var(--error)');
  });

  it('builds tooltip text from status codes, fallback errors, and response time', () => {
    expect(statusTooltip(null)).toBe('');
    expect(statusTooltip(makeResult({ is_valid: true, error_type: 'success' }))).toBe('');
    expect(statusTooltip(makeResult({ status_code: 403, error_type: 'http_4xx', browser_might_work: true }))).toContain('403');
    expect(statusTooltip(makeResult({ status_code: 404, error_type: 'http_4xx', response_time: 125 }))).toContain('125ms');
    expect(statusTooltip(makeResult({ status_code: 599, error_type: 'http_5xx' }))).toContain('599');
    expect(statusTooltip(makeResult({ status_code: 499, error_type: 'http_4xx' }))).toContain('499');
    expect(statusTooltip(makeResult({ error_type: 'timeout' }))).toBeTruthy();
    expect(statusTooltip(makeResult({ error_type: 'network' }))).toBeTruthy();
    expect(statusTooltip(makeResult({ error_type: 'suspicious' }))).toBeTruthy();
    expect(statusTooltip(makeResult({ error_type: 'success' }))).toBeTruthy();
  });

  it('surfaces the real reason for policy-blocked links instead of a network error', () => {
    const blocked = makeResult({
      error_type: 'blocked',
      error: '外部 HTTP 图片地址已禁用，请改用 HTTPS；HTTP 仅保留给本机回环服务。',
    });

    expect(statusTooltip(blocked)).toContain('已禁用');
    expect(statusTooltip(blocked)).not.toContain('网络不通');
    expect(statusBadgeLabel(blocked)).toBe('拦截');
    expect(getStatusDisplay(blocked).label).toBe('拦截');
    // 没有 error 时也要给一句人话，不能落回「链接失效」
    expect(statusTooltip(makeResult({ error_type: 'blocked' }))).toContain('策略拦截');
  });

  // 3xx 与防盗链 403 都置 browser_might_work，共用一个分支会把「跳转」解释成「防盗链」——
  // 用户照着 tooltip 去查防盗链设置，方向从一开始就是错的。
  it('explains 3xx as a redirect rather than a hotlink block or a dead link', () => {
    const redirect = makeResult({
      status_code: 301,
      error_type: 'redirect',
      error: 'HTTP 301',
      browser_might_work: true,
    });

    expect(statusTooltip(redirect)).toContain('跳转链接 (301)');
    expect(statusTooltip(redirect)).not.toContain('防盗链');
    expect(getStatusDisplay(redirect)).toEqual({ color: 'purple', label: '跳转' });
    expect(statusDotColor(redirect)).toBe('var(--pending)');
    // 有状态码时徽章直接显示状态码，比「跳转」两个字信息量更大
    expect(statusBadgeLabel(redirect)).toBe('301');
  });

  // 守门：Rust 给 timeout / network 的 error 是裸的「请求超时」「连接失败」，
  // 比 fallback 表里的文案差。兜底顺序写反就会踩这条。
  it('keeps the curated wording for timeout and network even when error is present', () => {
    expect(statusTooltip(makeResult({ error_type: 'network', error: '连接失败' })))
      .toContain('网络不通 · 无法连接到图床服务器');
    expect(statusTooltip(makeResult({ error_type: 'timeout', error: '请求超时' })))
      .toContain('检测超时 · 网络延迟或图床响应过慢');
    expect(statusTooltip(makeResult({ error_type: 'suspicious', error: 'x' })))
      .toContain('疑似异常');
  });

  it('falls back to the backend error for error types the frontend does not know yet', () => {
    const unknown = makeResult({
      error_type: 'brand_new_type' as CheckLinkResult['error_type'],
      error: '后端新增的原因',
    });

    expect(statusTooltip(unknown)).toContain('后端新增的原因');
    expect(statusTooltip(makeResult({ error_type: 'brand_new_type' as CheckLinkResult['error_type'] })))
      .toContain('链接失效');
  });

  it('extracts hosts and filenames from normal and malformed URLs', () => {
    expect(extractHost('https://wx1.sinaimg.cn/large/a%20b.png?x=1')).toBe('wx1.sinaimg.cn');
    expect(extractHost('not a url')).toBe('');
    expect(isDefunctHost('https://wx1.sinaimg.cn/large/a.png')).toBe(true);
    expect(isDefunctHost('https://sinaimg.cn/a.png')).toBe(true);
    expect(isDefunctHost('https://example.com/a.png')).toBe(false);
    expect(extractFilenameFromUrl('https://cdn.example.com/path/a%20b.png?x=1')).toBe('a b.png');
    expect(extractFilenameFromUrl('https://cdn.example.com')).toBe('cdn.example.com');
    expect(extractFilenameFromUrl('broken/path/file.jpg?size=large')).toBe('file.jpg');
    expect(extractFilenameFromUrl('broken')).toBe('broken');
  });

  it('formats remaining time using seconds and minute buckets', () => {
    expect(formatTimeRemaining(45_000)).toMatch(/^45\s/);
    expect(formatTimeRemaining(125_000)).toMatch(/^2\s/);
    expect(formatTimeRemaining(120_000)).toMatch(/^2\s/);
  });
});
