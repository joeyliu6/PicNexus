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

  it('splits eight petals by state beyond eight hosts, normal first and problems last', () => {
    const states = [...Array<'waiting'>(4).fill('waiting'), ...Array<'ok'>(5).fill('ok'), ...Array<'uploading'>(3).fill('uploading')];
    expect(layoutPetals(states).petals.map((p) => p.state)).toEqual([
      'ok', 'ok', 'ok', 'uploading', 'uploading', 'waiting', 'waiting', 'waiting',
    ]);
  });

  it('keeps one red petal when a single host out of many fails', () => {
    const states = [...Array<'ok'>(8).fill('ok'), 'failed' as const, 'ok' as const, 'ok' as const, 'ok' as const];
    const shown = layoutPetals(states).petals.map((p) => p.state);
    expect(shown).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'failed']);
  });

  it('gives every state that occurs at least one petal', () => {
    const states = [...Array<'ok'>(11).fill('ok'), 'failed', 'limited', 'empty', 'waiting', 'uploading'] as const;
    expect(layoutPetals(states).petals.map((p) => p.state)).toEqual([
      'ok', 'ok', 'ok', 'uploading', 'waiting', 'empty', 'limited', 'failed',
    ]);
  });

  it('does not give a state raised to one petal a second one', () => {
    const states = [...Array<'ok'>(4).fill('ok'), ...Array<'waiting'>(4).fill('waiting'), 'failed' as const];
    expect(layoutPetals(states).petals.map((p) => p.state)).toEqual([
      'ok', 'ok', 'ok', 'ok', 'waiting', 'waiting', 'waiting', 'failed',
    ]);
  });

  it('matches the two widths drawn in the design', () => {
    expect(petalWidthScale(6)).toBe(0.74);
    expect(petalWidthScale(8)).toBe(0.56);
  });
});
