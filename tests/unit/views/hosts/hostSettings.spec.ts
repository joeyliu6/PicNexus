// 设置区：测试指到收在「高级选项」里的那一格时展开；用户改那一格时不能边改边收起；Cookie 字段旁是「重新登录…」
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { DEFAULT_CONFIG } from '@/config/types';
import { describeHost } from '@/views/hosts/hostCatalog';
import type { HostTestState } from '@/views/hosts/hostTestText';

vi.mock('@/views/hosts/useHosts', () => ({ useHosts: () => ({ config: ref(structuredClone(DEFAULT_CONFIG)) }) }));
vi.mock('@/security/crypto', () => ({ secureStorage: { decrypt: vi.fn(async () => '') } }));

import HostSettings from '@/views/hosts/HostSettings.vue';

const FAIL: Extract<HostTestState, { phase: 'fail' }> = { phase: 'fail', step: 'write', field: 'path', reason: '路径无法写入', passed: ['credentials'] };

describe('HostSettings', () => {
  it('失败指到高级选项里的格：展开；改过那一格后仍展开，红框清掉', async () => {
    const wrapper = mount(HostSettings, {
      props: { hostId: 'r2', descriptor: describeHost('r2')!, values: { path: 'img/' }, draft: false, test: FAIL, narrow: false },
    });
    const toggle = () => wrapper.get('.host-settings__advanced');
    expect(toggle().attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('.host-fields__help--error').text()).toBe('路径无法写入');

    await wrapper.setProps({ test: { ...FAIL, edited: true } });
    expect(toggle().attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('.host-fields__help--error').exists()).toBe(false);
  });

  it('WebDAV 的「HTTP · 已允许」只标后端真会放行的地址：写成 IP 的局域网地址、确认过的；没确认的主机名不标', () => {
    const IDLE = { phase: 'idle' } as const;
    const mountWebdav = (values: Record<string, string>) => mount(HostSettings, {
      props: { hostId: 'webdav:new', descriptor: describeHost('webdav:new')!, values, draft: true, test: IDLE, narrow: false },
    });
    const badges = (wrapper: ReturnType<typeof mountWebdav>) => wrapper.findAll('.host-fields__http').length;
    const lan = { url: 'http://192.168.1.20:5005/dav', publicDomain: 'http://nas.lumen.home:5005/p' };
    expect(badges(mountWebdav(lan))).toBe(1);
    expect(badges(mountWebdav({ ...lan, lanHttpConfirmed: 'true' }))).toBe(2);
    expect(badges(mountWebdav({ url: 'https://dav.example.com', publicDomain: 'http://img.example.com' }))).toBe(0);
  });

  it('已连接的 Cookie 图床：「重新登录…」与输入框同一行，点它发 login；没有「手动粘贴」', async () => {
    const IDLE = { phase: 'idle' } as const;
    const wrapper = mount(HostSettings, {
      props: { hostId: 'weibo', descriptor: describeHost('weibo')!, values: { cookie: 'SUB=1' }, draft: false, test: IDLE, narrow: false, loginAction: true },
    });
    const button = wrapper.get('.host-secret__row .pn-button');
    expect(button.text()).toBe('重新登录…');
    await button.trigger('click');
    expect(wrapper.emitted('login')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('手动粘贴');

    await wrapper.setProps({ loginAction: false });
    expect(wrapper.find('.host-secret__row .pn-button').exists()).toBe(false);
  });
});
