import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../helpers/wait';
import { getEmitMock, getListenMock, resetTauriMocks } from '../../helpers/tauriMock';
import UploadView from '@/components/views/UploadView.vue';

const mockState = vi.hoisted(() => ({
  showConfirm: vi.fn(),
  loadHealthStatus: vi.fn(),
  evaluateConfig: vi.fn(),
  selectFiles: vi.fn(),
  handleFilesUpload: vi.fn(),
  loadServiceButtonStates: vi.fn(),
  setupConfigListener: vi.fn(),
  toggleServiceSelection: vi.fn(),
  saveHistoryItem: vi.fn(),
  pasteAndUpload: vi.fn(),
  downloadAndUpload: vi.fn(),
  clearQueue: vi.fn(),
  clearCompletedItems: vi.fn(),
  saveConfig: vi.fn(),
  configGet: vi.fn(),
  retryAllFailed: vi.fn(),
  setRetryCallback: vi.fn(),
  configUnlisten: vi.fn(),
  uploadManager: undefined as any,
  queueState: undefined as any,
  serviceHealth: undefined as any,
  clipboardImage: undefined as any,
  urlDownload: undefined as any,
  config: undefined as any,
}));

type EventHandler = (event: { payload: unknown }) => void;
let eventHandlers: Record<string, EventHandler[]> = {};

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn(), showConfig: vi.fn() }),
}));

vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({ showConfirm: mockState.showConfirm }),
}));

vi.mock('@/composables/useServiceHealth', () => ({
  useServiceHealth: () => mockState.serviceHealth,
}));

vi.mock('@/composables/useUpload', () => ({
  useUploadManager: () => mockState.uploadManager,
}));

vi.mock('@/composables/useClipboardImage', () => ({
  useClipboardImage: () => mockState.clipboardImage,
}));

vi.mock('@/composables/useUrlDownload', () => ({
  useUrlDownload: () => mockState.urlDownload,
}));

vi.mock('@/composables/useQueueState', () => ({
  useQueueState: () => mockState.queueState,
}));

vi.mock('@/services/RetryService', () => ({
  RetryService: vi.fn(() => ({ retryAllFailed: mockState.retryAllFailed })),
}));

vi.mock('@/store/instances', () => ({
  configStore: { get: mockState.configGet },
}));

vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({ saveConfig: mockState.saveConfig }),
}));

const DropZoneStub = defineComponent({
  name: 'UploadDropZone',
  props: [
    'compressionEnabled',
    'activePreset',
    'presets',
    'isDragging',
    'isPasting',
    'isDownloading',
  ],
  emits: [
    'click',
    'paste',
    'url-download',
    'update:compressionEnabled',
    'update:activePresetId',
    'go-compression-settings',
  ],
  template: `
    <section data-testid="drop-zone" :data-compression="String(compressionEnabled)" @click="$emit('click')">
      <button class="paste" @click.stop="$emit('paste')">paste</button>
      <button class="url" @click.stop="$emit('url-download')">url</button>
      <button class="toggle-compression" @click.stop="$emit('update:compressionEnabled', !compressionEnabled)">toggle</button>
      <button class="switch-preset" @click.stop="$emit('update:activePresetId', 'lossless')">preset</button>
      <button class="compression-settings" @click.stop="$emit('go-compression-settings')">settings</button>
    </section>
  `,
});

const ServiceSelectorStub = defineComponent({
  name: 'ServiceSelector',
  props: ['publicServices', 'privateServices', 'serviceLabels'],
  emits: ['toggle', 'go-settings', 'go-service-settings'],
  template: `
    <section data-testid="service-selector">
      <button class="toggle-smms" @click="$emit('toggle', 'smms')">toggle smms</button>
      <button class="go-hosting" @click="$emit('go-settings')">settings</button>
      <button class="go-weibo-settings" @click="$emit('go-service-settings', 'weibo')">weibo settings</button>
    </section>
  `,
});

