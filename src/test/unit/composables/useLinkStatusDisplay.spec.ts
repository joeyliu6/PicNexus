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
} from '../../../composables/useLinkStatusDisplay';
import type { CheckLinkResult } from '../../../types/linkCheck';

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
