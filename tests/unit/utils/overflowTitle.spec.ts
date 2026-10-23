// 被省略号截断的文件名：悬停时用系统提示补全名；没被截断的不出提示（免得每个名字都冒一个）
import { describe, expect, it } from 'vitest';
import { defineComponent, h, withDirectives } from 'vue';
import { mount } from '@vue/test-utils';
import { vOverflowTitle } from '@/utils/overflowTitle';

function mountName(text: string, widths: { scroll: number; client: number }) {
  const wrapper = mount(defineComponent({
    render: () => withDirectives(h('span', { class: 'name' }, text), [[vOverflowTitle]]),
  }));
  const el = wrapper.get('.name').element as HTMLElement;
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => widths.scroll });
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => widths.client });
  return { wrapper, el };
}

describe('vOverflowTitle', () => {
  it('shows the full name on hover when the text is cut off', async () => {
    const { wrapper, el } = mountName('微信图片_20261023152233_1234567890abcdef.jpg', { scroll: 420, client: 180 });
    await wrapper.get('.name').trigger('mouseenter');
    expect(el.title).toBe('微信图片_20261023152233_1234567890abcdef.jpg');
  });

  it('adds no tooltip when the whole name fits', async () => {
    const { wrapper, el } = mountName('短名字.png', { scroll: 80, client: 180 });
    await wrapper.get('.name').trigger('mouseenter');
    expect(el.hasAttribute('title')).toBe(false);
  });

  it('drops the tooltip once the name fits again (wider window)', async () => {
    const widths = { scroll: 420, client: 180 };
    const { wrapper, el } = mountName('很长的名字.png', widths);
    await wrapper.get('.name').trigger('mouseenter');
    expect(el.title).toBe('很长的名字.png');
    widths.client = 600;
    await wrapper.get('.name').trigger('mouseenter');
    expect(el.hasAttribute('title')).toBe(false);
  });
});
