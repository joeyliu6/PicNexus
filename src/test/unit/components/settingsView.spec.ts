import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { shallowMountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../helpers/wait';
import { resetTauriMocks, setupInvokeResponses } from '../../helpers/tauriMock';
import { createConfig } from '../../factories/configFactory';
import SettingsView from '../../../components/views/SettingsView.vue';

const mockState = vi.hoisted(() => ({
  toastShowConfig: vi.fn(),
  setTheme: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  debouncedSaveSettings: vi.fn(),
  debouncedSaveSettingsWithStatus: vi.fn(),
  cancelDebouncedSave: vi.fn(),
  clearFormTimers: vi.fn(),
  addPrefix: vi.fn(),
  updatePrefix: vi.fn(),
  removePrefix: vi.fn(),
  resetToDefaultPrefixes: vi.fn(),
  addCustomS3Profile: vi.fn(),
  deleteCustomS3Profile: vi.fn(),
  updateCustomS3Profile: vi.fn(),
  addWebDAVProfile: vi.fn(),
  deleteWebDAVProfile: vi.fn(),
  switchWebDAVProfile: vi.fn(),
  handleServiceTest: vi.fn(),
  handleBuiltinCheck: vi.fn(),
  testAllConfiguredServices: vi.fn(),
  cancelBatchTest: vi.fn(),
  applyEditorServer: vi.fn(),
  clearEditorTimer: vi.fn(),
  setupCookieListener: vi.fn(),
  openCookieWebView: vi.fn(),
  clearHistory: vi.fn(),
  analyticsEnable: vi.fn(),
  analyticsDisable: vi.fn(),
  reopenOnboarding: vi.fn(),
  configStoreGet: vi.fn(),
  cookieUnlisten: vi.fn(),
  formData: undefined as any,
  availableServices: undefined as any,
  serviceConfigStatus: undefined as any,
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ showConfig: mockState.toastShowConfig }),
}));

vi.mock('../../../composables/useTheme', () => ({
  useThemeManager: () => ({
    currentTheme: ref('system'),
    setTheme: mockState.setTheme,
  }),
}));

vi.mock('../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    setupCookieListener: mockState.setupCookieListener,
    openCookieWebView: mockState.openCookieWebView,
  }),
}));

vi.mock('../../../composables/useHistory', () => ({
  useHistoryManager: () => ({
    clearHistory: mockState.clearHistory,
  }),
}));

vi.mock('../../../composables/useAnalytics', () => ({
  useAnalytics: () => ({
    enable: mockState.analyticsEnable,
    disable: mockState.analyticsDisable,
  }),
}));

vi.mock('../../../composables/useOnboarding', () => ({
  useOnboarding: () => ({
    reopen: mockState.reopenOnboarding,
  }),
}));

vi.mock('../../../store/instances', () => ({
  configStore: {
    get: mockState.configStoreGet,
  },
}));

vi.mock('../../../composables/settings/useSettingsForm', () => ({
  useSettingsForm: () => ({
    formData: mockState.formData,
    isSettingsReady: ref(false),
    availableServices: mockState.availableServices,
    serviceNames: {
      jd: 'JD',
      qiyu: 'Qiyu',
      r2: 'R2',
      smms: 'SM.MS',
      github: 'GitHub',
    },
    serviceConfigStatus: mockState.serviceConfigStatus,
    loadSettings: mockState.loadSettings,
    saveSettings: mockState.saveSettings,
    debouncedSaveSettings: mockState.debouncedSaveSettings,
    debouncedSaveSettingsWithStatus: mockState.debouncedSaveSettingsWithStatus,
    cancelDebouncedSave: mockState.cancelDebouncedSave,
    errorToString: (error: unknown) => error instanceof Error ? error.message : String(error),
    validateS3Config: vi.fn(() => null),
    clearTimers: mockState.clearFormTimers,
    addPrefix: mockState.addPrefix,
    updatePrefix: mockState.updatePrefix,
    removePrefix: mockState.removePrefix,
    resetToDefaultPrefixes: mockState.resetToDefaultPrefixes,
    addCustomS3Profile: mockState.addCustomS3Profile,
    deleteCustomS3Profile: mockState.deleteCustomS3Profile,
    updateCustomS3Profile: mockState.updateCustomS3Profile,
    addWebDAVProfile: mockState.addWebDAVProfile,
    deleteWebDAVProfile: mockState.deleteWebDAVProfile,
    switchWebDAVProfile: mockState.switchWebDAVProfile,
  }),
}));

