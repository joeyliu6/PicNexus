import { describe, expect, it } from 'vitest';
import { CLASSIC_PETAL_PATHS, layoutPetals, petalWidthScale } from '@/utils/petals';

describe('layoutPetals', () => {
  it('draws the classic four petals and leaves empty slots for 1–4 hosts', () => {
    const layout = layoutPetals(['ok']);
    expect(layout.petals.map((p) => p.state)).toEqual(['ok', 'empty', 'empty', 'empty']);
    expect(layout.petals.map((p) => p.d)).toEqual([...CLASSIC_PETAL_PATHS]);
    expect(layout.petals.every((p) => p.transform === undefined)).toBe(true);
    expect(layout.overflowCount).toBeNull();
  });

  it('keeps the host order so the failed host is the petal that turns red', () => {
    expect(layoutPetals(['ok', 'ok', 'failed']).petals.map((p) => p.state)).toEqual(['ok', 'ok', 'failed', 'empty']);
  });

  it('draws N narrower petals for 5–8 hosts', () => {
    const layout = layoutPetals(['ok', 'ok', 'ok', 'limited', 'ok', 'ok']);
    expect(layout.petals).toHaveLength(6);
    expect(layout.petals[1].transform).toBe('rotate(60.0 64 64) translate(64 0) scale(0.74 1) translate(-64 0)');
    expect(layout.overflowCount).toBeNull();
  });

  it('caps at eight petals and reports the total beyond that', () => {
    const states = Array.from({ length: 11 }, () => 'ok' as const);
    const layout = layoutPetals(states);
    expect(layout.petals).toHaveLength(8);
    expect(layout.petals[2].transform).toContain('scale(0.56 1)');
    expect(layout.overflowCount).toBe(11);
  });

  it('matches the two widths drawn in the design', () => {
    expect(petalWidthScale(6)).toBe(0.74);
    expect(petalWidthScale(8)).toBe(0.56);
  });
});
