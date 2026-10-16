import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, inject, type Ref } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { mountWithDefaults } from '../helpers/vueMount';
import { flushPromisesAndTicks } from '../helpers/wait';
import { getListenMock, resetTauriMocks } from '../helpers/tauriMock';

const mockState = vi.hoisted(() => ({
  setupTrayMenu: vi.fn(),
  unlistenTrayMenu: vi.fn(),
  hasUpdate: { value: false },
}));

vi.mock('@/services/trayMenu', () => ({
  setupTrayMenu: mockState.setupTrayMenu,
}));

vi.mock('@/composables/useAutoUpdate', async () => {
  const { computed: vueComputed, ref: vueRef } = await import('vue');
  const flag = vueRef(false);
  mockState.hasUpdate = flag;
  return { useAutoUpdate: () => ({ hasAvailableUpdate: vueComputed(() => flag.value) }) };
});

import AppShell from '@/shell/AppShell.vue';
import { __resetSidebarCollapseForTests } from '@/shell/useSidebarCollapse';

type Handler = (event: { payload: unknown }) => void;
// 同一个事件可以有好几个监听（外壳的跳转和上传控制器都听 tray-action），和 Tauri 一样全部通知到
const handlers: Record<string, Handler[]> = {};
const fire = (event: string, payload: unknown) => (handlers[event] ?? []).forEach((handler) => handler({ payload }));
const unlistenNavigate = vi.fn();
const unlistenTrayAction = vi.fn();

const SettingsStub = defineComponent({
  setup() {
    const section = inject<Ref<string | null>>('settingsTargetSection')!;
    const tab = inject<Ref<string | null>>('settingsTargetTab')!;
    return { section, tab };
  },
  template: '<section data-testid="settings" :data-section="section" :data-tab="tab" />',
});
const LinkCheckStub = defineComponent({
  setup() {
    const tab = inject<Ref<string | null>>('linkCheckTargetTab')!;
    return { tab };
  },
  template: '<section data-testid="health" :data-tab="tab" />',
});
const page = (id: string) => defineComponent({ template: `<section data-testid="${id}" />` });

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/home' },
      { path: '/home', component: page('home'), meta: { pageKey: 'home', legacyTitle: '' } },
      { path: '/gallery', component: page('gallery'), meta: { pageKey: 'gallery', legacyTitle: '图库' } },
      { path: '/health', component: LinkCheckStub, meta: { pageKey: 'health', legacyTitle: '链接健康' } },
      { path: '/hosts', component: SettingsStub, meta: { pageKey: 'hosts', legacyTitle: '图床' } },
      { path: '/settings', component: SettingsStub, meta: { pageKey: 'settings', legacyTitle: '设置' } },
    ],
  });
}

const mounted: Array<{ unmount: () => void }> = [];

async function mountShell() {
  const router = makeRouter();
  await router.push('/');
  const wrapper = mountWithDefaults(AppShell, { global: { plugins: [router] }, attachTo: document.body });
  mounted.push(wrapper);
  await flushPromisesAndTicks(2);
  return { wrapper, router };
}

beforeEach(() => {
  resetTauriMocks();
  vi.clearAllMocks();
  localStorage.clear();
  __resetSidebarCollapseForTests();
  mockState.hasUpdate.value = false;
  mockState.setupTrayMenu.mockResolvedValue(mockState.unlistenTrayMenu);
  for (const key of Object.keys(handlers)) delete handlers[key];
  getListenMock().mockImplementation(async (event, handler) => {
    (handlers[event as string] ??= []).push(handler as Handler);
    if (event === 'navigate-to') return unlistenNavigate;
    if (event === 'tray-action') return unlistenTrayAction;
    return vi.fn();
  });
});

// 失败的用例来不及 unmount 时，残留的键盘监听会让后面的用例连锁失败
afterEach(() => {
  mounted.splice(0).forEach((w) => { try { w.unmount(); } catch { /* 已卸载 */ } });
});

describe('AppShell', () => {
  it('starts on 快传 and navigates with the sidebar', async () => {
    const { wrapper, router } = await mountShell();
    expect(wrapper.find('[data-testid="home"]').exists()).toBe(true);
    expect(wrapper.get('[aria-current="page"]').text()).toContain('快传');

    const gallery = wrapper.findAll('.app-sidebar__item').find((a) => a.text().includes('图库'))!;
    await gallery.trigger('click');
    await flushPromisesAndTicks();
    expect(router.currentRoute.value.path).toBe('/gallery');
    expect(wrapper.get('[aria-current="page"]').text()).toContain('图库');
    expect(wrapper.get('.title-row__title').text()).toBe('图库');
  });

  it('routes navigate-to events and hands the settings section to the hosts page', async () => {
    const { wrapper, router } = await mountShell();

    fire('navigate-to', { view: 'settings', tab: 'hosting', section: 'weibo' });
    await flushPromisesAndTicks();
    expect(router.currentRoute.value.path).toBe('/hosts');
    expect(wrapper.get('[data-testid="settings"]').attributes('data-section')).toBe('weibo');

    fire('navigate-to', 'history');
    await flushPromisesAndTicks();
    expect(router.currentRoute.value.path).toBe('/gallery');
  });

  it('passes the link-check tab and cleans up every listener on unmount', async () => {
    const { wrapper } = await mountShell();

    fire('navigate-to', { view: 'link-check', tab: 'migrate' });
    await flushPromisesAndTicks();
    expect(wrapper.get('[data-testid="health"]').attributes('data-tab')).toBe('migrate');

    wrapper.unmount();
    expect(unlistenNavigate).toHaveBeenCalled();
    expect(unlistenTrayAction).toHaveBeenCalled();
    expect(mockState.unlistenTrayMenu).toHaveBeenCalled();
  });

  it('goes to 快传 on tray upload actions', async () => {
    const { wrapper, router } = await mountShell();
    await router.push('/gallery');

    fire('tray-action', 'select_upload_files');
    await flushPromisesAndTicks();
    expect(router.currentRoute.value.path).toBe('/home');
  });

  it('shows the brand dot on 设置 only when an update is available', async () => {
    const { wrapper } = await mountShell();
    expect(wrapper.find('.app-sidebar__dot--brand').exists()).toBe(false);

    mockState.hasUpdate.value = true;
    await flushPromisesAndTicks();
    const settings = wrapper.findAll('.app-sidebar__item').find((a) => a.text().includes('设置'))!;
    expect(settings.find('.app-sidebar__dot--brand').exists()).toBe(true);
  });

  it('collapses to the icon rail with Ctrl+\\', async () => {
    const { wrapper } = await mountShell();
    expect(wrapper.find('.app-sidebar').exists()).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true }));
    await flushPromisesAndTicks();
    expect(wrapper.find('.app-sidebar').exists()).toBe(false);
    expect(wrapper.find('.nav-rail').exists()).toBe(true);
  });
});

