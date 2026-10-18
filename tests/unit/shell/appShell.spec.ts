import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, inject, type Ref } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { mountWithDefaults } from '../helpers/vueMount';
import { flushPromisesAndTicks } from '../helpers/wait';
import { getListenMock, resetTauriMocks } from '../helpers/tauriMock';

const mockState = vi.hoisted(() => ({
  installTray: vi.fn(),
  disposeTray: vi.fn(),
  hasUpdate: { value: false },
}));

vi.mock('@/tray/installTray', () => ({
  installTray: mockState.installTray,
}));

vi.mock('@/composables/useAutoUpdate', async () => {
  const { computed: vueComputed, ref: vueRef } = await import('vue');
  const flag = vueRef(false);
  mockState.hasUpdate = flag;
  return { useAutoUpdate: () => ({ hasAvailableUpdate: vueComputed(() => flag.value) }), setUpdateInstallGate: vi.fn() };
});

import AppShell from '@/shell/AppShell.vue';
import { __resetSidebarCollapseForTests } from '@/shell/useSidebarCollapse';

type Handler = (event: { payload: unknown }) => void;
// 同一个事件可以有好几个监听（外壳的跳转、上传控制器、托盘都可能听同一个），和 Tauri 一样全部通知到
const handlers: Record<string, Handler[]> = {};
const fire = (event: string, payload: unknown) => (handlers[event] ?? []).forEach((handler) => handler({ payload }));
const unlistenNavigate = vi.fn();

const SettingsStub = defineComponent({
  setup() {
    const section = inject<Ref<string | null>>('settingsTargetSection')!;
    const tab = inject<Ref<string | null>>('settingsTargetTab')!;
    return { section, tab };
  },
  template: '<section data-testid="settings" :data-section="section" :data-tab="tab" />',
});
const page = (id: string) => defineComponent({ template: `<section data-testid="${id}" />` });

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/home' },
      { path: '/home', component: page('home'), meta: { pageKey: 'home' } },
      { path: '/gallery', component: page('gallery'), meta: { pageKey: 'gallery' } },
      { path: '/health', component: page('health'), meta: { pageKey: 'health' } },
      { path: '/hosts', component: SettingsStub, meta: { pageKey: 'hosts' } },
      { path: '/settings', component: SettingsStub, meta: { pageKey: 'settings' } },
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
  mockState.installTray.mockReturnValue(mockState.disposeTray);
  for (const key of Object.keys(handlers)) delete handlers[key];
  getListenMock().mockImplementation(async (event, handler) => {
    (handlers[event as string] ??= []).push(handler as Handler);
    if (event === 'navigate-to') return unlistenNavigate;
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

  it('opens 链接健康 from the old link-check view name and cleans up every listener on unmount', async () => {
    const { wrapper } = await mountShell();

    fire('navigate-to', { view: 'link-check', tab: 'migrate' });
    await flushPromisesAndTicks();
    expect(wrapper.find('[data-testid="health"]').exists()).toBe(true);

    wrapper.unmount();
    expect(unlistenNavigate).toHaveBeenCalled();
    expect(mockState.disposeTray).toHaveBeenCalled();
  });

  it('installs the tray with the shared upload controller', async () => {
    await mountShell();
    const { useUploadController } = await import('@/composables/upload/useUploadController');
    expect(mockState.installTray).toHaveBeenCalledWith(useUploadController());
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

