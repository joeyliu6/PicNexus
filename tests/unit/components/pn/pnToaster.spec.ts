import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import PnToaster from '@/components/pn/PnToaster.vue';
import { __resetToastsForTests, pushToast } from '@/components/pn/toastStore';

// 待拍板 ㊱（选 A）：T05 叠放三条时只把最旧的一条画淡（0.92），其余两条照常
describe('PnToaster', () => {
  beforeEach(() => {
    __resetToastsForTests();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const dimmed = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.pn-toast').map((el) => el.classes('pn-toast--older'));

  it('dims only the oldest of the stacked toasts', async () => {
    const wrapper = mount(PnToaster);
    pushToast({ kind: 'info', title: 'a' });
    await nextTick();
    expect(dimmed(wrapper)).toEqual([false]);

    pushToast({ kind: 'info', title: 'b' });
    pushToast({ kind: 'info', title: 'c' });
    await nextTick();
    expect(dimmed(wrapper)).toEqual([true, false, false]);
  });
});
