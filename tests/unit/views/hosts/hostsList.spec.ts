// 左栏键盘：↑↓ 按眼前的顺序换行（排序变了也一样）、空格切换启用、Enter 打开
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import HostsList from '@/views/hosts/HostsList.vue';
import type { HostRow } from '@/views/hosts/hostList';

const row = (id: string, enabled = true): HostRow => ({ id, name: id, enabled, problem: null, sub: '', testing: false });

function mountList(rows: HostRow[]) {
  return mount(HostsList, {
    props: { rows, selectedId: rows[0].id, adding: false, listOnly: false },
    attachTo: document.body,
    global: { stubs: { TransferButton: true, WindowControls: true } },
  });
}

describe('HostsList', () => {
  it('排序变了以后，↓ 仍落到眼前的下一行', async () => {
    const wrapper = mountList([row('a'), row('b'), row('c')]);
    await wrapper.setProps({ rows: [row('c'), row('a'), row('b')], selectedId: 'c' });
    const options = wrapper.findAll('[role="option"]');
    (options[0].element as HTMLElement).focus();
    await options[0].trigger('keydown', { key: 'ArrowDown' });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement?.textContent).toContain('a');
    wrapper.unmount();
  });

  it('空格切换启用、Enter 打开', async () => {
    const wrapper = mountList([row('a'), row('b')]);
    const first = wrapper.findAll('[role="option"]')[0];
    await first.trigger('keydown', { key: ' ' });
    await first.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('toggle')).toEqual([['a']]);
    expect(wrapper.emitted('select')).toEqual([['a']]);
    wrapper.unmount();
  });

  it('指针在清单里时不重排（免得按钮落到另一个图床上），离开后再排', async () => {
    const wrapper = mountList([row('a'), row('b')]);
    const list = wrapper.get('[role="listbox"]');
    await list.trigger('pointerenter');
    // 停用了 a：父组件给的顺序变成 b、a
    await wrapper.setProps({ rows: [row('b'), row('a', false)] });
    expect(wrapper.findAll('[role="option"]').map((o) => o.text())).toEqual([expect.stringContaining('a'), expect.stringContaining('b')]);
    await list.trigger('pointerleave');
    expect(wrapper.findAll('[role="option"]')[0].text()).toContain('b');
    wrapper.unmount();
  });
});
