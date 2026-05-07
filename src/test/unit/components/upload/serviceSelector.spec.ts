import { describe, expect, it, vi } from 'vitest';
import { mountWithDefaults } from '../../../helpers/vueMount';
import ServiceSelector from '../../../../components/views/upload/ServiceSelector.vue';

const baseProps = {
  publicServices: ['jd', 'weibo'],
  privateServices: ['r2'],
  serviceLabels: {
    jd: '京东',
    weibo: '微博',
    r2: 'R2',
  },
  isServiceSelected: vi.fn((id: string) => id === 'jd'),
  serviceHealthMap: {
    jd: 'verified',
    weibo: 'pending',
    r2: 'verified',
  },
  serviceHealthTooltipMap: {
    jd: '连接正常',
    weibo: '等待检测',
    r2: '连接正常',
  },
};

function mountSelector(props = {}) {
  return mountWithDefaults(ServiceSelector, {
    props: {
      ...baseProps,
      ...props,
    },
  });
}

describe('ServiceSelector', () => {
  it('公共图床存在时在公共图床行末显示新增入口并跳转设置', async () => {
    const wrapper = mountSelector();
    const groups = wrapper.findAll('.service-group');
    const publicGroup = groups[0];
    const privateGroup = groups[1];

    expect(publicGroup.text()).toContain('公共图床');
    expect(privateGroup.find('.add-service-tag').exists()).toBe(false);

    const addButton = publicGroup.find('.add-service-tag');
    expect(addButton.exists()).toBe(true);
    expect(addButton.text()).toBe('');
    expect(addButton.attributes('aria-label')).toBe('新增图床');
    expect(addButton.attributes('data-tooltip')).toBe('新增图床');
    expect(addButton.find('.pi-plus').exists()).toBe(true);

    await addButton.trigger('click');
    expect(wrapper.emitted('go-settings')).toHaveLength(1);
  });

  it('只有私有存储可见时在私有存储行末显示新增入口', async () => {
    const wrapper = mountSelector({
      publicServices: [],
      privateServices: ['r2'],
    });
    const group = wrapper.get('.service-group');

    expect(group.text()).toContain('私有存储');
    expect(group.find('.add-service-tag').exists()).toBe(true);
    expect(group.get('.add-service-tag').text()).toBe('');

    await group.get('.add-service-tag').trigger('click');
    expect(wrapper.emitted('go-settings')).toHaveLength(1);
  });

  it('没有可用图床时保留原空状态设置入口', async () => {
    const wrapper = mountSelector({
      publicServices: [],
      privateServices: [],
    });

    expect(wrapper.find('.add-service-tag').exists()).toBe(false);
    expect(wrapper.text()).toContain('暂无可用图床');
    expect(wrapper.text()).toContain('请在设置中配置图床');
    expect(wrapper.text()).not.toContain('请在设置中配置图床。');
    expect(wrapper.text()).not.toContain('可在设置中重新启用京东、七鱼，或配置其他图床。');
    expect(wrapper.text()).toContain('配置图床');

    await wrapper.get('.empty-state-link').trigger('click');
    expect(wrapper.emitted('go-settings')).toHaveLength(1);
  });

  it('非正常健康圆点点击跳转具体图床设置且不切换图床', async () => {
    const wrapper = mountSelector();

    await wrapper.get('.health-dot.pending').trigger('click');

    expect(wrapper.emitted('go-service-settings')).toEqual([['weibo']]);
    expect(wrapper.emitted('toggle')).toBeUndefined();
  });

  it('异常健康圆点追加前往设置提示且不泄露原始错误', async () => {
    const wrapper = mountSelector({
      serviceHealthMap: {
        jd: 'verified',
        weibo: 'error',
        r2: 'verified',
      },
      serviceHealthTooltipMap: {
        jd: '连接正常',
        weibo: 'Cookie 无效或已过期',
        r2: '连接正常',
      },
    });

    const dot = wrapper.get('.health-dot.error');
    expect(dot.attributes('data-tooltip')).toBe('Cookie 无效或已过期，点击前往设置');

    await dot.trigger('click');

    expect(wrapper.emitted('go-service-settings')).toEqual([['weibo']]);
    expect(wrapper.emitted('toggle')).toBeUndefined();
  });

  it('正常健康圆点不跳转，点击仍按原逻辑切换图床', async () => {
    const wrapper = mountSelector();

    await wrapper.get('.health-dot.verified').trigger('click');

    expect(wrapper.emitted('go-service-settings')).toBeUndefined();
    expect(wrapper.emitted('toggle')).toEqual([['jd']]);
  });
});
