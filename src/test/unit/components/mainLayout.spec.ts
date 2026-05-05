import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, inject, type Ref } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../helpers/wait';
import { getListenMock, resetTauriMocks } from '../../helpers/tauriMock';

const mockState = vi.hoisted(() => ({
  setupTrayMenu: vi.fn(),
  unlistenTrayMenu: vi.fn(),
}));

vi.mock('../../../services/trayMenu', () => ({
  setupTrayMenu: mockState.setupTrayMenu,
}));

import MainLayout from '../../../components/layout/MainLayout.vue';

type NavigatePayload = string | { view: string; tab?: string; section?: string };
type NavigateHandler = (event: { payload: NavigatePayload }) => void;
type TrayAction = 'upload_clipboard' | 'select_upload_files';
type TrayActionHandler = (event: { payload: TrayAction }) => void;

let navigateHandler: NavigateHandler | null = null;
let trayActionHandler: TrayActionHandler | null = null;
const unlistenNavigate = vi.fn();
const unlistenTrayAction = vi.fn();

const TitleBarStub = defineComponent({
  name: 'TitleBar',
  template: '<header data-testid="title-bar" />',
});

const SidebarStub = defineComponent({
  name: 'Sidebar',
  props: ['currentView'],
  emits: ['navigate'],
  template: `
    <aside data-testid="sidebar" :data-current-view="currentView">
      <button class="nav-history" @click="$emit('navigate', 'history')">history</button>
      <button class="nav-link-check" @click="$emit('navigate', 'link-check')">link check</button>
      <button class="nav-settings" @click="$emit('navigate', 'settings')">settings</button>
    </aside>
  `,
});

const UploadViewStub = defineComponent({
  name: 'UploadView',
  template: '<section data-testid="upload-view" />',
});

const HistoryViewStub = defineComponent({
  name: 'HistoryView',
  template: '<section data-testid="history-view" />',
});

const SettingsViewStub = defineComponent({
  name: 'SettingsView',
  setup() {
    const targetTab = inject<Ref<string | null>>('settingsTargetTab')!;
    const targetSection = inject<Ref<string | null>>('settingsTargetSection')!;
    return { targetTab, targetSection };
  },
  template: '<section data-testid="settings-view" :data-tab="targetTab" :data-section="targetSection" />',
});

const LinkCheckViewStub = defineComponent({
  name: 'LinkCheckView',
  setup() {
    const targetTab = inject<Ref<string | null>>('linkCheckTargetTab')!;
    return { targetTab };
  },
  template: '<section data-testid="link-check-view" :data-tab="targetTab" />',
});

async function mountMainLayout() {
  const wrapper = mountWithDefaults(MainLayout, {
    global: {
      stubs: {
        TitleBar: TitleBarStub,
        Sidebar: SidebarStub,
        UploadView: UploadViewStub,
        HistoryView: HistoryViewStub,
        SettingsView: SettingsViewStub,
        LinkCheckView: LinkCheckViewStub,
      },
    },
  });

  await flushPromisesAndTicks(2);
  return wrapper;
}

beforeEach(() => {
  resetTauriMocks();
  vi.clearAllMocks();
  navigateHandler = null;
  trayActionHandler = null;
  mockState.setupTrayMenu.mockResolvedValue(mockState.unlistenTrayMenu);
  getListenMock().mockImplementation(async (event, handler) => {
    if (event === 'navigate-to') {
      navigateHandler = handler as NavigateHandler;
      return unlistenNavigate;
    }
    if (event === 'tray-action') {
      trayActionHandler = handler as TrayActionHandler;
      return unlistenTrayAction;
    }
    return vi.fn();
  });
});

describe('MainLayout page navigation shell', () => {
  it('starts on upload and navigates with the sidebar', async () => {
    const wrapper = await mountMainLayout();

    expect(wrapper.find('[data-testid="upload-view"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="sidebar"]').attributes('data-current-view')).toBe('upload');

    await wrapper.get('.nav-history').trigger('click');
    expect(wrapper.find('[data-testid="history-view"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="sidebar"]').attributes('data-current-view')).toBe('history');

    await wrapper.get('.nav-link-check').trigger('click');
    expect(wrapper.find('[data-testid="link-check-view"]').exists()).toBe(true);

    await wrapper.get('.nav-settings').trigger('click');
    expect(wrapper.find('[data-testid="settings-view"]').exists()).toBe(true);
  });

  it('handles Tauri navigate-to events and provides settings target tab and section', async () => {
    const wrapper = await mountMainLayout();

    expect(getListenMock()).toHaveBeenCalledWith('navigate-to', expect.any(Function));
    expect(navigateHandler).toBeTruthy();

    navigateHandler!({ payload: { view: 'settings', tab: 'hosting', section: 'imageCompression' } });
    await flushPromisesAndTicks();

    const settings = wrapper.get('[data-testid="settings-view"]');
    expect(settings.attributes('data-tab')).toBe('hosting');
    expect(settings.attributes('data-section')).toBe('imageCompression');
    expect(wrapper.get('[data-testid="sidebar"]').attributes('data-current-view')).toBe('settings');

    navigateHandler!({ payload: 'history' });
    await flushPromisesAndTicks();

    expect(wrapper.find('[data-testid="history-view"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="sidebar"]').attributes('data-current-view')).toBe('history');
  });

  it('handles link-check target tabs and cleans up the Tauri listener', async () => {
    const wrapper = await mountMainLayout();

    navigateHandler!({ payload: { view: 'link-check', tab: 'migrate' } });
    await flushPromisesAndTicks();

    const linkCheck = wrapper.get('[data-testid="link-check-view"]');
    expect(linkCheck.attributes('data-tab')).toBe('migrate');
    expect(wrapper.get('[data-testid="sidebar"]').attributes('data-current-view')).toBe('link-check');

    wrapper.unmount();
    expect(unlistenNavigate).toHaveBeenCalled();
    expect(unlistenTrayAction).toHaveBeenCalled();
    expect(mockState.unlistenTrayMenu).toHaveBeenCalled();
  });

  it('handles tray upload actions by navigating to the upload page', async () => {
    const wrapper = await mountMainLayout();

    await wrapper.get('.nav-history').trigger('click');
    expect(wrapper.get('[data-testid="sidebar"]').attributes('data-current-view')).toBe('history');

    trayActionHandler!({ payload: 'upload_clipboard' });
    await flushPromisesAndTicks();
    expect(wrapper.get('[data-testid="sidebar"]').attributes('data-current-view')).toBe('upload');

    await wrapper.get('.nav-history').trigger('click');
    trayActionHandler!({ payload: 'select_upload_files' });
    await flushPromisesAndTicks();
    expect(wrapper.get('[data-testid="sidebar"]').attributes('data-current-view')).toBe('upload');
  });
});
