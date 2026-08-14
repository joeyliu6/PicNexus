import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mountWithDefaults } from '../helpers/vueMount';
import SensitiveField from '@/components/common/SensitiveField.vue';

const InputTextStub = defineComponent({
  name: 'InputText',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'blur'],
  methods: {
    onInput(event: Event) {
      this.$emit('update:modelValue', (event.target as HTMLInputElement).value);
    },
  },
  template: '<input :value="modelValue" @input="onInput" @blur="$emit(\'blur\', $event)" />',
});

const TextareaStub = defineComponent({
  name: 'Textarea',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'blur'],
  methods: {
    onInput(event: Event) {
      this.$emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
    },
  },
  template: '<textarea :value="modelValue" @input="onInput" @blur="$emit(\'blur\', $event)" />',
});

function mountSensitiveField(options: Parameters<typeof mountWithDefaults>[1]) {
  return mountWithDefaults(SensitiveField, {
    ...options,
    global: {
      ...options?.global,
      stubs: {
        ...options?.global?.stubs,
        InputText: InputTextStub,
        Textarea: TextareaStub,
      },
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SensitiveField', () => {
  it('masks single-line values by default and hides them again after a short reveal', async () => {
    vi.useFakeTimers();
    const wrapper = mountSensitiveField({
      props: {
        modelValue: 'secret-token',
      },
    });

    expect(wrapper.get('input').attributes('type')).toBe('password');

    await wrapper.get('button').trigger('click');
    expect(wrapper.get('input').attributes('type')).toBe('text');

    vi.advanceTimersByTime(15_000);
    await nextTick();

    expect(wrapper.get('input').attributes('type')).toBe('password');
  });

  it('conceals the value on blur and emits the blur event', async () => {
    const wrapper = mountSensitiveField({
      props: {
        modelValue: 'secret-token',
      },
    });

    await wrapper.get('button').trigger('click');
    await wrapper.get('input').trigger('blur');

    expect(wrapper.get('input').attributes('type')).toBe('password');
    expect(wrapper.emitted('blur')).toHaveLength(1);
  });

  it('uses text-security masking for multiline secrets while preserving edits', async () => {
    const wrapper = mountSensitiveField({
      props: {
        modelValue: 'SUB=secret',
        multiline: true,
      },
    });

    expect(wrapper.get('textarea').classes()).toContain('is-concealed');

    await wrapper.get('button').trigger('click');
    expect(wrapper.get('textarea').classes()).not.toContain('is-concealed');

    await wrapper.get('textarea').setValue('SUB=next');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['SUB=next']);
  });

  it('renders a single custom reveal control', () => {
    const wrapper = mountSensitiveField({
      props: {
        modelValue: 'secret-token',
      },
    });

    expect(wrapper.findAll('.sensitive-toggle')).toHaveLength(1);
  });

  describe('已保存但值为空（密文常驻、明文按需）', () => {
    it('没有已保存值时禁用眼睛按钮，有已保存值时启用', () => {
      const empty = mountSensitiveField({ props: { modelValue: '' } });
      expect(empty.get('button').attributes('disabled')).toBeDefined();

      const stored = mountSensitiveField({
        props: {
          modelValue: '',
          hasStoredValue: true,
          revealStored: () => Promise.resolve('stored-secret'),
        },
      });
      expect(stored.get('button').attributes('disabled')).toBeUndefined();
    });

    it('点眼睛才调用解密回调，并在 15 秒后自动收回', async () => {
      vi.useFakeTimers();
      const revealStored = vi.fn().mockResolvedValue('stored-secret');
      const wrapper = mountSensitiveField({
        props: { modelValue: '', hasStoredValue: true, revealStored },
      });

      // 渲染阶段不得解密——明文常驻内存正是这套设计要避免的
      expect(revealStored).not.toHaveBeenCalled();

      await wrapper.get('button').trigger('click');
      await nextTick();
      expect(revealStored).toHaveBeenCalledTimes(1);
      expect(wrapper.get('input').element.value).toBe('stored-secret');

      vi.advanceTimersByTime(15_000);
      await nextTick();
      expect(wrapper.get('input').element.value).toBe('');
    });

    it('揭示出的明文不进 modelValue —— 查看不等于输入', async () => {
      const wrapper = mountSensitiveField({
        props: {
          modelValue: '',
          hasStoredValue: true,
          revealStored: () => Promise.resolve('stored-secret'),
        },
      });

      await wrapper.get('button').trigger('click');
      await nextTick();

      // 一旦泄进 modelValue，父组件失焦时会把它当成"用户新填的密码"重新加密写回
      expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('展示已保存明文时输入框只读，再点一次眼睛回到可编辑空态', async () => {
      const wrapper = mountSensitiveField({
        props: {
          modelValue: '',
          hasStoredValue: true,
          revealStored: () => Promise.resolve('stored-secret'),
        },
      });

      await wrapper.get('button').trigger('click');
      await nextTick();
      expect(wrapper.get('input').attributes('readonly')).toBeDefined();

      await wrapper.get('button').trigger('click');
      await nextTick();
      expect(wrapper.get('input').attributes('readonly')).toBeUndefined();
      expect(wrapper.get('input').element.value).toBe('');
    });

    it('解密失败时不展示内容并抛出 revealError', async () => {
      const failure = new Error('decrypt failed');
      const wrapper = mountSensitiveField({
        props: {
          modelValue: '',
          hasStoredValue: true,
          revealStored: () => Promise.reject(failure),
        },
      });

      await wrapper.get('button').trigger('click');
      await nextTick();

      expect(wrapper.get('input').element.value).toBe('');
      expect(wrapper.emitted('revealError')?.at(-1)).toEqual([failure]);
    });
  });
});
