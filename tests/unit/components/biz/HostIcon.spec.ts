import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import HostIcon from '@/components/biz/HostIcon.vue';

function render(host: string, name?: string) {
  return mount(HostIcon, { props: { host, name } });
}

describe('HostIcon', () => {
  it('内置图床用自己的 SVG', () => {
    const wrapper = render('weibo');
    expect(wrapper.find('.host-icon__glyph svg').exists()).toBe(true);
    expect(wrapper.find('.host-icon__mark').exists()).toBe(false);
  });

  it('自定义 S3 的复合 ID 用对象存储图标（桶）', () => {
    const svg = render('custom_s3:abc123').find('.host-icon__glyph').html();
    expect(svg).toContain('<ellipse');
  });

  it('WebDAV 的复合 ID 用服务器图标', () => {
    const svg = render('webdav:xyz789').find('.host-icon__glyph').html();
    expect(svg).toContain('<rect');
  });

  it('配置被删后残留的复合 ID 仍按类型出图标', () => {
    // 历史记录里的 serviceId 不会因为删掉配置而改写，前缀还在
    expect(render('webdav:').find('.host-icon__glyph').html()).toContain('<rect');
    expect(render('custom_s3:').find('.host-icon__glyph').html()).toContain('<ellipse');
  });

  it('认不出的图床退回名字的前两个字', () => {
    const wrapper = render('telegraph', '电报图床');
    expect(wrapper.find('.host-icon__glyph').exists()).toBe(false);
    expect(wrapper.find('.host-icon__mark').text()).toBe('电报');
  });
});