vi.mock('../../../composables/settings/useConnectionTest', () => ({
  useConnectionTest: () => ({
    qiyuAvailable: ref(true),
    jdAvailable: ref(true),
    isCheckingQiyu: ref(false),
    isCheckingJd: ref(false),
    testingConnections: ref({}),
    activeSession: ref(null),
    visibleRefreshingServiceIds: ref([]),
    isBatchTesting: ref(false),
    batchTestProgress: ref({ done: 0, total: 0 }),
    batchTestCompletionKey: ref(''),
    handleServiceTest: mockState.handleServiceTest,
    handleBuiltinCheck: mockState.handleBuiltinCheck,
    testAllConfiguredServices: mockState.testAllConfiguredServices,
    cancelBatchTest: mockState.cancelBatchTest,
  }),
}));

vi.mock('../../../composables/settings/useEditorIntegration', () => ({
  useEditorIntegration: () => ({
    applyEditorServer: mockState.applyEditorServer,
    clearTimer: mockState.clearEditorTimer,
  }),
}));

const GeneralSettingsPanelStub = defineComponent({
  name: 'GeneralSettingsPanel',
  props: ['autoStart', 'analyticsEnabled'],
  emits: [
    'update:auto-start',
    'update:analytics-enabled',
    'save',
    'clear-history',
    'clear-cache',
  ],
  template: `
    <section data-testid="general-panel" :data-auto-start="String(autoStart)" :data-analytics="String(analyticsEnabled)">
      <button class="toggle-auto-start" @click="$emit('update:auto-start', true)">auto start</button>
      <button class="disable-analytics" @click="$emit('update:analytics-enabled', false)">analytics</button>
      <button class="general-save" @click="$emit('save')">save</button>
    </section>
  `,
});

const AdvancedSettingsPanelStub = defineComponent({
  name: 'AdvancedSettingsPanel',
  props: ['imageCompression', 'editorServer'],
  emits: ['update:image-compression', 'save', 'navigate-hosting'],
  template: `
    <section data-testid="advanced-panel" :data-compression-enabled="String(imageCompression?.enabled)">
      <button class="update-compression" @click="$emit('update:image-compression', { ...imageCompression, enabled: !imageCompression?.enabled })">compression</button>
      <button class="advanced-save" @click="$emit('save')">save</button>
      <button class="advanced-go-hosting" @click="$emit('navigate-hosting')">hosting</button>
    </section>
  `,
});

const HostingSettingsPanelStub = defineComponent({
  name: 'HostingSettingsPanel',
  props: ['availableServices', 'serviceConfigStatus', 'testingConnections', 'targetCardId'],
  emits: [
    'update:available-services',
    'test-private',
    'test-token',
    'test-cookie',
    'check-builtin',
    'test-all',
    'save',
    'card-navigated',
    'scroll-to-service',
  ],
  template: `
    <section data-testid="hosting-panel" :data-services="availableServices.join(',')" :data-target-card="targetCardId || ''">
      <button class="disable-r2" @click="$emit('update:available-services', ['jd'])">disable r2</button>
      <button class="enable-r2" @click="$emit('update:available-services', ['jd', 'r2'])">enable r2</button>
      <button class="test-r2" @click="$emit('test-private', 'r2')">test r2</button>
      <button class="test-smms" @click="$emit('test-token', 'smms')">test smms</button>
      <button class="test-weibo" @click="$emit('test-cookie', 'weibo')">test weibo</button>
      <button class="check-jd" @click="$emit('check-builtin', 'jd')">check jd</button>
      <button class="test-all" @click="$emit('test-all')">test all</button>
      <button class="hosting-save" @click="$emit('save')">save</button>
    </section>
  `,
});

const BackupSyncPanelStub = defineComponent({
  name: 'BackupSyncPanel',
  template: '<section data-testid="backup-panel" />',
});

