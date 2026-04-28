import { describe, expect, it } from 'vitest';
import { mountWithDefaults } from '../../../helpers/vueMount';
import CheckBottomActions from '../../../../components/views/linkcheck/history-check/CheckBottomActions.vue';

const baseProps = {
  isChecking: false,
  isPaused: false,
  hasSelection: false,
  isAllSelected: false,
  selectedCount: 0,
  isActionLocked: false,
  smartCheckLabel: '开始检测',
  smartCheckTooltip: '开始检测全部链接',
  moreMenuItems: [
    { kind: 'export' as const, label: '导出', icon: 'pi-download', count: 8 },
    { kind: 'copy' as const, label: '复制链接', icon: 'pi-copy', count: 8 },
    { kind: 'delete' as const, label: '删除', icon: 'pi-trash', count: 8, danger: true },
  ],
  moreMenuScopeLabel: '针对当前筛选',
  showOverflowMenu: false,
};

function mountActions(props = {}) {
  return mountWithDefaults(CheckBottomActions, {
    props: {
      ...baseProps,
      ...props,
    },
  });
}

describe('CheckBottomActions', () => {
  it('检测中展示暂停和取消操作', async () => {
    const wrapper = mountActions({ isChecking: true });

    await wrapper.get('.btn-ghost').trigger('click');
    await wrapper.get('.btn-danger').trigger('click');

    expect(wrapper.text()).toContain('暂停');
    expect(wrapper.text()).toContain('取消');
    expect(wrapper.emitted('pause-check')).toHaveLength(1);
    expect(wrapper.emitted('cancel-check')).toHaveLength(1);
  });

  it('暂停态点击继续会 emit resume-check', async () => {
    const wrapper = mountActions({ isChecking: true, isPaused: true });

    await wrapper.get('.btn-primary').trigger('click');

    expect(wrapper.text()).toContain('继续');
    expect(wrapper.emitted('resume-check')).toHaveLength(1);
  });

  it('有选择时可以清空选择、全选和触发智能检测', async () => {
    const wrapper = mountActions({
      hasSelection: true,
      selectedCount: 3,
      isAllSelected: false,
      smartCheckLabel: '重检选中 (3)',
    });

    await wrapper.get('.selection-chip').trigger('click');
    await wrapper.findAll('.btn-ghost').find(button => button.text() === '全选')!.trigger('click');
    await wrapper.get('.btn-primary').trigger('click');

    expect(wrapper.text()).toContain('已选 3 条');
    expect(wrapper.emitted('clear-selection')).toHaveLength(1);
    expect(wrapper.emitted('toggle-select-all')).toHaveLength(1);
    expect(wrapper.emitted('smart-check')).toHaveLength(1);
  });

  it('更多菜单会透传批量动作并关闭菜单', async () => {
    const wrapper = mountActions({ showOverflowMenu: true });
    const deleteItem = wrapper.findAll('.overflow-dropdown-item')
      .find(item => item.text().includes('删除'))!;

    await deleteItem.trigger('click');

    expect(wrapper.emitted('more-action')).toEqual([['delete']]);
    expect(wrapper.emitted('update:showOverflowMenu')).toEqual([[false]]);
  });

  it('锁定态禁用空闲操作按钮', () => {
    const wrapper = mountActions({ isActionLocked: true, hasSelection: true, selectedCount: 2 });

    expect(wrapper.get('.selection-chip').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.btn-primary').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.overflow-toggle').attributes('disabled')).toBeDefined();
  });
});
