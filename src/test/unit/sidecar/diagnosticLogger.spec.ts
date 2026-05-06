import { afterEach, describe, expect, it, vi } from 'vitest';
import { logDiagnostic as logQiyuDiagnostic } from '../../../../sidecar/qiyu-token-fetcher/src/diagnostic-logger';
import { logDiagnostic as logNamiDiagnostic } from '../../../../sidecar/nami-token-fetcher/src/diagnostic-logger';

const restoreMocks: Array<() => void> = [];

afterEach(() => {
  for (const restore of restoreMocks.splice(0)) restore();
});

describe('sidecar diagnostic logger redaction', () => {
  it.each([
    ['qiyu', logQiyuDiagnostic],
    ['nami', logNamiDiagnostic],
  ])('redacts headers, token fields, URLs, and local paths for %s', (_name, logDiagnostic) => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    restoreMocks.push(() => stderrSpy.mockRestore());

    logDiagnostic('Authorization: Bearer secret-token https://example.com/callback?token=secret', {
      Cookie: 'SUB=abc; uid=42',
      accessKey: 'AKIA-secret',
      filePath: 'C:\\Users\\alice\\Pictures\\private.png',
    });

    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).toContain('Authorization=[REDACTED]');
    expect(output).toContain('"Cookie":"[REDACTED]"');
    expect(output).toContain('"accessKey":"[REDACTED]"');
    expect(output).toContain('https://example.com/callback#url:');
    expect(output).toContain('[path:private.png#');
    expect(output).not.toContain('secret-token');
    expect(output).not.toContain('SUB=abc');
    expect(output).not.toContain('AKIA-secret');
    expect(output).not.toContain('Users\\alice');
  });
});
