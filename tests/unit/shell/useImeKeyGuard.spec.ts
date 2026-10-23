// 输入法选字时按的键归输入法：拼音打英文时用 Enter 上屏，这一下不能被界面当成「提交」
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useImeKeyGuard } from '@/shell/useImeKeyGuard';

let wrapper: VueWrapper | undefined;

function mountWithField() {
  const onKeydown = vi.fn();
  wrapper = mount(defineComponent({
    setup() {
      useImeKeyGuard();
      return () => h('input', { class: 'field', onKeydown });
    },
  }), { attachTo: document.body });
  return { field: wrapper.get('.field').element, onKeydown };
}

afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

describe('useImeKeyGuard', () => {
  it('keeps the Enter that picks IME text away from the interface', () => {
    const { field, onKeydown } = mountWithField();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    expect(onKeydown).not.toHaveBeenCalled();
  });

  // macOS / Linux 的 WebKit：上屏的 Enter 排在选字结束之后，isComposing 已是 false，只剩 keyCode 229
  it('also catches the WebKit commit Enter that only carries keyCode 229', () => {
    const { field, onKeydown } = mountWithField();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }));
    expect(onKeydown).not.toHaveBeenCalled();
  });

  it('lets an ordinary Enter through', () => {
    const { field, onKeydown } = mountWithField();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    expect(onKeydown).toHaveBeenCalledTimes(1);
  });
});
