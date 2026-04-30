import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockLogOptions = { keyValues?: Record<string, string | undefined> };
type MockLogFn = (message: string, options?: MockLogOptions) => Promise<void>;

const logMocks = vi.hoisted(() => ({
  debug: vi.fn<MockLogFn>(() => Promise.resolve()),
  info: vi.fn<MockLogFn>(() => Promise.resolve()),
  warn: vi.fn<MockLogFn>(() => Promise.resolve()),
  error: vi.fn<MockLogFn>(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/plugin-log', () => logMocks);

import { createLogger, redactForLog, safeStringify } from '../../../utils/logger';

beforeEach(() => {
  logMocks.debug.mockClear();
  logMocks.info.mockClear();
  logMocks.warn.mockClear();
  logMocks.error.mockClear();
});

describe('logger redaction', () => {
  it('redacts sensitive object fields before writing logs', () => {
    const log = createLogger('LoggerSpec');

    log.info('保存配置', {
      cookie: 'SUB=secret-cookie',
      authToken: 'token-123',
      password: 'plain-password',
      nested: {
        authorization: 'Bearer secret',
        safe: 'visible',
      },
    });

    const [message, options] = logMocks.info.mock.calls[0];
    expect(message).toContain('[LoggerSpec] 保存配置');
    expect(message).toContain('"safe":"visible"');
    expect(message).not.toContain('secret-cookie');
    expect(message).not.toContain('token-123');
    expect(message).not.toContain('plain-password');
    expect(message).not.toContain('Bearer secret');
    expect(options?.keyValues?.cookie).toBe('[REDACTED]');
  });

  it('removes URL query and fragment values', () => {
    const result = safeStringify('https://example.com/a/b.png?token=secret#private');

    expect(result).toContain('https://example.com/a/b.png#url:');
    expect(result).not.toContain('token=secret');
    expect(result).not.toContain('#private');
  });

  it('replaces local paths with basename and a stable hash', () => {
    const result = safeStringify('C:\\Users\\alice\\Pictures\\private-photo.png');

    expect(result).toContain('[path:private-photo.png#');
    expect(result).not.toContain('Users\\alice');
    expect(result).not.toContain('Pictures');
  });

  it('handles circular references and BigInt without throwing', () => {
    const value: { count: bigint; self?: unknown } = { count: 12n };
    value.self = value;

    const result = safeStringify(redactForLog(value));

    expect(result).toContain('"count":"12n"');
    expect(result).toContain('"self":"[Circular]"');
  });

  it('sanitizes Error messages', () => {
    const log = createLogger('LoggerSpec');

    log.error('失败', new Error('request failed token=secret-token'));

    const [message] = logMocks.error.mock.calls[0];
    expect(message).toContain('request failed token=[REDACTED]');
    expect(message).not.toContain('secret-token');
  });
});
