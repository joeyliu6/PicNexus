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

    // multiline 曾经走不到展示态：模板里 `v-if="multiline"` 抢在 `showingStored` 前面命中，
    // Cookie 那种多行密文点了眼睛只会看到一个空 textarea。
    it('multiline 下点眼睛能看到已保存明文，且明文不进 modelValue', async () => {
      const wrapper = mountSensitiveField({
        props: {
          modelValue: '',
          multiline: true,
          hasStoredValue: true,
          revealStored: () => Promise.resolve('SUB=stored-cookie'),
        },
      });

      expect(wrapper.get('textarea').element.value).toBe('');

      await wrapper.get('button').trigger('click');
      await nextTick();

      expect(wrapper.get('textarea').element.value).toBe('SUB=stored-cookie');
      expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    // 用户反馈：空框看起来像"里面没东西"。已保存态改成显示固定个数的圆点。
    describe('已保存态的圆点', () => {
      const dots = (wrapper: ReturnType<typeof mountSensitiveField>, tag = 'input') =>
        wrapper.get(tag).attributes('placeholder') ?? '';

      it('存过了就在框里显示圆点，没存过显示原始占位文案', () => {
        const stored = mountSensitiveField({
          props: {
            modelValue: '',
            placeholder: '从 SM.MS 官网获取',
            hasStoredValue: true,
            revealStored: () => Promise.resolve('secret'),
          },
        });
        expect(dots(stored)).toBe('•'.repeat(32));
        expect(stored.get('.sensitive-field').classes()).toContain('has-fake-dots');

        const empty = mountSensitiveField({
          props: { modelValue: '', placeholder: '从 SM.MS 官网获取' },
        });
        expect(dots(empty)).toBe('从 SM.MS 官网获取');
        expect(empty.get('.sensitive-field').classes()).not.toContain('has-fake-dots');
      });

      // 迁移前绑真值 + type=password，圆点个数就是密码长度——等于把长度写在界面上
      it('圆点个数固定，不随真实内容长度变化', async () => {
        const short = mountSensitiveField({
          props: { modelValue: '', hasStoredValue: true, revealStored: () => Promise.resolve('abc123') },
        });
        const long = mountSensitiveField({
          props: {
            modelValue: '',
            hasStoredValue: true,
            revealStored: () => Promise.resolve('a'.repeat(64)),
          },
        });

        expect(dots(short)).toBe(dots(long));
      });

      it('圆点是装饰，不是值 —— 不进 modelValue', () => {
        const wrapper = mountSensitiveField({
          props: { modelValue: '', hasStoredValue: true, revealStored: () => Promise.resolve('s') },
        });

        expect(wrapper.get('input').element.value).toBe('');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
      });

      it('聚焦时圆点让位给「留空则不修改」，失焦后回来', async () => {
        const wrapper = mountSensitiveField({
          props: {
            modelValue: '',
            placeholder: '留空则不修改',
            hasStoredValue: true,
            revealStored: () => Promise.resolve('secret'),
          },
        });

        expect(dots(wrapper)).toBe('•'.repeat(32));

        await wrapper.get('input').trigger('focus');
        expect(dots(wrapper)).toBe('留空则不修改');

        await wrapper.get('input').trigger('blur');
        expect(dots(wrapper)).toBe('•'.repeat(32));
      });

      it('用户输入内容后圆点消失', async () => {
        const wrapper = mountSensitiveField({
          props: { modelValue: '', hasStoredValue: true, revealStored: () => Promise.resolve('s') },
        });

        await wrapper.setProps({ modelValue: 'typing' });

        expect(wrapper.get('.sensitive-field').classes()).not.toContain('has-fake-dots');
      });

      it('点眼睛进入展示态时圆点让位给真明文', async () => {
        const wrapper = mountSensitiveField({
          props: {
            modelValue: '',
            hasStoredValue: true,
            revealStored: () => Promise.resolve('real-secret'),
          },
        });

        await wrapper.get('button').trigger('click');
        await nextTick();

        expect(wrapper.get('input').element.value).toBe('real-secret');
        expect(wrapper.get('.sensitive-field').classes()).not.toContain('has-fake-dots');
      });

      // 聚焦 = 我要改它：请父组件把真值取出来，好让用户就地改一个字符
      describe('聚焦取值', () => {
        it('聚焦已存过值的空框会请求取值', async () => {
          const wrapper = mountSensitiveField({
            props: { modelValue: '', hasStoredValue: true, revealStored: () => Promise.resolve('s') },
          });

          await wrapper.get('input').trigger('focus');

          expect(wrapper.emitted('editStart')).toHaveLength(1);
        });

        it('没存过值时聚焦不请求取值', async () => {
          const wrapper = mountSensitiveField({ props: { modelValue: '' } });

          await wrapper.get('input').trigger('focus');

          expect(wrapper.emitted('editStart')).toBeUndefined();
        });

        it('框里已经有内容时聚焦不请求取值 —— 别盖掉用户敲的东西', async () => {
          const wrapper = mountSensitiveField({
            props: { modelValue: 'typing', hasStoredValue: true },
          });

          await wrapper.get('input').trigger('focus');

          expect(wrapper.emitted('editStart')).toBeUndefined();
        });

        it('正在展示已保存明文时聚焦不请求取值', async () => {
          const wrapper = mountSensitiveField({
            props: {
              modelValue: '',
              hasStoredValue: true,
              revealStored: () => Promise.resolve('shown'),
            },
          });

          await wrapper.get('button').trigger('click');
          await nextTick();
          await wrapper.get('input').trigger('focus');

          expect(wrapper.emitted('editStart')).toBeUndefined();
        });

        // 点了眼睛之后是只读展示态，再点进框里本来什么也做不了，只能干等 15 秒
        it('点眼睛看过之后可以直接点进去改', async () => {
          const wrapper = mountSensitiveField({
            props: {
              modelValue: '',
              hasStoredValue: true,
              revealStored: () => Promise.resolve('seen-secret'),
            },
          });

          await wrapper.get('button').trigger('click');
          await nextTick();
          expect(wrapper.get('input').attributes('readonly')).toBeDefined();

          await wrapper.get('input').trigger('mousedown');
          await nextTick();

          // 已经在手上的明文直接交出去，不再解一次
          expect(wrapper.emitted('editStart')?.at(-1)).toEqual(['seen-secret']);
          // 回到可编辑态，而且保持明文可见——不该闪一下变回圆点
          expect(wrapper.get('input').attributes('readonly')).toBeUndefined();
          expect(wrapper.get('input').attributes('type')).toBe('text');
        });

        it('真正只读的字段点进去仍然不可编辑', async () => {
          const wrapper = mountSensitiveField({
            props: {
              modelValue: '',
              readonly: true,
              hasStoredValue: true,
              revealStored: () => Promise.resolve('derived-token'),
            },
          });

          await wrapper.get('button').trigger('click');
          await nextTick();
          await wrapper.get('input').trigger('mousedown');
          await nextTick();

          expect(wrapper.emitted('editStart')).toBeUndefined();
          expect(wrapper.get('input').attributes('readonly')).toBeDefined();
        });

        it('取值期间输入框只读 —— 免得覆盖用户抢先敲的内容', () => {
          const wrapper = mountSensitiveField({
            props: { modelValue: '', hasStoredValue: true, loadingValue: true },
          });

          expect(wrapper.get('input').attributes('readonly')).toBeDefined();
        });
      });

      // 4 行高的框里只有一行圆点，看着像内容被截断了
      it('multiline 的圆点足够铺满整个框', () => {
        const wrapper = mountSensitiveField({
          props: {
            modelValue: '',
            multiline: true,
            hasStoredValue: true,
            revealStored: () => Promise.resolve('SUB=long-cookie'),
          },
        });

        const placeholder = dots(wrapper, 'textarea');
        expect(placeholder).toBe('•'.repeat(512));
        expect(placeholder).not.toContain('SUB=');
      });

      // 曾经拼的是「3 行 × 32 个」，三行一样长，一看就是生成的。
      // 交给浏览器自然折行后宽度跟着框走，框宽变了也不用重算。
      it('multiline 的圆点不写死换行，交给浏览器自然折行', () => {
        const wrapper = mountSensitiveField({
          props: {
            modelValue: '',
            multiline: true,
            hasStoredValue: true,
            revealStored: () => Promise.resolve('SUB=long-cookie'),
          },
        });

        expect(dots(wrapper, 'textarea')).not.toContain('\n');
      });
    });

    it('multiline 展示态只读、不遮挡，15 秒后自动收回', async () => {
      vi.useFakeTimers();
      const wrapper = mountSensitiveField({
        props: {
          modelValue: '',
          multiline: true,
          hasStoredValue: true,
          revealStored: () => Promise.resolve('SUB=stored-cookie'),
        },
      });

      await wrapper.get('button').trigger('click');
      await nextTick();

      const textarea = wrapper.get('textarea');
      expect(textarea.attributes('readonly')).toBeDefined();
      // 展示态是给人看的，不该再套 -webkit-text-security
      expect(textarea.classes()).not.toContain('is-concealed');

      vi.advanceTimersByTime(15_000);
      await nextTick();

      expect(wrapper.get('textarea').element.value).toBe('');
      expect(wrapper.get('textarea').attributes('readonly')).toBeUndefined();
    });
  });
});
