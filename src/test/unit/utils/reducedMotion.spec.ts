import { describe, it, expect, vi, afterEach } from 'vitest';
import { prefersReducedMotion, motionDuration } from '../../../utils/reducedMotion';

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prefersReducedMotion', () => {
  it('matchMedia 返回 true 时返回 true', () => {
    mockMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('matchMedia 返回 false 时返回 false', () => {
    mockMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('window 不存在时返回 false', () => {
    vi.stubGlobal('window', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('motionDuration', () => {
  it('偏好减弱动效时返回 0', () => {
    mockMatchMedia(true);
    expect(motionDuration(300)).toBe(0);
  });

  it('无减弱动效偏好时原样返回传入时长', () => {
    mockMatchMedia(false);
    expect(motionDuration(300)).toBe(300);
    expect(motionDuration(0)).toBe(0);
  });
});
