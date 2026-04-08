// Vue 组件测试挂载工具
// 预配置 global stubs/plugins/directives，避免每个组件测试重复配置

import { mount, shallowMount, MountingOptions, VueWrapper } from '@vue/test-utils';
import { Component, DefineComponent } from 'vue';
import { vi } from 'vitest';

/**
 * v-tooltip 指令的测试替身
 * 将 tooltip 内容写入 data-tooltip 属性，方便断言
 */
export const tooltipDirective = {
  mounted(el: HTMLElement, binding: { value?: string | null }) {
    if (binding.value) {
      el.setAttribute('data-tooltip', binding.value);
    }
  },
  updated(el: HTMLElement, binding: { value?: string | null }) {
    if (binding.value) {
      el.setAttribute('data-tooltip', binding.value);
    } else {
      el.removeAttribute('data-tooltip');
    }
  },
};

/**
 * 默认的全局配置
 * 包含常用的 stubs 和 directives
 */
function getDefaultGlobalConfig(): MountingOptions<any>['global'] {
  return {
    directives: {
      tooltip: tooltipDirective,
    },
    stubs: {
      Teleport: true,
      Transition: false,
    },
  };
}

/**
 * 带默认配置的 mount 包装
 * 自动注入 tooltip 指令和常用 stubs
 *
 * @example
 * ```ts
 * const wrapper = mountWithDefaults(MyComponent, {
 *   props: { title: '测试' },
 * });
 * ```
 */
export function mountWithDefaults<T extends Component>(
  component: T,
  options: MountingOptions<any> = {},
): VueWrapper {
  const defaultGlobal = getDefaultGlobalConfig();

  return mount(component as DefineComponent, {
    ...options,
    global: {
      ...defaultGlobal,
      ...options.global,
      directives: {
        ...defaultGlobal?.directives,
        ...options.global?.directives,
      },
      stubs: {
        ...(defaultGlobal?.stubs as Record<string, unknown>),
        ...(options.global?.stubs as Record<string, unknown>),
      },
    },
  }) as VueWrapper;
}

/**
 * 带默认配置的 shallowMount 包装
 * 适合测试组件自身逻辑，不渲染子组件
 */
export function shallowMountWithDefaults<T extends Component>(
  component: T,
  options: MountingOptions<any> = {},
): VueWrapper {
  const defaultGlobal = getDefaultGlobalConfig();

  return shallowMount(component as DefineComponent, {
    ...options,
    global: {
      ...defaultGlobal,
      ...options.global,
      directives: {
        ...defaultGlobal?.directives,
        ...options.global?.directives,
      },
      stubs: {
        ...(defaultGlobal?.stubs as Record<string, unknown>),
        ...(options.global?.stubs as Record<string, unknown>),
      },
    },
  }) as VueWrapper;
}

/**
 * 查找带 data-testid 属性的元素
 * 推荐组件中使用 data-testid 替代 CSS class 选择器
 *
 * @example
 * ```ts
 * const btn = findByTestId(wrapper, 'retry-btn');
 * await btn.trigger('click');
 * ```
 */
export function findByTestId(wrapper: VueWrapper, testId: string) {
  return wrapper.find(`[data-testid="${testId}"]`);
}