const AboutUpdatePanelStub = defineComponent({
  name: 'AboutUpdatePanel',
  template: '<section data-testid="about-panel" />',
});

function makeFormData() {
  const config = createConfig({
    availableServices: ['jd', 'r2'],
    imageCompression: {
      enabled: false,
      activePresetId: 'balanced',
      presets: [
        {
          id: 'balanced',
          name: 'Balanced',
          quality: 80,
          outputFormat: 'original',
          maxLongSide: 1920,
          scalePercent: 100,
          skipIfSmallerKB: 0,
          stripExif: true,
        },
      ],
    },
  });

  return ref({
    weiboCookie: config.services?.weibo?.cookie ?? '',
    r2: {
      accountId: 'a'.repeat(32),
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      bucketName: 'bucket',
      path: '',
      publicDomain: 'https://cdn.example.com',
    },
    tencent: { secretId: '', secretKey: '', region: '', bucket: '', path: '', publicDomain: '' },
    aliyun: { accessKeyId: '', accessKeySecret: '', region: '', bucket: '', path: '', publicDomain: '' },
    qiniu: { accessKey: '', secretKey: '', region: '', bucket: '', publicDomain: '', path: '' },
    upyun: { operator: '', password: '', bucket: '', publicDomain: '', path: '' },
    custom_s3_profiles: config.custom_s3_profiles ?? [],
    nowcoder: { cookie: '' },
    zhihu: { cookie: '', sourceParamEnabled: true, sourceParamValue: '172ae18b' },
    nami: { cookie: '', authToken: '' },
    bilibili: { cookie: '' },
    chaoxing: { cookie: '' },
    smms: { token: 'token' },
    github: { token: 'ghp_test', owner: 'owner', repo: 'repo', branch: 'main', path: 'images/', cdnConfig: undefined },
    imgur: { clientId: '' },
    webdav: { profiles: [], activeId: null },
    linkPrefixEnabled: true,
    selectedPrefixIndex: 0,
    linkPrefixList: config.linkPrefixConfig?.prefixList ?? [],
    analyticsEnabled: true,
    appBehavior: { autoStart: false, minimizeToTrayOnStart: false, closeToTray: true },
    linkOutput: {
      defaultFormat: 'url',
      customTemplate: '{url}',
      autoCopy: true,
    },
    globalShortcut: {
      enabled: true,
      uploadClipboard: 'CommandOrControl+Shift+C',
      uploadFromFile: 'CommandOrControl+Shift+O',
    },
    autoUpdateEnabled: true,
    imageCompression: config.imageCompression!,
    editorServer: config.editorServer!,
  });
}

async function mountSettings(provide: Record<string, unknown> = {}) {
  const wrapper = shallowMountWithDefaults(SettingsView, {
    global: {
      provide: {
        settingsTargetTab: ref<string | null>(null),
        settingsTargetSection: ref<string | null>(null),
        ...provide,
      },
      stubs: {
        GeneralSettingsPanel: GeneralSettingsPanelStub,
        AdvancedSettingsPanel: AdvancedSettingsPanelStub,
        HostingSettingsPanel: HostingSettingsPanelStub,
        BackupSyncPanel: BackupSyncPanelStub,
        AboutUpdatePanel: AboutUpdatePanelStub,
      },
    },
  });

  await flushPromisesAndTicks(3);
  return wrapper;
}

beforeEach(() => {
  resetTauriMocks();
  vi.clearAllMocks();

  const config = createConfig({ availableServices: ['jd', 'r2'] });
  mockState.formData = makeFormData();
  mockState.availableServices = ref(['jd', 'r2']);
  mockState.serviceConfigStatus = computed(() => ({
    jd: true,
    r2: true,
    smms: true,
    github: true,
  }));

  mockState.loadSettings.mockResolvedValue(undefined);
  mockState.saveSettings.mockResolvedValue(true);
  mockState.applyEditorServer.mockResolvedValue(undefined);
  mockState.setupCookieListener.mockResolvedValue(mockState.cookieUnlisten);
  mockState.configStoreGet.mockResolvedValue(config);
  setupInvokeResponses({
    get_executable_path: 'C:/Program Files/PicNexus/PicNexus.exe',
    'plugin:autostart|is_enabled': false,
  });
});

