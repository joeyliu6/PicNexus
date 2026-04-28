import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useClickOutside, useMultiClickOutside } from '../../../composables/useClickOutside';

describe('useClickOutside', () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.clearAllMocks();
  });

  it('fires only for outside clicks while active', async () => {
    const onOutside = vi.fn();
    const Component = defineComponent({
      setup() {
        return {
          onOutside,
          ...useClickOutside(onOutside, { immediate: false }),
        };
      },
      template: `
        <div>
          <section ref="target" class="panel">
            <button class="inside">Inside</button>
          </section>
          <button class="outside">Outside</button>
        </div>
      `,
    });

    wrapper = mount(Component, { attachTo: document.body });

    await wrapper.find('.outside').trigger('click');
    expect(onOutside).not.toHaveBeenCalled();

    wrapper.vm.start();
    await wrapper.find('.inside').trigger('click');
    expect(onOutside).not.toHaveBeenCalled();

    await wrapper.find('.outside').trigger('click');
    expect(onOutside).toHaveBeenCalledTimes(1);

    wrapper.vm.stop();
    await wrapper.find('.outside').trigger('click');
    expect(onOutside).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    await wrapper.find('.outside').trigger('click');
    expect(onOutside).toHaveBeenCalledTimes(1);
  });
});

describe('useMultiClickOutside', () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.clearAllMocks();
  });

  it('treats clicks inside any registered target as internal', async () => {
    const onOutside = vi.fn();
    const Component = defineComponent({
      setup() {
        const first = ref<HTMLElement | null>(null);
        const second = ref<HTMLElement | null>(null);
        return {
          first,
          second,
          onOutside,
          ...useMultiClickOutside([first, second], onOutside),
        };
      },
      template: `
        <div>
          <section ref="first" class="first"><button class="inside-first">First</button></section>
          <section ref="second" class="second"><button class="inside-second">Second</button></section>
          <button class="outside">Outside</button>
        </div>
      `,
    });

    wrapper = mount(Component, { attachTo: document.body });

    await wrapper.find('.inside-first').trigger('click');
    await wrapper.find('.inside-second').trigger('click');
    expect(onOutside).not.toHaveBeenCalled();

    await wrapper.find('.outside').trigger('click');
    expect(onOutside).toHaveBeenCalledTimes(1);

    wrapper.vm.stop();
    await wrapper.find('.outside').trigger('click');
    expect(onOutside).toHaveBeenCalledTimes(1);

    wrapper.vm.start();
    await wrapper.find('.outside').trigger('click');
    expect(onOutside).toHaveBeenCalledTimes(2);
  });
});