const QueuePanelStub = defineComponent({
  name: 'UploadQueuePanel',
  props: [
    'hasFailedItems',
    'hasCompletedItems',
    'hasQueueItems',
    'hasActiveItems',
    'isBatchRetrying',
    'queueTotal',
    'queueDone',
  ],
  emits: ['batch-retry', 'clear-completed', 'clear-queue'],
  methods: {
    setRetryCallback: mockState.setRetryCallback,
  },
  template: `
    <section data-testid="queue-panel">
      <button class="batch-retry" @click="$emit('batch-retry')">retry</button>
      <button class="clear-completed" @click="$emit('clear-completed')">clear completed</button>
      <button class="clear-queue" @click="$emit('clear-queue')">clear queue</button>
    </section>
  `,
});

const UrlDialogStub = defineComponent({
  name: 'UrlDownloadDialog',
  props: ['visible', 'isDownloading'],
  emits: ['confirm', 'update:visible'],
  template: `
    <section v-if="visible" data-testid="url-dialog">
      <button class="confirm-url" @click="$emit('confirm', 'https://example.com/image.png')">confirm</button>
    </section>
  `,
});

function makeConfig() {
  return {
    availableServices: ['smms', 'r2'],
    imageCompression: {
      enabled: false,
      activePresetId: 'balanced',
      presets: [
        { id: 'balanced', name: 'Balanced', quality: 80, maxWidth: 1920, maxHeight: 1080 },
        { id: 'lossless', name: 'Lossless', quality: 100, maxWidth: 0, maxHeight: 0 },
      ],
    },
  };
}

async function mountView() {
  const wrapper = mountWithDefaults(UploadView, {
    global: {
      stubs: {
        UploadDropZone: DropZoneStub,
        ServiceSelector: ServiceSelectorStub,
        UploadQueuePanel: QueuePanelStub,
        UrlDownloadDialog: UrlDialogStub,
      },
    },
  });

  await flushPromisesAndTicks(2);
  return wrapper;
}

beforeEach(() => {
  resetTauriMocks();
  vi.clearAllMocks();
  eventHandlers = {};
  getListenMock().mockImplementation(async (event, handler) => {
    const key = String(event);
    eventHandlers[key] = eventHandlers[key] || [];
    eventHandlers[key].push(handler as EventHandler);
    return vi.fn();
  });

  mockState.config = makeConfig();
  mockState.configGet.mockResolvedValue(mockState.config);
  mockState.saveConfig.mockResolvedValue(undefined);
  mockState.setupConfigListener.mockResolvedValue(mockState.configUnlisten);
  mockState.selectFiles.mockResolvedValue(['C:/tmp/a.png']);
  mockState.handleFilesUpload.mockResolvedValue(undefined);
  mockState.pasteAndUpload.mockImplementation(async (upload: (files: string[]) => Promise<void>) => {
    await upload(['clipboard.png']);
  });
  mockState.downloadAndUpload.mockImplementation(async (
    input: string,
    upload: (files: string[]) => Promise<void>,
  ) => {
    await upload([input]);
    return true;
  });
  mockState.retryAllFailed.mockResolvedValue(undefined);

  mockState.uploadManager = {
    activePrefix: ref('markdown'),
    availableServices: ref(['smms', 'r2']),
    isServiceSelected: ref((serviceId: string) => serviceId === 'smms'),
    selectFiles: mockState.selectFiles,
    handleFilesUpload: mockState.handleFilesUpload,
    loadServiceButtonStates: mockState.loadServiceButtonStates,
    setupConfigListener: mockState.setupConfigListener,
    toggleServiceSelection: mockState.toggleServiceSelection,
    saveHistoryItem: mockState.saveHistoryItem,
  };

  mockState.queueState = {
    queueItems: ref([
      { id: 'failed-1', status: 'error', serviceProgress: { smms: { status: 'failed' } } },
      { id: 'done-1', status: 'success', serviceProgress: {} },
    ]),
    clearQueue: mockState.clearQueue,
    clearCompletedItems: mockState.clearCompletedItems,
    hasCompletedItems: ref(true),
  };

  mockState.serviceHealth = {
    healthStatusMap: ref({ smms: 'healthy', r2: 'healthy' }),
    healthTooltipMap: ref({ smms: 'OK', r2: 'OK' }),
    loadHealthStatus: mockState.loadHealthStatus,
    evaluateConfig: mockState.evaluateConfig,
  };

  mockState.clipboardImage = {
    isProcessing: ref(false),
    pasteAndUpload: mockState.pasteAndUpload,
  };

  mockState.urlDownload = {
    isDownloading: ref(false),
    downloadAndUpload: mockState.downloadAndUpload,
  };
});

