// Vue 组件测试挂载工具
// 预配置 global stubs，避免每个组件测试重复配置

import { mount, VueWrapper } from '@vue/test-utils';
import type { MountingOptions } from '@vue/test-utils';
import type { Component, DefineComponent } from 'vue';

/**
 * 默认的全局配置：Teleport 就地渲染，Transition 照常
 */
function getDefaultGlobalConfig(): MountingOptions<any>['global'] {
  return {
    stubs: {
      Teleport: true,
      Transition: false,
    },
  };
}

/**
 * 带默认配置的 mount 包装
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
      stubs: {
        ...defaultGlobal?.stubs,
        ...options.global?.stubs,
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any) as VueWrapper;
}
