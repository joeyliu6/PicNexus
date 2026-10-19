import { describe, expect, it } from 'vitest';
import { shouldBloom } from '@/utils/petalMotion';

describe('shouldBloom', () => {
  const copied = { count: 1, format: 'markdown' };

  it('blooms when the first copy of an upload succeeds', () => {
    expect(shouldBloom(null, copied)).toBe(true);
  });

  it('blooms again for a new copy, even in the same format', () => {
    expect(shouldBloom(copied, { ...copied })).toBe(true);
  });

  it('does not bloom when nothing new was copied', () => {
    expect(shouldBloom(copied, copied)).toBe(false);
  });

  it('does not bloom when the card moves on to the next upload', () => {
    expect(shouldBloom(copied, null)).toBe(false);
    expect(shouldBloom(copied, undefined)).toBe(false);
  });
});