describe('UploadView page interactions', () => {
  it('loads initial services and wires file, clipboard, and URL uploads', async () => {
    const wrapper = await mountView();

    expect(mockState.loadServiceButtonStates).toHaveBeenCalled();
    expect(mockState.loadHealthStatus).toHaveBeenCalled();
    expect(mockState.evaluateConfig).toHaveBeenCalledWith(mockState.config);

    await wrapper.find('[data-testid="drop-zone"]').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.selectFiles).toHaveBeenCalled();
    expect(mockState.handleFilesUpload).toHaveBeenCalledWith(['C:/tmp/a.png']);

    await wrapper.find('.paste').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.pasteAndUpload).toHaveBeenCalledWith(mockState.handleFilesUpload);
    expect(mockState.handleFilesUpload).toHaveBeenCalledWith(['clipboard.png']);

    await wrapper.find('.url').trigger('click');
    await flushPromisesAndTicks();
    expect(wrapper.find('[data-testid="url-dialog"]').exists()).toBe(true);
    await wrapper.find('.confirm-url').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.downloadAndUpload).toHaveBeenCalledWith(
      'https://example.com/image.png',
      mockState.handleFilesUpload,
    );
    expect(mockState.handleFilesUpload).toHaveBeenCalledWith(['https://example.com/image.png']);
    expect(wrapper.find('[data-testid="url-dialog"]').exists()).toBe(false);
  });

  it('keeps URL dialog open when URL download is rejected before upload', async () => {
    mockState.downloadAndUpload.mockResolvedValueOnce(false);
    const wrapper = await mountView();

    await wrapper.find('.url').trigger('click');
    await flushPromisesAndTicks();
    await wrapper.find('.confirm-url').trigger('click');
    await flushPromisesAndTicks();

    expect(mockState.downloadAndUpload).toHaveBeenCalledWith(
      'https://example.com/image.png',
      mockState.handleFilesUpload,
    );
    expect(wrapper.find('[data-testid="url-dialog"]').exists()).toBe(true);
  });

  it('handles tray upload actions through the existing upload handlers', async () => {
    await mountView();

    eventHandlers['tray-action']?.[0]?.({ payload: 'select_upload_files' });
    await flushPromisesAndTicks();
    expect(mockState.selectFiles).toHaveBeenCalled();
    expect(mockState.handleFilesUpload).toHaveBeenCalledWith(['C:/tmp/a.png']);

    mockState.selectFiles.mockClear();
    mockState.handleFilesUpload.mockClear();

    eventHandlers['tray-action']?.[0]?.({ payload: 'upload_clipboard' });
    await flushPromisesAndTicks();
    expect(mockState.pasteAndUpload).toHaveBeenCalledWith(mockState.handleFilesUpload);
    expect(mockState.handleFilesUpload).toHaveBeenCalledWith(['clipboard.png']);
  });

  it('persists compression changes and navigates to compression settings', async () => {
    const wrapper = await mountView();

    await wrapper.find('.toggle-compression').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.saveConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        imageCompression: expect.objectContaining({ enabled: true }),
      }),
      true,
    );

    await wrapper.find('.switch-preset').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.saveConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        imageCompression: expect.objectContaining({ activePresetId: 'lossless' }),
      }),
      true,
    );

    await wrapper.find('.compression-settings').trigger('click');
    expect(getEmitMock()).toHaveBeenCalledWith('navigate-to', {
      view: 'settings',
      tab: 'compression',
      section: 'imageCompression',
    });
  });

  it('forwards service selection and queue actions', async () => {
    const wrapper = await mountView();

    await wrapper.find('.toggle-smms').trigger('click');
    expect(mockState.toggleServiceSelection).toHaveBeenCalledWith('smms');

    await wrapper.find('.go-hosting').trigger('click');
    expect(getEmitMock()).toHaveBeenCalledWith('navigate-to', { view: 'settings', tab: 'hosting' });

    await wrapper.find('.go-weibo-settings').trigger('click');
    expect(getEmitMock()).toHaveBeenCalledWith('navigate-to', {
      view: 'settings',
      tab: 'hosting',
      section: 'weibo',
    });

    await wrapper.find('.clear-completed').trigger('click');
    expect(mockState.clearCompletedItems).toHaveBeenCalled();

    await wrapper.find('.clear-queue').trigger('click');
    const confirmOptions = mockState.showConfirm.mock.calls[0][0];
    confirmOptions.accept();
    expect(mockState.clearQueue).toHaveBeenCalled();

    await wrapper.find('.batch-retry').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.retryAllFailed).toHaveBeenCalledWith(['failed-1'], mockState.config);
  });

  // 回归护栏：WebDAV 图床刚上线时，设置页能配、首页却看不见。
  // 病因是 visiblePrivateServices 只展开了 custom_s3 profiles，
  // 而多实例图床的 ID（custom_s3:xxx / webdav:xxx）不在 PRIVATE_SERVICES 常量里。
  // 两类必须同时断言：只测 WebDAV 的话，有人用「替换」而不是「新增」来修就照样过。
  it('lists both custom S3 and WebDAV profiles under private storage', async () => {
    mockState.config = {
      ...makeConfig(),
      custom_s3_profiles: [{ id: 's3a', name: '我的 MinIO' }],
      webdav_profiles: [
        { id: 'davA', name: '家里的 NAS' },
        { id: 'davB', name: '' },
      ],
    };
    mockState.configGet.mockResolvedValue(mockState.config);
    mockState.uploadManager.availableServices = ref([
      'r2', 'custom_s3:s3a', 'webdav:davA', 'webdav:davB',
    ]);
    mockState.serviceHealth.healthStatusMap = ref({
      r2: 'verified',
      'custom_s3:s3a': 'verified',
      'webdav:davA': 'verified',
      'webdav:davB': 'verified',
    });

    const wrapper = await mountView();
    const selector = wrapper.findComponent(ServiceSelectorStub);
    const privateServices = selector.props('privateServices') as string[];
    const labels = selector.props('serviceLabels') as Record<string, string>;

    expect(privateServices).toContain('webdav:davA');
    expect(privateServices).toContain('custom_s3:s3a');
    expect(labels['webdav:davA']).toBe('家里的 NAS');
    expect(labels['custom_s3:s3a']).toBe('我的 MinIO');
    // 未命名 profile 要有兜底标签，否则首页是个没有文字的空芯片
    expect(labels['webdav:davB']).toBe('WebDAV');
  });

  it('drops WebDAV entries that are unconfigured or absent from availableServices', async () => {
    mockState.config = {
      ...makeConfig(),
      webdav_profiles: [
        { id: 'davOk', name: '已配置' },
        { id: 'davBad', name: '缺字段' },
        { id: 'davGone', name: '已删除' },
      ],
    };
    mockState.configGet.mockResolvedValue(mockState.config);
    // davGone 不在 availableServices 里（profile 刚删、配置还没刷新）
    mockState.uploadManager.availableServices = ref(['webdav:davOk', 'webdav:davBad']);
    mockState.serviceHealth.healthStatusMap = ref({
      'webdav:davOk': 'verified',
      'webdav:davBad': 'unconfigured',
    });

    const wrapper = await mountView();
    const privateServices = wrapper.findComponent(ServiceSelectorStub).props('privateServices') as string[];

    expect(privateServices).toEqual(['webdav:davOk']);
  });

  it('registers retry callback and cleans listeners on unmount', async () => {
    const wrapper = await mountView();

    expect(mockState.setRetryCallback).toHaveBeenCalledWith(expect.any(Function));
    wrapper.unmount();
    expect(mockState.configUnlisten).toHaveBeenCalled();
  });
});
