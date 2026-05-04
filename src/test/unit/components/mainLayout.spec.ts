import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, inject, type Ref } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../helpers/wait';
import { getListenMock, resetTauriMocks } from '../../helpers/tauriMock';

const mockState = vi.hoisted(() => ({
  historyGetPage: vi.fn(),
  copyLinks: vi.fn(),
  toastWarn: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../../../services/HistoryDatabase', () => ({
  historyDB: {
    getPage: mockState.historyGetPage,
  },
}));

vi.mock('../../../composables/useCopyLink', () => ({
  useCopyLink: () => ({
    copyLinks: mockState.copyLinks,
  }),
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    warn: mockState.toastWarn,
    error: mockState.toastError,
  }),
}));

import MainLayout from '../../../components/layout/MainLayout.vue';

type NavigatePayload = string | { view: string; tab?: string; section?: string };
type NavigateHandler = (event: { payload: NavigatePayload }) => void;
type TrayAction = 'upload_clipboard' | 'select_upload_files' | 'copy_latest_link';
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
  mockState.historyGetPage.mockResolvedValue({ items: [], total: 0, hasMore: false });
  mockState.copyLinks.mockResolvedValue({ ok: true, copiedCount: 1, format: 'url' });
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
  });

  it('handles tray actions for upload navigation and copying the latest link', async () => {
    const wrapper = await mountMainLayout();

    await wrapper.get('.nav-history').trigger('click');
    expect(wrapper.get('[data-testid="sidebar"]').attributes('data-current-view')).toBe('history');

    trayActionHandler!({ payload: 'upload_clipboard' });
    await flushPromisesAndTicks();
    expect(wrapper.get('[data-testid="sidebar"]').attributes('data-current-view')).toBe('upload');

    mockState.historyGetPage.mockResolvedValue({
      items: [{
        id: 'h1',
        timestamp: 1,
        localFileName: 'latest.png',
        primaryService: 'smms',
        generatedLink: 'https://cdn.example/latest.png',
        width: 800,
        height: 600,
        results: [{
          serviceId: 'smms',
          status: 'success',
          result: { serviceId: 'smms', fileKey: 'latest', url: 'https://cdn.example/latest.png' },
        }],
      }],
      total: 1,
      hasMore: false,
    });

    trayActionHandler!({ payload: 'copy_latest_link' });
    await flushPromisesAndTicks();

    expect(mockState.historyGetPage).toHaveBeenCalledWith({ page: 1, pageSize: 1 });
    expect(mockState.copyLinks).toHaveBeenCalledWith([{
      url: 'https://cdn.example/latest.png',
      fileName: 'latest.png',
      serviceId: 'smms',
      width: 800,
      height: 600,
    }], { showSuccessToast: true, showErrorToast: true });
  });

  it('warns when copying the latest link without history', async () => {
    await mountMainLayout();

    trayActionHandler!({ payload: 'copy_latest_link' });
    await flushPromisesAndTicks();

    expect(mockState.toastWarn).toHaveBeenCalledWith('无上传历史', '没有可复制的链接');
    expect(mockState.copyLinks).not.toHaveBeenCalled();
  });
});
