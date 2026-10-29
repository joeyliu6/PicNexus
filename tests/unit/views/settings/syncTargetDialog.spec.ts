// 云同步连接弹窗：第一份连接按坚果云预填（名称与服务器地址都是真值，不只是占位字）
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { DEFAULT_CONFIG, type UserConfig, type WebDAVProfile } from '@/config/types';

const config = ref<UserConfig>(structuredClone(DEFAULT_CONFIG));

vi.mock('@/views/settings/useSettingsConfig', () => ({ useSettingsConfig: () => ({ config, patch: vi.fn(async () => true) }) }));
vi.mock('@/composables/useConfig', () => ({ useConfigManager: () => ({ testWebDAVConnection: vi.fn() }) }));

const { default: SyncTargetDialog } = await import('@/views/settings/SyncTargetDialog.vue');

function openWith(profiles: WebDAVProfile[]) {
  config.value = { ...structuredClone(DEFAULT_CONFIG), webdav: { profiles, activeId: null } };
  return mount(SyncTargetDialog, { props: { open: false }, attachTo: document.body });
}

const inputs = () => [...document.body.querySelectorAll<HTMLInputElement>('.pn-dialog input')];

afterEach(() => { document.body.innerHTML = ''; });

describe('SyncTargetDialog', () => {
  it('第一份连接：名称写「坚果云」，服务器地址填好坚果云的地址', async () => {
    const wrapper = openWith([]);
    await wrapper.setProps({ open: true });
    await nextTick();
    const [name, , address] = inputs();
    expect(name.value).toBe('坚果云');
    expect(address.value).toBe('https://dav.jianguoyun.com/dav/');
  });
});
