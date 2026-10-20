// 焦点卡「按图床复制」：点了要看得到反馈——即使点的正是自动复制的那份（它平时就带 ✓，只换图标看不出变化）
import { describe, expect, it } from 'vitest';
import FocusHostChips from '@/views/home/FocusHostChips.vue';
import { mountWithDefaults } from '../../helpers/vueMount';

describe('FocusHostChips', () => {
  it('点自动复制的那一枚：发 copyHost，原地变「已复制」', async () => {
    const wrapper = mountWithDefaults(FocusHostChips, {
      props: { hostIds: ['jd', 'r2'], nameOf: (id: string) => ({ jd: '京东', r2: 'Cloudflare R2' })[id] ?? id, autoCopiedId: 'jd' },
    });
    const chip = wrapper.findAll('.focus-chips__chip')[0];
    expect(chip.text()).toBe('京东');
    await chip.trigger('click');
    expect(wrapper.emitted('copyHost')).toEqual([['jd']]);
    expect(chip.text()).toBe('已复制');
    expect(chip.classes()).toContain('focus-chips__chip--done');
    expect(wrapper.findAll('.focus-chips__chip')[1].text()).toBe('Cloudflare R2');
  });
});
