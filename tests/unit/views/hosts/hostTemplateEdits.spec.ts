// 链接模板（微博链接前缀、GitHub 加速 CDN）的删除与「恢复默认」：不弹确认，通知带撤销（交接说明第 4 节）；
// 删掉别的模板时选中的还是原来那个（GitHub 曾经一律退回第一个 CDN，悄悄改了以后复制的链接）
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import { describeHost } from '@/views/hosts/hostCatalog';

const m = vi.hoisted(() => ({
  undoResults: [] as Array<(kept: boolean) => void>,
  undoTitles: [] as string[],
}));

const config = ref<UserConfig>(structuredClone(DEFAULT_CONFIG));
/** 存配置时会把响应式代理也展开进去（structuredClone 克隆不了代理），按 JSON 拷一份 */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

vi.mock('@/views/hosts/useHosts', () => ({
  useHosts: () => ({
    config,
    saveSetting: async (patch: (c: UserConfig) => UserConfig) => { config.value = patch(plain(config.value)); },
  }),
}));
vi.mock('@/composables/useUndoToast', () => ({
  useUndoToast: () => ({
    show: (title: string) => {
      m.undoTitles.push(title);
      return new Promise<boolean>((resolve) => m.undoResults.push(resolve));
    },
  }),
}));
vi.mock('@/security/crypto', () => ({ secureStorage: { decrypt: vi.fn(async () => '') } }));

import HostSettings from '@/views/hosts/HostSettings.vue';

const IDLE = { phase: 'idle' } as const;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function mountHost(hostId: 'weibo' | 'github') {
  return mount(HostSettings, { props: { hostId, descriptor: describeHost(hostId)!, values: {}, draft: false, test: IDLE, narrow: false } });
}

/** 列表里第 n 行的「删除」 */
async function removeRow(wrapper: ReturnType<typeof mountHost>, name: string): Promise<void> {
  const row = wrapper.findAll('.host-templates__row').find((r) => r.find('.host-templates__name').text() === name)!;
  await row.get('.host-templates__remove').trigger('click');
  await flush();
}

const prefixes = () => config.value.linkPrefixConfig!;
const cdn = () => (config.value.services!.github as unknown as { cdnConfig: { cdnList: Array<{ name: string }>; selectedIndex: number; enabled: boolean } }).cdnConfig;

describe('link template edits', () => {
  beforeEach(() => {
    m.undoResults.length = 0;
    m.undoTitles.length = 0;
    config.value = structuredClone(DEFAULT_CONFIG);
    const defaults = config.value.linkPrefixConfig!.prefixList;
    config.value.linkPrefixConfig = {
      enabled: true,
      selectedIndex: defaults.length + 1,
      prefixList: [...defaults, { name: '我的反代 A', template: 'https://a.example/{path}' }, { name: '我的反代 B', template: 'https://b.example/{path}' }],
    };
  });

  it('deleting another prefix keeps the chosen one, and undo puts it back in place', async () => {
    const wrapper = mountHost('weibo');
    const before = prefixes().prefixList.map((p) => p.name);
    await removeRow(wrapper, '我的反代 A');

    expect(m.undoTitles).toEqual(['已删除模板「我的反代 A」']);
    expect(prefixes().prefixList.map((p) => p.name)).not.toContain('我的反代 A');
    expect(prefixes().prefixList[prefixes().selectedIndex].name).toBe('我的反代 B');

    m.undoResults[0](false);
    await flush();
    expect(prefixes().prefixList.map((p) => p.name)).toEqual(before);
    expect(prefixes().prefixList[prefixes().selectedIndex].name).toBe('我的反代 B');
  });

  it('deleting the chosen prefix falls back to the one before it, and undo chooses it again', async () => {
    const wrapper = mountHost('weibo');
    await removeRow(wrapper, '我的反代 B');
    expect(prefixes().prefixList[prefixes().selectedIndex].name).toBe('我的反代 A');

    m.undoResults[0](false);
    await flush();
    expect(prefixes().prefixList[prefixes().selectedIndex].name).toBe('我的反代 B');
  });

  it('a deletion that is not undone stays deleted', async () => {
    const wrapper = mountHost('weibo');
    await removeRow(wrapper, '我的反代 A');
    m.undoResults[0](true);
    await flush();
    expect(prefixes().prefixList.map((p) => p.name)).not.toContain('我的反代 A');
  });

  it('restoring the default prefixes can be undone', async () => {
    const wrapper = mountHost('weibo');
    const before = plain(prefixes());
    await wrapper.findAll('.host-templates__text-button').find((b) => b.text() === '恢复默认')!.trigger('click');
    await flush();
    expect(m.undoTitles).toEqual(['已恢复默认链接前缀']);
    expect(prefixes().prefixList.map((p) => p.name)).not.toContain('我的反代 A');

    m.undoResults[0](false);
    await flush();
    expect(prefixes()).toEqual(before);
  });

  it('deleting another CDN keeps the chosen CDN instead of jumping back to the first', async () => {
    const github = { cdnConfig: { enabled: true, selectedIndex: 0, cdnList: [] as Array<{ name: string; url: string; template: string }> } };
    const defaults = structuredClone((DEFAULT_CONFIG.services as unknown as { github?: typeof github }).github?.cdnConfig?.cdnList ?? []);
    github.cdnConfig.cdnList = [...defaults, { name: '我的 CDN A', url: 'https://a.example', template: '{domain}/gh/{owner}/{repo}@{branch}/{path}' }, { name: '我的 CDN B', url: 'https://b.example', template: '{domain}/gh/{owner}/{repo}@{branch}/{path}' }];
    github.cdnConfig.selectedIndex = github.cdnConfig.cdnList.length - 1;
    config.value.services = { ...config.value.services, github } as unknown as UserConfig['services'];

    const wrapper = mountHost('github');
    await removeRow(wrapper, '我的 CDN A');
    expect(m.undoTitles).toEqual(['已删除 CDN「我的 CDN A」']);
    expect(cdn().cdnList[cdn().selectedIndex].name).toBe('我的 CDN B');

    m.undoResults[0](false);
    await flush();
    expect(cdn().cdnList.map((c) => c.name)).toContain('我的 CDN A');
    expect(cdn().cdnList[cdn().selectedIndex].name).toBe('我的 CDN B');
  });
});
