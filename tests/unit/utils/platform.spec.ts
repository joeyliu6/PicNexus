import { describe, expect, it } from 'vitest';
import { normalizeOsInfo, uiPlatform } from '@/utils/platform';

describe('uiPlatform', () => {
  it('maps the three desktop platforms', () => {
    expect(uiPlatform(normalizeOsInfo('Win32'))).toBe('windows');
    expect(uiPlatform(normalizeOsInfo('MacIntel'))).toBe('macos');
    expect(uiPlatform(normalizeOsInfo('Linux x86_64'))).toBe('linux');
  });

  it('treats darwin as macOS even though it contains "win"', () => {
    expect(uiPlatform(normalizeOsInfo('darwin'))).toBe('macos');
  });

  it('falls back to windows when the platform is unknown', () => {
    expect(uiPlatform(normalizeOsInfo('FreeBSD'))).toBe('windows');
  });
});
