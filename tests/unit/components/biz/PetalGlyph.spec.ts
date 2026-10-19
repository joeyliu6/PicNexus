import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import PetalGlyph from '@/components/biz/PetalGlyph.vue';
import { mountWithDefaults } from '../../helpers/vueMount';

const mounted: VueWrapper[] = [];

function mountGlyph(props: Record<string, unknown>, onPage = true) {
  const wrapper = mountWithDefaults(PetalGlyph, { props: { states: ['ok', 'uploading'], ...props }, ...(onPage ? { attachTo: document.body } : {}) });
  mounted.push(wrapper);
  return wrapper;
}

const blooming = (wrapper: VueWrapper) => wrapper.classes().includes('petals--bloom') && wrapper.find('.petals__ripple').exists();

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

// ⑥ 完成绽放（M06）：复制成功的那一刻绽放一次
describe('PetalGlyph bloom', () => {
  it('stays still when the card opens with a link that was already copied', async () => {
    const wrapper = mountGlyph({ bloomKey: { count: 1, format: 'url' } });
    await flushPromises();
    expect(blooming(wrapper)).toBe(false);
  });

  it('blooms once when a copy succeeds and settles when the animation ends', async () => {
    const wrapper = mountGlyph({ bloomKey: null });
    await wrapper.setProps({ bloomKey: { count: 1, format: 'url' } });
    await flushPromises();
    expect(blooming(wrapper)).toBe(true);

    await wrapper.find('svg').trigger('animationend');
    expect(blooming(wrapper)).toBe(false);
  });

  // 首页在 KeepAlive 里：去了别的页面时焦点卡只是移出页面，这时复制好的回来不补播
  it('does not bloom while the card is off the page', async () => {
    const wrapper = mountGlyph({ bloomKey: null }, false);
    await wrapper.setProps({ bloomKey: { count: 1, format: 'url' } });
    await flushPromises();
    expect(blooming(wrapper)).toBe(false);
  });

  it('does not bloom when the card moves on to an upload that has not been copied', async () => {
    const wrapper = mountGlyph({ bloomKey: { count: 1, format: 'url' } });
    await wrapper.setProps({ bloomKey: null });
    await flushPromises();
    expect(blooming(wrapper)).toBe(false);
  });
});
