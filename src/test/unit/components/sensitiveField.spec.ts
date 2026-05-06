import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import SensitiveField from '../../../components/common/SensitiveField.vue';

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
});