describe('SettingsView page interactions', () => {
  it('switches from compression target to hosting tab', async () => {
    const settingsTargetTab = ref<string | null>('compression');
    const settingsTargetSection = ref<string | null>('imageCompression');
    const wrapper = await mountSettings({ settingsTargetTab, settingsTargetSection });

    expect(wrapper.find('[data-testid="advanced-panel"]').exists()).toBe(true);
    expect(settingsTargetTab.value).toBeNull();
    expect(settingsTargetSection.value).toBe('imageCompression');

    await wrapper.get('.advanced-go-hosting').trigger('click');
    expect(wrapper.find('[data-testid="hosting-panel"]').exists()).toBe(true);
  });

  it('opens hosting tab with a target service card from navigation section', async () => {
    const settingsTargetTab = ref<string | null>('hosting');
    const settingsTargetSection = ref<string | null>('r2');
    const wrapper = await mountSettings({ settingsTargetTab, settingsTargetSection });

    const hostingPanel = wrapper.get('[data-testid="hosting-panel"]');
    expect(hostingPanel.attributes('data-target-card')).toBe('r2');
    expect(settingsTargetTab.value).toBeNull();
    expect(settingsTargetSection.value).toBeNull();
  });

  it('enables and disables hosting services and saves through the page handler', async () => {
    const wrapper = await mountSettings();

    await wrapper.findAll('.nav-item')[1].trigger('click');
    expect(wrapper.get('[data-testid="hosting-panel"]').attributes('data-services')).toBe('jd,r2');

    await wrapper.get('.disable-r2').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.availableServices.value).toEqual(['jd']);
    expect(mockState.debouncedSaveSettings).toHaveBeenCalledTimes(1);

    await wrapper.get('.enable-r2').trigger('click');
    await flushPromisesAndTicks();
    expect(mockState.availableServices.value).toEqual(['jd', 'r2']);

    await wrapper.get('.hosting-save').trigger('click');
    expect(mockState.debouncedSaveSettings).toHaveBeenCalledTimes(3);
  });

  it('saves compression changes from the advanced tab', async () => {
    const wrapper = await mountSettings();

    await wrapper.findAll('.nav-item')[2].trigger('click');
    await wrapper.get('.update-compression').trigger('click');
    await flushPromisesAndTicks();

    expect(mockState.formData.value.imageCompression.enabled).toBe(true);
    expect(mockState.debouncedSaveSettingsWithStatus).toHaveBeenCalledTimes(1);

    await wrapper.get('.advanced-save').trigger('click');
    expect(mockState.debouncedSaveSettingsWithStatus).toHaveBeenCalledTimes(2);
  });

  it('runs private, token, cookie, builtin, and batch connection tests from hosting', async () => {
    const wrapper = await mountSettings();

    await wrapper.findAll('.nav-item')[1].trigger('click');
    await wrapper.get('.test-r2').trigger('click');
    await wrapper.get('.test-smms').trigger('click');
    await wrapper.get('.test-weibo').trigger('click');
    await wrapper.get('.check-jd').trigger('click');
    await wrapper.get('.test-all').trigger('click');

    expect(mockState.handleServiceTest).toHaveBeenCalledWith('r2');
    expect(mockState.handleServiceTest).toHaveBeenCalledWith('smms');
    expect(mockState.handleServiceTest).toHaveBeenCalledWith('weibo');
    expect(mockState.handleBuiltinCheck).toHaveBeenCalledWith('jd');
    expect(mockState.testAllConfiguredServices).toHaveBeenCalled();
  });

  it('shows an error and rolls back when auto-start toggle fails', async () => {
    setupInvokeResponses({
      'plugin:autostart|enable': new Error('permission denied'),
    });
    const wrapper = await mountSettings();

    await wrapper.get('.toggle-auto-start').trigger('click');
    await flushPromisesAndTicks();

    expect(mockState.toastShowConfig).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ summary: expect.any(String) }),
    );
    expect(mockState.formData.value.appBehavior.autoStart).toBe(false);
    expect(mockState.saveSettings).not.toHaveBeenCalled();
  });
});
