// 详情：一页最多一个主按钮；Cookie 连接表单里手动粘贴了 Cookie 后，按钮写它真正会做的事；检测中上一次的结果不消失（页面不跳）
import { describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { DEFAULT_CONFIG } from '@/config/types';
import type { HostTestState } from '@/views/hosts/hostTestText';

const m = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; name: string; enabled: boolean; problem: string | null; sub: string; testing: boolean }>,
  draft: null as null | { hostId: string; descriptorId: string; name: string; values: Record<string, string> },
}));

const testState = ref<HostTestState>({ phase: 'idle' });

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/views/hosts/useHostUsage', () => ({ useHostUsage: () => ({ usage: ref(null) }) }));
vi.mock('@/views/hosts/HostSettings.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/views/hosts/HostUsage.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/views/hosts/useHosts', () => ({
  useHosts: () => ({
    config: ref(structuredClone(DEFAULT_CONFIG)),
    rows: computed(() => m.rows),
    draft: ref(m.draft),
    hostName: (id: string) => id,
    tester: { stateOf: () => testState.value },
    login: vi.fn(), connect: vi.fn(), test: vi.fn(), toggleEnabled: vi.fn(), disconnect: vi.fn(),
  }),
}));

import HostDetail from '@/views/hosts/HostDetail.vue';

const primaries = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.pn-button--primary, .host-head__use:not(.host-head__use--on)');

describe('HostDetail', () => {
  it('停用的微博登录失效：「启用」是唯一的主按钮，「重新登录…」用次要按钮', () => {
    m.rows = [{ id: 'weibo', name: '微博', enabled: false, problem: '登录失效', sub: '登录失效', testing: false }];
    const wrapper = mount(HostDetail, { props: { hostId: 'weibo', draft: false, narrow: false } });
    expect(wrapper.text()).toContain('重新登录…');
    expect(primaries(wrapper)).toHaveLength(1);
  });

  it('启用中的微博登录失效：「重新登录…」是主按钮（开登录小窗，交接说明 9.8 加「…」）', () => {
    m.rows = [{ id: 'weibo', name: '微博', enabled: true, problem: '登录失效', sub: '登录失效', testing: false }];
    const wrapper = mount(HostDetail, { props: { hostId: 'weibo', draft: false, narrow: false } });
    expect(wrapper.get('.pn-button--primary').text()).toBe('重新登录…');
  });

  it('Cookie 连接表单：没填写「登录…」，手动粘贴后「测试并连接」', async () => {
    m.rows = [];
    m.draft = { hostId: 'zhihu', descriptorId: 'zhihu', name: '知乎', values: {} };
    const empty = mount(HostDetail, { props: { hostId: 'zhihu', draft: true, narrow: false } });
    expect(empty.get('.host-detail__connect .pn-button--primary').text()).toBe('登录…');

    m.draft = { hostId: 'zhihu', descriptorId: 'zhihu', name: '知乎', values: { cookie: 'z_c0=1' } };
    const pasted = mount(HostDetail, { props: { hostId: 'zhihu', draft: true, narrow: false } });
    expect(pasted.get('.host-detail__connect .pn-button--primary').text()).toBe('测试并连接');
  });

  it('检测中：上一次的失败结果留在原处（变淡），出新结果才换掉', async () => {
    m.rows = [{ id: 'r2', name: 'R2', enabled: true, problem: '凭证无效', sub: '凭证无效', testing: false }];
    m.draft = null;
    testState.value = { phase: 'fail', step: 'credentials', field: 'accessKeyId', reason: '密钥不对', passed: [] };
    const wrapper = mount(HostDetail, { props: { hostId: 'r2', draft: false, narrow: false } });
    expect(wrapper.find('.host-detail__result--fail').exists()).toBe(true);

    testState.value = { phase: 'testing' };
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.host-detail__result--fail').classes()).toContain('host-detail__result--stale');
    expect(wrapper.find('.host-head__pill').exists()).toBe(true);

    testState.value = { phase: 'ok', ms: 120, steps: ['credentials'] };
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.host-detail__result--fail').exists()).toBe(false);
    expect(wrapper.get('.host-detail__result--ok').classes()).not.toContain('host-detail__result--stale');
    testState.value = { phase: 'idle' };
  });
});
