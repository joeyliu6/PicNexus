// 表单：正在改的那一格不被别处的配置变化冲掉（首页切换启用也会存配置，图床页随之重读）
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import HostFields from '@/views/hosts/HostFields.vue';
import type { HostField } from '@/views/hosts/hostCatalog';

const FIELDS: HostField[] = [{ key: 'bucket', label: '存储桶' }, { key: 'region', label: '地域' }];

describe('HostFields', () => {
  it('配置重读时，没改过的格跟着变，改了一半的格留着', async () => {
    const wrapper = mount(HostFields, {
      props: { fields: FIELDS, values: { bucket: 'a', region: 'r1' }, reveal: async () => '', idPrefix: 't' },
    });
    const bucket = wrapper.get('#t-bucket');
    await bucket.setValue('typing');
    await wrapper.setProps({ values: { bucket: 'a', region: 'r2' } });
    expect((bucket.element as HTMLInputElement).value).toBe('typing');
    expect((wrapper.get('#t-region').element as HTMLInputElement).value).toBe('r2');
  });

  it('失焦提交有改动的值', async () => {
    const wrapper = mount(HostFields, {
      props: { fields: FIELDS, values: { bucket: 'a', region: 'r1' }, reveal: async () => '', idPrefix: 't' },
    });
    await wrapper.get('#t-bucket').setValue(' b ');
    await wrapper.get('#t-bucket').trigger('blur');
    expect(wrapper.emitted('commit')).toEqual([['bucket', 'b']]);
  });

  it('Cookie 的密文前面露出第一项的名字（「SUB=••••」，名字不是秘密），其余敏感字段只有圆点', () => {
    const cookie = mount(HostFields, {
      props: { fields: [{ key: 'cookie', label: 'Cookie', secret: true }], values: { cookie: 'SUB=_2A25secret; SUBP=x' }, reveal: async () => '', idPrefix: 'c' },
    });
    expect(cookie.text()).toMatch(/SUB=•+/);
    expect(cookie.text()).not.toContain('_2A25secret');

    const key = mount(HostFields, {
      props: { fields: [{ key: 'secretAccessKey', label: 'Secret Access Key', secret: true }], values: { secretAccessKey: 'AB=cd' }, reveal: async () => '', idPrefix: 'k' },
    });
    expect(key.text()).not.toContain('AB=');
  });
});
