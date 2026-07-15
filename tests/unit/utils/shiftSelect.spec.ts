import { describe, it, expect } from 'vitest';
import { shiftSelect, type ShiftSelectAnchor } from '@/utils/shiftSelect';

const EMPTY_ANCHOR: ShiftSelectAnchor = { lastId: null, wasSelect: false };
const IDS = ['a', 'b', 'c', 'd', 'e'];

describe('shiftSelect - 普通 toggle', () => {
  it('未按 shift 时为加选，返回新 Set 并更新锚点', () => {
    const result = shiftSelect('b', false, IDS, new Set(), EMPTY_ANCHOR);
    expect([...result.nextSet]).toEqual(['b']);
    expect(result.anchor).toEqual({ lastId: 'b', wasSelect: true });
  });

  it('未按 shift 对已选项取消，锚点记录为取消操作', () => {
    const result = shiftSelect('b', false, IDS, new Set(['b']), EMPTY_ANCHOR);
    expect([...result.nextSet]).toEqual([]);
    expect(result.anchor).toEqual({ lastId: 'b', wasSelect: false });
  });
});

describe('shiftSelect - shift + 范围', () => {
  it('上次是加选 → 范围内批量加选', () => {
    const anchor: ShiftSelectAnchor = { lastId: 'b', wasSelect: true };
    const result = shiftSelect('d', true, IDS, new Set(['b']), anchor);
    expect([...result.nextSet].sort()).toEqual(['b', 'c', 'd']);
    // shift+click 不更新锚点
    expect(result.anchor).toEqual(anchor);
  });

  it('上次是取消 → 范围内批量取消', () => {
    const anchor: ShiftSelectAnchor = { lastId: 'b', wasSelect: false };
    const result = shiftSelect('d', true, IDS, new Set(['a', 'b', 'c', 'd', 'e']), anchor);
    expect([...result.nextSet].sort()).toEqual(['a', 'e']);
  });

  it('反向范围（to < from）同样工作', () => {
    const anchor: ShiftSelectAnchor = { lastId: 'd', wasSelect: true };
    const result = shiftSelect('b', true, IDS, new Set(), anchor);
    expect([...result.nextSet].sort()).toEqual(['b', 'c', 'd']);
  });

  it('按 shift 但锚点为 null → 降级为普通 toggle', () => {
    const result = shiftSelect('b', true, IDS, new Set(), EMPTY_ANCHOR);
    expect([...result.nextSet]).toEqual(['b']);
    expect(result.anchor.lastId).toBe('b');
  });

  it('锚点 id 不在 orderedIds → 降级为普通 toggle', () => {
    const anchor: ShiftSelectAnchor = { lastId: 'ghost', wasSelect: true };
    const result = shiftSelect('b', true, IDS, new Set(), anchor);
    expect([...result.nextSet]).toEqual(['b']);
    expect(result.anchor).toEqual({ lastId: 'b', wasSelect: true });
  });

  it('点击 id 不在 orderedIds → 降级为普通 toggle', () => {
    const anchor: ShiftSelectAnchor = { lastId: 'a', wasSelect: true };
    const result = shiftSelect('missing', true, IDS, new Set(), anchor);
    expect([...result.nextSet]).toEqual(['missing']);
  });

  it('锚点同一项 shift+click → 仍能正确加选', () => {
    const anchor: ShiftSelectAnchor = { lastId: 'b', wasSelect: true };
    const result = shiftSelect('b', true, IDS, new Set(['b']), anchor);
    expect([...result.nextSet]).toEqual(['b']);
  });
});
