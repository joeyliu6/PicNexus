import { describe, expect, it } from 'vitest';
import { mountWithDefaults } from '../../helpers/vueMount';
import CheckFilterBar from '@/components/views/linkcheck/history-check/CheckFilterBar.vue';
import type { CheckStatsResult } from '@/composables/link-check/useCheckStats';

const stats: CheckStatsResult = {
  total: 12,
  valid: 5,
  invalid: 3,
  timeout: 2,
  suspicious: 1,
  unchecked: 1,
  checked: 11,
  problems: 6,
};

function mountFilterBar(props = {}) {
  return mountWithDefaults(CheckFilterBar, {
    props: {
      stats,
      serviceList: [
        { id: 'jd', count: 7 },
        { id: 'github', count: 5 },
      ],
      isLoading: false,
      isChecking: false,
      isPhase2Loading: false,
      phase2Duration: 0,
      statusFilter: 'invalid',
      selectedServiceId: null,
      showServiceMenu: false,
      searchInput: '',
      searchQuery: '',
      searchFocused: false,
      ...props,
    },
    global: {
      stubs: {
        Skeleton: { template: '<span class="skeleton-stub" />' },
      },
    },
  });
}

describe('CheckFilterBar', () => {
  it('点击状态 chip 会更新状态筛选', async () => {
    const wrapper = mountFilterBar();

    await wrapper.get('.chip--error').trigger('click');
    expect(wrapper.emitted('update:statusFilter')).toBeUndefined();

    await wrapper.get('.chip--valid').trigger('click');

    expect(wrapper.emitted('update:statusFilter')).toEqual([['valid']]);
  });

  it('问题 chip 明确选择问题链接聚合筛选', async () => {
    const wrapper = mountFilterBar({ statusFilter: 'invalid' });

    await wrapper.get('.chip--problems').trigger('click');

    expect(wrapper.emitted('update:statusFilter')).toEqual([['problems']]);
  });

  it('支持图床下拉筛选与清空筛选', async () => {
    const wrapper = mountFilterBar({ showServiceMenu: true, selectedServiceId: 'jd' });
    const items = wrapper.findAll('.service-dropdown-item');

    await items[0].trigger('click');
    await items[2].trigger('click');

    expect(wrapper.emitted('update:selectedServiceId')).toEqual([
      [null],
      ['github'],
    ]);
    expect(wrapper.emitted('update:showServiceMenu')).toEqual([[false]]);
  });

  it('搜索框聚焦、输入与清空都会通过 v-model 上报', async () => {
    const wrapper = mountFilterBar({ searchInput: 'broken', searchQuery: 'broken' });
    const input = wrapper.get('input[aria-label="搜索链接文件名"]');

    await input.trigger('focus');
    await input.setValue('image-42');
    await wrapper.get('.search-field-clear').trigger('click');
    await input.trigger('blur');

    expect(wrapper.emitted('update:searchFocused')).toEqual([[true], [false]]);
    expect(wrapper.emitted('update:searchInput')).toEqual([
      ['image-42'],
      [''],
    ]);
    expect(wrapper.emitted('update:searchQuery')).toEqual([['']]);
  });

  it('首屏加载时渲染骨架并保持 aria-busy', () => {
    const wrapper = mountFilterBar({
      isLoading: true,
      isChecking: true,
      stats: { ...stats, total: 0 },
      serviceList: [],
    });

    expect(wrapper.get('.chip-bar').attributes('aria-busy')).toBe('true');
    expect(wrapper.findAll('.skeleton-stub').length).toBeGreaterThan(0);
  });
});
