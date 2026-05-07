import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { shallowMountWithDefaults } from '../../helpers/vueMount';
import { flushPromisesAndTicks } from '../../helpers/wait';
import { getInvokeMock, resetTauriMocks, setupInvokeResponses } from '../../helpers/tauriMock';
import { createConfig } from '../../factories/configFactory';
import { DEFAULT_CONFIG } from '../../../config/types';
import SettingsView from '../../../components/views/SettingsView.vue';

const mockState = vi.hoisted(() => ({
  toastShowConfig: vi.fn(),
  setTheme: vi.fn(),
  updateThemeConfig: vi.fn(),
  confirm: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  resetToDefaultSettings: vi.fn(),
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
  testWebDAVConnection: vi.fn(),
  clearHistory: vi.fn(),
  analyticsEnable: vi.fn(),
  analyticsDisable: vi.fn(),
  reopenOnboarding: vi.fn(),
  configStoreGet: vi.fn(),
  cookieUnlisten: vi.fn(),
  hasAvailableUpdate: undefined as any,
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
    updateConfig: mockState.updateThemeConfig,
  }),
}));

vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({
    confirm: mockState.confirm,
  }),
}));

vi.mock('../../../composables/useConfig', () => ({
  useConfigManager: () => ({
    setupCookieListener: mockState.setupCookieListener,
    openCookieWebView: mockState.openCookieWebView,
    testWebDAVConnection: mockState.testWebDAVConnection,
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

vi.mock('../../../composables/useAutoUpdate', () => ({
  useAutoUpdate: () => ({
    hasAvailableUpdate: mockState.hasAvailableUpdate,
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
    resetToDefaultSettings: mockState.resetToDefaultSettings,
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
  props: ['autoStart', 'analyticsEnabled', 'isResettingDefaults'],
  emits: [
    'update:auto-start',
    'update:analytics-enabled',
    'save',
    'clear-history',
    'clear-cache',
    'reset-defaults',
  ],
  template: `
    <section data-testid="general-panel" :data-auto-start="String(autoStart)" :data-analytics="String(analyticsEnabled)">
      <button class="toggle-auto-start" @click="$emit('update:auto-start', true)">auto start</button>
      <button class="disable-analytics" @click="$emit('update:analytics-enabled', false)">analytics</button>
      <button class="reset-defaults" @click="$emit('reset-defaults')">reset</button>
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
    'accept-public-service-risk',
    'test-private',
    'test-token',
    'test-cookie',
    'check-builtin',
    'test-all',
    'save',
    'card-navigated',
    'scroll-to-service',
    'add-custom-s3',
  ],
  template: `
    <section data-testid="hosting-panel" :data-services="availableServices.join(',')" :data-target-card="targetCardId || ''">
      <button class="disable-r2" @click="$emit('update:available-services', ['jd'])">disable r2</button>
      <button class="enable-r2" @click="$emit('update:available-services', ['jd', 'r2'])">enable r2</button>
      <button class="accept-public-risk" @click="$emit('accept-public-service-risk')">accept risk</button>
      <button class="test-r2" @click="$emit('test-private', 'r2')">test r2</button>
      <button class="test-smms" @click="$emit('test-token', 'smms')">test smms</button>
      <button class="test-weibo" @click="$emit('test-cookie', 'weibo')">test weibo</button>
      <button class="check-jd" @click="$emit('check-builtin', 'jd')">check jd</button>
      <button class="test-all" @click="$emit('test-all')">test all</button>
      <button class="add-custom-s3" @click="$emit('add-custom-s3')">add custom s3</button>
      <button class="hosting-save" @click="$emit('save')">save</button>
    </section>
  `,
});

const BackupSyncPanelStub = defineComponent({
  name: 'BackupSyncPanel',
  props: ['webdavConfig', 'webdavTesting'],
  emits: ['testWebDAV'],
  template: `
    <section
      data-testid="backup-panel"
      :data-testing="String(webdavTesting)"
      :data-status="webdavConfig.profiles[0]?.connectionStatus || ''"
    >
      <button class="test-webdav" @click="$emit('testWebDAV')">test webdav</button>
    </section>
  `,
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
    publicServiceRiskAccepted: false,
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
  mockState.hasAvailableUpdate = ref(false);
  mockState.serviceConfigStatus = computed(() => ({
    jd: true,
    r2: true,
    smms: true,
    github: true,
  }));

  mockState.loadSettings.mockResolvedValue(undefined);
  mockState.saveSettings.mockResolvedValue(true);
  mockState.addCustomS3Profile.mockReturnValue('custom_s3:new-profile');
  mockState.resetToDefaultSettings.mockResolvedValue(true);
  mockState.applyEditorServer.mockResolvedValue(undefined);
  mockState.setupCookieListener.mockResolvedValue(mockState.cookieUnlisten);
  mockState.confirm.mockResolvedValue(true);
  mockState.testWebDAVConnection.mockResolvedValue({ success: true, message: '连接成功' });
  mockState.configStoreGet.mockResolvedValue(config);
  setupInvokeResponses({
    get_executable_path: 'C:/Program Files/PicNexus/PicNexus.exe',
    'plugin:autostart|is_enabled': false,
  });
});

describe('SettingsView page interactions', () => {
  it('shows the update badge only on the about update tab when an update is available', async () => {
    mockState.hasAvailableUpdate = ref(true);
    const wrapper = await mountSettings();
    const navItems = wrapper.findAll('.nav-item');

    expect(navItems[4].classes()).toContain('has-update-badge');
    expect(navItems.slice(0, 4).every(item => !item.classes().includes('has-update-badge'))).toBe(true);
  });

  it('does not show the about update badge when no update is available', async () => {
    const wrapper = await mountSettings();

    expect(wrapper.findAll('.nav-item')[4].classes()).not.toContain('has-update-badge');
  });

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

  it('records public service risk acknowledgement from hosting settings', async () => {
    const wrapper = await mountSettings();

    await wrapper.findAll('.nav-item')[1].trigger('click');
    await wrapper.get('.accept-public-risk').trigger('click');

    expect(mockState.formData.value.publicServiceRiskAccepted).toBe(true);
    expect(mockState.debouncedSaveSettings).not.toHaveBeenCalled();
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

  it('targets the newly created custom S3 card after adding a profile', async () => {
    const wrapper = await mountSettings();

    await wrapper.findAll('.nav-item')[1].trigger('click');
    await wrapper.get('.add-custom-s3').trigger('click');
    await flushPromisesAndTicks();

    expect(mockState.addCustomS3Profile).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="hosting-panel"]').attributes('data-target-card')).toBe('custom_s3:new-profile');
  });

  it('tests WebDAV from backup settings and persists the connection status', async () => {
    mockState.formData.value.webdav = {
      activeId: 'nas',
      profiles: [{
        id: 'nas',
        name: 'NAS',
        url: 'https://dav.example.com',
        username: 'user',
        password: 'secret',
        remotePath: '/PicNexus/',
      }],
    };
    const wrapper = await mountSettings();

    await wrapper.findAll('.nav-item')[3].trigger('click');
    await wrapper.get('.test-webdav').trigger('click');
    await flushPromisesAndTicks();

    expect(mockState.testWebDAVConnection).toHaveBeenCalledWith({
      url: 'https://dav.example.com',
      username: 'user',
      password: 'secret',
      remotePath: '/PicNexus/',
    });
    expect(mockState.formData.value.webdav.profiles[0].connectionStatus).toBe('success');
    expect(mockState.saveSettings).toHaveBeenCalledTimes(1);
    expect(mockState.toastShowConfig).toHaveBeenCalledWith('success', expect.objectContaining({ summary: '验证成功' }));
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

  it('cancels restoring defaults when the confirm dialog is rejected', async () => {
    mockState.confirm.mockResolvedValueOnce(false);
    const wrapper = await mountSettings();
    getInvokeMock().mockClear();

    await wrapper.get('.reset-defaults').trigger('click');
    await flushPromisesAndTicks();

    expect(mockState.confirm).toHaveBeenCalledWith(
      expect.stringContaining('上传历史记录和应用缓存会保留'),
      expect.objectContaining({ header: '恢复默认设置' }),
    );
    expect(mockState.cancelDebouncedSave).not.toHaveBeenCalled();
    expect(mockState.resetToDefaultSettings).not.toHaveBeenCalled();
    expect(getInvokeMock()).not.toHaveBeenCalledWith('plugin:autostart|disable');
  });

  it('restores default settings after confirmation and keeps history/cache untouched', async () => {
    const wrapper = await mountSettings();
    getInvokeMock().mockClear();
    mockState.formData.value.appBehavior = {
      autoStart: true,
      minimizeToTrayOnStart: false,
      closeToTray: false,
    };

    await wrapper.get('.reset-defaults').trigger('click');
    await flushPromisesAndTicks(3);

    expect(mockState.cancelDebouncedSave).toHaveBeenCalled();
    expect(getInvokeMock()).toHaveBeenCalledWith('plugin:autostart|disable');
    expect(getInvokeMock()).toHaveBeenCalledWith('set_close_to_tray', { enabled: true });
    expect(mockState.resetToDefaultSettings).toHaveBeenCalledTimes(1);

    const resetConfig = mockState.resetToDefaultSettings.mock.calls[0][0];
    expect(resetConfig).toMatchObject({
      ...DEFAULT_CONFIG,
      onboardingCompleted: false,
    });
    expect(mockState.updateThemeConfig).toHaveBeenCalledWith(resetConfig);
    expect(mockState.analyticsEnable).toHaveBeenCalled();
    expect(mockState.applyEditorServer).toHaveBeenCalledWith(DEFAULT_CONFIG.editorServer, { force: true });
    expect(mockState.clearHistory).not.toHaveBeenCalled();
    expect(mockState.toastShowConfig).toHaveBeenCalledWith(
      'success',
      expect.objectContaining({ summary: '已恢复默认设置' }),
    );
  });

  it('does not fail reset when autostart is already disabled and the startup entry is missing', async () => {
    const wrapper = await mountSettings();
    getInvokeMock().mockClear();
    mockState.formData.value.appBehavior = {
      autoStart: false,
      minimizeToTrayOnStart: false,
      closeToTray: false,
    };
    getInvokeMock().mockImplementation(async (command, args) => {
      if (command === 'plugin:autostart|disable') throw new Error('系统找不到指定的文件。 (os error 2)');
      return args;
    });

    await wrapper.get('.reset-defaults').trigger('click');
    await flushPromisesAndTicks(3);

    expect(getInvokeMock()).not.toHaveBeenCalledWith('plugin:autostart|disable');
    expect(getInvokeMock()).toHaveBeenCalledWith('set_close_to_tray', { enabled: true });
    expect(mockState.resetToDefaultSettings).toHaveBeenCalledTimes(1);
    expect(mockState.toastShowConfig).toHaveBeenCalledWith(
      'success',
      expect.objectContaining({ summary: '已恢复默认设置' }),
    );
  });

  it('does not write default config and rolls back when external reset side effects fail', async () => {
    const wrapper = await mountSettings();
    getInvokeMock().mockClear();
    mockState.formData.value.appBehavior = {
      autoStart: true,
      minimizeToTrayOnStart: false,
      closeToTray: false,
    };

    let closeToTrayCalls = 0;
    getInvokeMock().mockImplementation(async (command, args) => {
      if (command === 'set_close_to_tray') {
        closeToTrayCalls += 1;
        if (closeToTrayCalls === 1) throw new Error('close-to-tray denied');
      }
      return args;
    });

    await wrapper.get('.reset-defaults').trigger('click');
    await flushPromisesAndTicks();

    expect(getInvokeMock()).toHaveBeenCalledWith('plugin:autostart|disable');
    expect(getInvokeMock()).toHaveBeenCalledWith('set_close_to_tray', { enabled: true });
    expect(getInvokeMock()).toHaveBeenCalledWith('plugin:autostart|enable');
    expect(getInvokeMock()).toHaveBeenCalledWith('set_close_to_tray', { enabled: false });
    expect(mockState.resetToDefaultSettings).not.toHaveBeenCalled();
    expect(mockState.updateThemeConfig).not.toHaveBeenCalled();
    expect(mockState.toastShowConfig).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ summary: '恢复默认设置失败' }),
    );
  });
});
