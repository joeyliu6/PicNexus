// 图库用键盘移除记录（同资源管理器 / 访达）：哪一下算「移除」，移除之后焦点给谁
import { describe, expect, it } from 'vitest';
import { focusAfterRemoval, isRemoveKey } from '@/views/gallery/keyboardRemove';

const press = (key: string, mods: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>> = {}) =>
  new KeyboardEvent('keydown', { key, ...mods });

describe('isRemoveKey', () => {
  it('Windows / Linux：单按 Delete；Backspace 与带修饰键的 Delete 不算', () => {
    for (const platform of ['windows', 'linux'] as const) {
      expect(isRemoveKey(press('Delete'), platform)).toBe(true);
      expect(isRemoveKey(press('Backspace'), platform)).toBe(false);
      expect(isRemoveKey(press('Delete', { ctrlKey: true }), platform)).toBe(false);
      expect(isRemoveKey(press('Delete', { shiftKey: true }), platform)).toBe(false);
      expect(isRemoveKey(press('Delete', { altKey: true }), platform)).toBe(false);
    }
  });

  it('macOS：⌘⌫；单按 ⌫、⌃⌫、⌥⌘⌫ 都不算', () => {
    expect(isRemoveKey(press('Backspace', { metaKey: true }), 'macos')).toBe(true);
    expect(isRemoveKey(press('Backspace'), 'macos')).toBe(false);
    expect(isRemoveKey(press('Backspace', { ctrlKey: true }), 'macos')).toBe(false);
    expect(isRemoveKey(press('Backspace', { metaKey: true, altKey: true }), 'macos')).toBe(false);
    expect(isRemoveKey(press('Delete'), 'macos')).toBe(false);
  });
});

describe('focusAfterRemoval', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('移除焦点那张：给后面一张；它是最后一张就给前面一张', () => {
    expect(focusAfterRemoval(order, new Set(['c']), 'c')).toBe('d');
    expect(focusAfterRemoval(order, new Set(['e']), 'e')).toBe('d');
  });

  it('连着移除几张：越过被移除的，给后面第一张还在的；后面都没了就往前找', () => {
    expect(focusAfterRemoval(order, new Set(['b', 'c', 'd']), 'b')).toBe('e');
    expect(focusAfterRemoval(order, new Set(['c', 'd', 'e']), 'd')).toBe('b');
  });

  it('焦点那张没被移除（移除的是别处选中的）：焦点留在它身上', () => {
    expect(focusAfterRemoval(order, new Set(['a', 'e']), 'c')).toBe('c');
  });

  it('没有焦点（或焦点那张不在眼前）：从第一张被移除的往后找', () => {
    expect(focusAfterRemoval(order, new Set(['b', 'd']), null)).toBe('c');
    expect(focusAfterRemoval(order, new Set(['b']), 'zz')).toBe('c');
  });

  it('全部移除、或移除的都不在眼前：没有可给的', () => {
    expect(focusAfterRemoval(order, new Set(order), 'a')).toBeNull();
    expect(focusAfterRemoval(order, new Set(['x']), null)).toBeNull();
    expect(focusAfterRemoval([], new Set(['a']), 'a')).toBeNull();
  });
});
