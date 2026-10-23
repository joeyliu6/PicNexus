// 复制按钮（Patterns.dc.html）：平时「复制」，复制后原地「✓ 已复制」；
// ghost 是「最近上传」里一组多张的「复制全部」用的文字按钮样式（HomeScreen.dc.html），平时不带图标。
import { describe, expect, it } from 'vitest';
import CopyButton from '@/components/biz/CopyButton.vue';
import { mountWithDefaults } from '../../helpers/vueMount';

describe('CopyButton', () => {
  it('默认：带图标，复制后变「已复制」', async () => {
    const wrapper = mountWithDefaults(CopyButton, { props: { copied: false } });
    expect(wrapper.text()).toBe('复制');
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.classes()).not.toContain('copy-button--ghost');
    await wrapper.setProps({ copied: true });
    expect(wrapper.text()).toBe('已复制');
    expect(wrapper.classes()).toContain('copy-button--done');
  });

  it('ghost：文字按钮样式，平时不带图标，复制后才出现对勾', async () => {
    const wrapper = mountWithDefaults(CopyButton, { props: { ghost: true, label: '复制全部' } });
    expect(wrapper.classes()).toContain('copy-button--ghost');
    expect(wrapper.text()).toBe('复制全部');
    expect(wrapper.find('svg').exists()).toBe(false);
    await wrapper.setProps({ copied: true });
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.text()).toBe('已复制');
  });
});
