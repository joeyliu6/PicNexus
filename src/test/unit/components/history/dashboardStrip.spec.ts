import { describe, expect, it } from 'vitest';
import { mountWithDefaults } from '../../../helpers/vueMount';
import { flushPromisesAndTicks, useFakeTimers } from '../../../helpers/wait';
import DashboardStrip from '../../../../components/views/history/DashboardStrip.vue';

const InputTextStub = {
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  template: `
    <input
      class="p-inputtext search-field-input"
      :value="modelValue"
      :placeholder="placeholder"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  `,
};

function mountStrip(props = {}) {
  return mountWithDefaults(DashboardStrip, {
    props: {
      viewMode: 'table',
      filter: 'all',
      totalCount: 42,
      serviceCounts: [
        { id: 'jd', count: 20 },
        { id: 'github', count: 12 },
      ],
      ...props,
    },
    global: {
      stubs: {
        InputText: InputTextStub,
      },
    },
  });
}

describe('DashboardStrip', () => {
  it('切换视图会 emit update:viewMode', async () => {
    const wrapper = mountStrip();

    await wrapper.findAll('.tab-btn').find(button => button.text().includes('时间轴'))!.trigger('click');
    await wrapper.findAll('.tab-btn').find(button => button.text().includes('收藏'))!.trigger('click');

    expect(wrapper.emitted('update:viewMode')).toEqual([['timeline'], ['favorites']]);
  });

  it('图床筛选下拉支持选择服务和回到全部', async () => {
    const wrapper = mountStrip({ filter: 'github' });

    await wrapper.get('.filter-chip').trigger('click');
    await wrapper.findAll('.service-dropdown-item')
      .find(item => item.text().includes('京东'))!
      .trigger('click');

    await wrapper.setProps({ filter: 'jd' });
    await wrapper.get('.filter-chip').trigger('click');
    await wrapper.findAll('.service-dropdown-item')[0].trigger('click');

    expect(wrapper.emitted('update:filter')).toEqual([['jd'], ['all']]);
  });

  it('搜索输入防抖 emit，清空按钮立即 emit 空搜索', async () => {
    const timers = useFakeTimers();
    const wrapper = mountStrip();

    await wrapper.get('.search-field-input').setValue('holiday');
    await timers.advanceBy(300);
    await flushPromisesAndTicks();

    expect(wrapper.emitted('update:searchTerm')).toEqual([['holiday']]);

    await wrapper.get('.search-field-clear').trigger('click');
    expect(wrapper.emitted('update:searchTerm')).toEqual([['holiday'], ['']]);
    timers.restore();
  });

  it('切换筛选前会立即同步 pending 搜索词，避免父级重复加载', async () => {
    const timers = useFakeTimers();
    const wrapper = mountStrip();

    await wrapper.get('.search-field-input').setValue('pending keyword');
    await wrapper.get('.filter-chip').trigger('click');
    await wrapper.findAll('.service-dropdown-item')
      .find(item => item.text().includes('GitHub'))!
      .trigger('click');

    expect(wrapper.emitted('update:searchTerm')).toEqual([['pending keyword']]);
    expect(wrapper.emitted('update:filter')).toEqual([['github']]);
    timers.restore();
  });
});
