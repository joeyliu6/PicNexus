// 图标按钮外面包着气泡（TooltipRoot 不渲染元素）：写在组件上的 @click、class 必须落到按钮上，否则点了没反应
import { mount } from '@vue/test-utils';
import { TooltipProvider } from 'reka-ui';
import { defineComponent, h } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import PnIconButton from '@/components/pn/PnIconButton.vue';

function mountButton(props: Record<string, unknown>) {
  const onClick = vi.fn();
  const wrapper = mount(defineComponent({
    render: () => h(TooltipProvider, null, () => h(PnIconButton, { icon: 'close', label: '关闭', class: 'extra', onClick, ...props })),
  }));
  return { wrapper, onClick };
}

describe('PnIconButton', () => {
  it.each([
    ['带气泡', {}],
    ['不带气泡', { noTooltip: true }],
  ])('%s：点击触发 click，class 落在按钮上', async (_name, props) => {
    const { wrapper, onClick } = mountButton(props);
    const button = wrapper.get('button');
    expect(button.classes()).toContain('extra');
    await button.trigger('click');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('禁用时点击不触发', async () => {
    const { wrapper, onClick } = mountButton({ disabled: true });
    await wrapper.get('button').trigger('click');
    expect(onClick).not.toHaveBeenCalled();
  });
});
