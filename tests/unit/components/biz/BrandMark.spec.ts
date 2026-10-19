import { describe, expect, it } from 'vitest';
import BrandMark from '@/components/biz/BrandMark.vue';
import { mountWithDefaults } from '../../helpers/vueMount';

// ⑦ 拖入感应（M07）：四片花瓣各朝自己的方向张开，拖出时合拢
describe('BrandMark', () => {
  it('opens the four petals outward while receiving a drop and closes them afterwards', async () => {
    const wrapper = mountWithDefaults(BrandMark, { props: { open: false } });
    expect(wrapper.classes()).not.toContain('brand-mark--open');
    expect(wrapper.findAll('path').map((p) => p.classes().find((c) => c.startsWith('brand-mark__petal--'))))
      .toEqual(['brand-mark__petal--up', 'brand-mark__petal--right', 'brand-mark__petal--down', 'brand-mark__petal--left']);

    await wrapper.setProps({ open: true });
    expect(wrapper.classes()).toContain('brand-mark--open');
    await wrapper.setProps({ open: false });
    expect(wrapper.classes()).not.toContain('brand-mark--open');
    wrapper.unmount();
  });
});
