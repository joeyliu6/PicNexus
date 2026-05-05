import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import BackupPasswordDialog from '../../../components/dialogs/BackupPasswordDialog.vue';

const PasswordStub = {
  props: ['modelValue', 'inputProps', 'placeholder'],
  emits: ['update:modelValue', 'keydown'],
  template: `
    <input
      class="password-stub"
      :autocomplete="inputProps?.autocomplete"
      :placeholder="placeholder"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
      @keydown="$emit('keydown', $event)"
    />
  `,
};

const ButtonStub = {
  props: ['label', 'loading', 'severity'],
  emits: ['click'],
  template: `
    <button
      class="button-stub"
      :data-label="label"
      :data-loading="String(loading)"
      :data-severity="severity || ''"
      @click="$emit('click')"
    >
      {{ label }}
    </button>
  `,
};

function mountDialog(mode: 'set' | 'change' | 'disable' | 'restore') {
  return mountWithDefaults(BackupPasswordDialog, {
    props: {
      modelValue: true,
      mode,
    },
    global: {
      stubs: {
        Dialog: {
          props: ['visible', 'header'],
          emits: ['update:visible', 'hide'],
          template: `
            <section class="dialog-stub" :data-header="header">
              <slot />
              <footer><slot name="footer" /></footer>
            </section>
          `,
        },
        Password: PasswordStub,
        Button: ButtonStub,
      },
    },
  });
}

async function fillInput(wrapper: ReturnType<typeof mountDialog>, index: number, value: string) {
  const input = wrapper.findAll('.password-stub')[index];
  await input.setValue(value);
}

async function submit(wrapper: ReturnType<typeof mountDialog>) {
  await wrapper.findAll('.button-stub').at(-1)!.trigger('click');
}

describe('BackupPasswordDialog', () => {
  it('emits set payload after validating password strength and confirmation', async () => {
    const wrapper = mountDialog('set');

    await fillInput(wrapper, 0, 'Password123');
    await fillInput(wrapper, 1, 'Password123');
    await submit(wrapper);

    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ mode: 'set', password: 'Password123' }]);
  });

  it('does not submit set mode when confirmation mismatches', async () => {
    const wrapper = mountDialog('set');

    await fillInput(wrapper, 0, 'Password123');
    await fillInput(wrapper, 1, 'Password456');
    await submit(wrapper);

    expect(wrapper.emitted('confirm')).toBeUndefined();
    expect(wrapper.text()).toContain('两次输入的密码不一致');
  });

  it('emits change payload with current and new password', async () => {
    const wrapper = mountDialog('change');

    await fillInput(wrapper, 0, 'OldPassword123');
    await fillInput(wrapper, 1, 'NewPassword123');
    await fillInput(wrapper, 2, 'NewPassword123');
    await submit(wrapper);

    expect(wrapper.emitted('confirm')?.[0]).toEqual([{
      mode: 'change',
      currentPassword: 'OldPassword123',
      newPassword: 'NewPassword123',
      confirmPassword: 'NewPassword123',
    }]);
  });

  it('shows current password field error for change mode password failures', async () => {
    const wrapper = mountDialog('change');

    await fillInput(wrapper, 0, 'WrongPassword123');
    await fillInput(wrapper, 1, 'NewPassword123');
    await fillInput(wrapper, 2, 'NewPassword123');
    await submit(wrapper);
    (wrapper.vm as unknown as { onPasswordFailed: () => void }).onPasswordFailed();
    await nextTick();

    expect(wrapper.text()).toContain('密码不正确');
    expect((wrapper.findAll('.password-stub')[0].element as HTMLInputElement).value).toBe('');
  });

  it('emits disable payload and uses danger submit severity', async () => {
    const wrapper = mountDialog('disable');

    await fillInput(wrapper, 0, 'CurrentPassword123');
    await submit(wrapper);

    expect(wrapper.emitted('confirm')?.[0]).toEqual([{
      mode: 'disable',
      currentPassword: 'CurrentPassword123',
    }]);
    expect(wrapper.findAll('.button-stub').at(-1)!.attributes('data-severity')).toBe('danger');
  });

  it('emits restore payload and reports restore password failures with attempts', async () => {
    const wrapper = mountDialog('restore');

    await fillInput(wrapper, 0, 'RestorePassword123');
    await submit(wrapper);
    (wrapper.vm as unknown as { onPasswordFailed: () => void }).onPasswordFailed();
    await nextTick();

    expect(wrapper.emitted('confirm')?.[0]).toEqual([{
      mode: 'restore',
      password: 'RestorePassword123',
    }]);
    expect(wrapper.text()).toContain('剩余尝试次数：4');
  });
});
