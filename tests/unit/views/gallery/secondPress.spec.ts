// 双击在第二次按下时就算（同 Windows）；按在格子里的按钮上不算
import { describe, expect, it } from 'vitest';
import { isSecondPress } from '@/views/gallery/secondPress';

function press(target: Element, init: MouseEventInit): MouseEvent {
  const event = new MouseEvent('mousedown', { bubbles: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('isSecondPress', () => {
  const tile = document.createElement('div');
  tile.innerHTML = '<span class="name">a.png</span><button type="button" class="star"><svg><path /></svg></button>';
  const name = tile.querySelector('.name')!;

  it('is the second left press of a double-click', () => {
    expect(isSecondPress(press(name, { button: 0, detail: 2 }))).toBe(true);
  });

  it('is not the first or a third press, nor another button', () => {
    expect(isSecondPress(press(name, { button: 0, detail: 1 }))).toBe(false);
    expect(isSecondPress(press(name, { button: 0, detail: 3 }))).toBe(false);
    expect(isSecondPress(press(name, { button: 2, detail: 2 }))).toBe(false);
  });

  it('does not count presses on a button inside the tile (pressing the star twice is two favourites)', () => {
    expect(isSecondPress(press(tile.querySelector('.star')!, { button: 0, detail: 2 }))).toBe(false);
    expect(isSecondPress(press(tile.querySelector('path')!, { button: 0, detail: 2 }))).toBe(false);
  });
});
