// 备份密码弹窗（D01–D05）：设置要满足前两条且两次一致；修改 / 关闭先验当前密码；还原写剩余次数，用完只剩「跳过」
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import BackupPasswordDialog from '@/components/dialogs/BackupPasswordDialog.vue';

type Mode = 'set' | 'change' | 'disable' | 'restore' | 'unlock';

function mountDialog(mode: Mode) {
  return mount(BackupPasswordDialog, { props: { modelValue: true, mode }, attachTo: document.body });
}

const body = () => document.body;
const input = (id: string) => body().querySelector<HTMLInputElement>(`#${id}`)!;
const button = (label: string) => [...body().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);

async function type(id: string, value: string): Promise<void> {
  const el = input(id);
  el.value = value;
  el.dispatchEvent(new Event('input'));
  await nextTick();
}

afterEach(() => { document.body.innerHTML = ''; });

describe('BackupPasswordDialog', () => {
  it('设置：至少 8 位且含数字、两次一致才能提交', async () => {
    const wrapper = mountDialog('set');
    await nextTick();
    await type('backup-password-new', 'abcdefgh');
    await type('backup-password-confirm', 'abcdefgh');
    expect(button('设置')!.disabled).toBe(true);
    await type('backup-password-new', 'Password123');
    await type('backup-password-confirm', 'Password12');
    expect(body().textContent).toContain('两次输入的密码不一致');
    expect(button('设置')!.disabled).toBe(true);
    await type('backup-password-confirm', 'Password123');
    expect(body().textContent).toContain('✓ 两次输入一致');
    button('设置')!.click();
    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ mode: 'set', password: 'Password123' }]);
  });

  it('修改：当前密码不对时清空当前密码并写原因', async () => {
    const wrapper = mountDialog('change');
    await nextTick();
    await type('backup-password-current', 'Old12345');
    await type('backup-password-new', 'New12345');
    await type('backup-password-confirm', 'New12345');
    button('修改')!.click();
    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ mode: 'change', currentPassword: 'Old12345', newPassword: 'New12345', confirmPassword: 'New12345' }]);
    (wrapper.vm as unknown as { onPasswordFailed: () => void }).onPasswordFailed();
    await nextTick();
    expect(body().textContent).toContain('密码不正确');
    expect(input('backup-password-current').value).toBe('');
  });

  it('关闭：危险按钮写动作「关闭密码」', async () => {
    const wrapper = mountDialog('disable');
    await nextTick();
    await type('backup-password-current', 'Old12345');
    expect(button('关闭密码')!.classList.contains('pn-button--danger')).toBe(true);
    button('关闭密码')!.click();
    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ mode: 'disable', currentPassword: 'Old12345' }]);
  });

  it('还原：写剩余次数，5 次用完后只剩「跳过，使用默认配置」', async () => {
    const wrapper = mountDialog('restore');
    await nextTick();
    expect(button('取消')).toBeUndefined();
    const vm = wrapper.vm as unknown as { onPasswordFailed: () => void };
    vm.onPasswordFailed();
    await nextTick();
    expect(body().textContent).toContain('密码不正确，剩余尝试次数：4');
    for (let i = 0; i < 4; i++) vm.onPasswordFailed();
    await nextTick();
    expect(button('确认恢复')).toBeUndefined();
    expect(body().textContent).toContain('加密的配置文件仍在原处');
    button('跳过，使用默认配置')!.click();
    expect(wrapper.emitted('skip')).toBeTruthy();
  });

  it('解锁（设置页）：可以取消', async () => {
    const wrapper = mountDialog('unlock');
    await nextTick();
    await type('backup-password-current', 'Pass1234');
    button('继续')!.click();
    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ mode: 'unlock', password: 'Pass1234' }]);
    button('取消')!.click();
    expect(wrapper.emitted('cancel')).toBeTruthy();
  });
});
