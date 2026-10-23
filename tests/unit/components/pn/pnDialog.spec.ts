// 弹窗里单行输入框按 Enter = 点主按钮（同系统对话框的默认按钮），连按也只提交一次
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';

let wrapper: VueWrapper | undefined;

interface Options {
  variant?: 'primary' | 'danger';
  disabled?: boolean;
  /** 输入框自己处理 Enter（如压缩方案「回车保存这一项」） */
  fieldHandlesEnter?: boolean;
}

async function mountDialog(options: Options = {}) {
  const onMain = vi.fn();
  const onCancel = vi.fn();
  wrapper = mount(defineComponent({
    setup: () => () => h(PnDialog, { open: true, title: '更换端口' }, {
      default: () => [
        h('input', { class: 'field', onKeydown: options.fieldHandlesEnter ? (e: KeyboardEvent) => { if (e.key === 'Enter') e.preventDefault(); } : undefined }),
        h('textarea', { class: 'notes' }),
        h('input', { class: 'check', type: 'checkbox' }),
      ],
      footer: () => [
        h(PnButton, { variant: 'secondary', size: 'dialog', onClick: onCancel }, () => '取消'),
        h(PnButton, { variant: options.variant ?? 'primary', size: 'dialog', disabled: options.disabled, onClick: onMain }, () => '更换'),
      ],
    }),
  }), { attachTo: document.body });
  await nextTick();
  return { onMain, onCancel };
}

const el = (selector: string) => document.body.querySelector<HTMLElement>(selector)!;
const pressEnter = (target: HTMLElement, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

describe('PnDialog Enter', () => {
  it('Enter in a text field clicks the main button, not the others', async () => {
    const { onMain, onCancel } = await mountDialog();
    pressEnter(el('.field'));
    expect(onMain).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a red main button counts too (turning the backup password off)', async () => {
    const { onMain } = await mountDialog({ variant: 'danger' });
    pressEnter(el('.field'));
    expect(onMain).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the main button cannot be clicked (not filled in, or still submitting)', async () => {
    const { onMain } = await mountDialog({ disabled: true });
    pressEnter(el('.field'));
    expect(onMain).not.toHaveBeenCalled();
  });

  it('leaves Enter alone when the field already used it', async () => {
    const { onMain } = await mountDialog({ fieldHandlesEnter: true });
    pressEnter(el('.field'));
    expect(onMain).not.toHaveBeenCalled();
  });

  it('a new line in a text area, modifier combos and checkboxes are not a submit', async () => {
    const { onMain } = await mountDialog();
    pressEnter(el('.notes'));
    pressEnter(el('.field'), { shiftKey: true });
    pressEnter(el('.field'), { ctrlKey: true });
    pressEnter(el('.check'));
    expect(onMain).not.toHaveBeenCalled();
  });
});
