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
});
