<script setup lang="ts">
// 设置视图 - 重构后精简版
// 核心逻辑保留，UI 组件拆分到独立面板

import { ref, computed, watch, inject, onMounted, onUnmounted, onActivated } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { useToast, suppressToasts } from '../../composables/useToast';
import { TOAST_MESSAGES } from '../../constants';
import { useConfirm } from '../../composables/useConfirm';
import { useThemeManager } from '../../composables/useTheme';
import { useConfigManager } from '../../composables/useConfig';
import { useHistoryManager } from '../../composables/useHistory';
import { useAnalytics } from '../../composables/useAnalytics';
import { useServiceAvailability } from '../../composables/useServiceAvailability';
import { useServiceHealth } from '../../composables/useServiceHealth';
import { useOnboarding } from '../../composables/useOnboarding';
import { SERVICE_DISPLAY_NAMES } from '../../constants/serviceNames';
import { SERVICE_REQUIRED_FIELDS } from '../../constants/serviceRequiredFields';
import type { BatchTestProgress } from '../../types/batchTest';

// 组件
import HostingSettingsPanel from '../settings/HostingSettingsPanel.vue';
import GeneralSettingsPanel from '../settings/GeneralSettingsPanel.vue';
import AdvancedSettingsPanel from '../settings/AdvancedSettingsPanel.vue';
import BackupSyncPanel from '../settings/BackupSyncPanel.vue';
import AboutUpdatePanel from '../settings/AboutUpdatePanel.vue';

import { configStore } from '../../store/instances';
import type {
  ThemeMode,
  UserConfig,
  ServiceType,
  WebDAVProfile,
  ImageCompressionConfig,
  EditorServerConfig,
  ServerServiceType,
  CustomS3Profile,
} from '../../config/types';
import { DEFAULT_CONFIG, DEFAULT_PREFIXES, makeCustomS3Id, isCustomS3Id, getCustomS3ProfileId } from '../../config/types';
import { syncCustomS3Uploaders } from '../../uploaders';


const toast = useToast();
const { confirm: confirmDialog } = useConfirm();
const { currentTheme, setTheme } = useThemeManager();
const configManager = useConfigManager();
const historyManager = useHistoryManager();
const analytics = useAnalytics();

const {
  qiyuAvailable,
  jdAvailable,
  isCheckingQiyu,
  isCheckingJd,
  checkQiyuAvailability,
  checkJdAvailable,
} = useServiceAvailability();

const serviceHealth = useServiceHealth();
const { reopen: reopenOnboarding } = useOnboarding();


const cookieUnlisten = ref<UnlistenFn | null>(null);
const compressionSyncUnlisten = ref<UnlistenFn | null>(null);
const appVersion = ref<string>('');
const executablePath = ref<string>('');
const isClearingCache = ref(false);

// 导航状态
type SettingsTab = 'general' | 'hosting' | 'advanced' | 'backup' | 'about';
const activeTab = ref<SettingsTab>('general');

// 接收来自 MainLayout 的 tab 跳转指令（不提供 fallback，确保拿到 provide 的同一个 ref）
const settingsTargetTab = inject<import('vue').Ref<string | null>>('settingsTargetTab');

const applyTargetTab = () => {
  if (settingsTargetTab?.value) {
    const validTabs: SettingsTab[] = ['general', 'hosting', 'advanced', 'backup', 'about'];
    // 兼容旧跳转：compression/editor 均跳转到 advanced
    if (settingsTargetTab.value === 'compression' || settingsTargetTab.value === 'editor') {
      activeTab.value = 'advanced';
      settingsTargetTab.value = null;
      return;
    }
    if (validTabs.includes(settingsTargetTab.value as SettingsTab)) {
      activeTab.value = settingsTargetTab.value as SettingsTab;
    }
    settingsTargetTab.value = null;
  }
};

// KeepAlive 重新激活时检查
onActivated(applyTargetTab);

// watch 兜底：处理时序竞争（settingsTargetTab 在 onActivated 之后才被赋值的情况）
if (settingsTargetTab) {
  watch(settingsTargetTab, (val) => {
    if (val) applyTargetTab();
  });
}

const isSettingsReady = ref(false);

interface NavItem {
  id: SettingsTab;
  label: string;
  icon: string;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    items: [
      { id: 'general', label: '常规设置', icon: 'pi pi-cog' },
      { id: 'hosting', label: '图床设置', icon: 'pi pi-images' },
      { id: 'advanced', label: '高级设置', icon: 'pi pi-sliders-h' },
      { id: 'backup', label: '备份与同步', icon: 'pi pi-database' },
      { id: 'about', label: '关于与更新', icon: 'pi pi-info-circle' },
    ]
  }
];

// 表单数据
const formData = ref({
  weiboCookie: '',
  r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucketName: '', path: '', publicDomain: '' },
  tencent: { secretId: '', secretKey: '', region: '', bucket: '', path: '', publicDomain: '' },
  aliyun: { accessKeyId: '', accessKeySecret: '', region: '', bucket: '', path: '', publicDomain: '' },
  qiniu: { accessKey: '', secretKey: '', region: '', bucket: '', publicDomain: '', path: '' },
  upyun: { operator: '', password: '', bucket: '', publicDomain: '', path: '' },
  custom_s3_profiles: [] as CustomS3Profile[],
  nowcoder: { cookie: '' },
  zhihu: { cookie: '' },
  nami: { cookie: '', authToken: '' },
  bilibili: { cookie: '' },
  chaoxing: { cookie: '' },
  smms: { token: '' },
  github: { token: '', owner: '', repo: '', branch: 'main', path: 'images/' } as import('../../config/types').GithubServiceConfig,
  imgur: { clientId: '', clientSecret: '' },
  webdav: { profiles: [] as WebDAVProfile[], activeId: null as string | null },
  linkPrefixEnabled: true,
  selectedPrefixIndex: 0,
  linkPrefixList: [...DEFAULT_PREFIXES],
  analyticsEnabled: true,
  appBehavior: { autoStart: false, minimizeToTrayOnStart: false, closeToTray: true },
  linkOutput: {
    defaultFormat: 'url' as import('../../utils/linkFormatter').LinkFormat,
    customTemplate: '{url}',
    autoCopy: true,
  },
  globalShortcut: {
    enabled: true,
    uploadClipboard: 'CommandOrControl+Shift+C',
    uploadFromFile: 'CommandOrControl+Shift+O',
  },
  autoUpdateEnabled: true,
  imageCompression: { ...DEFAULT_CONFIG.imageCompression! } as ImageCompressionConfig,
  editorServer: { ...DEFAULT_CONFIG.editorServer! } as EditorServerConfig,
});

type SaveFeedbackStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveFeedbackState {
  status: SaveFeedbackStatus;
  message?: string;
  updatedAt?: number;
}

const advancedSaveState = ref<SaveFeedbackState>({ status: 'idle' });
const lastAppliedEditorPayloadKey = ref<string | null>(null);
let _advancedSavedResetTimer: ReturnType<typeof setTimeout> | null = null;
let _debouncedEditorApplyTimer: ReturnType<typeof setTimeout> | null = null;

// 测试连接状态
const testingConnections = ref<Record<string, boolean>>({
  weibo: false, r2: false, tencent: false, aliyun: false, qiniu: false, upyun: false,
  nowcoder: false, zhihu: false, nami: false, bilibili: false, chaoxing: false,
  smms: false, github: false, imgur: false, webdav: false
});

// 批量测试状态
const isBatchTesting = ref(false);
const batchTestProgress = ref<BatchTestProgress | null>(null);
const batchTestAborted = ref(false);
const batchTestCompletionKey = ref(0);
const MIN_DISPLAY_MS = 300;
const COMPLETE_LINGER_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 可用服务列表
const availableServices = ref<string[]>([]);

// 图床设置跳转：目标卡片 ID
const targetCardId = ref<string | null>(null);

// 图床名称映射（基于常量，覆盖部分显示名称以适应 UI）
const serviceNames: Record<ServiceType, string> = {
  ...SERVICE_DISPLAY_NAMES,
  r2: 'R2',  // 设置界面使用简短名称
};


const serviceConfigStatus = computed<Record<string, boolean>>(() => {
  const fd = formData.value;
  const result: Record<string, boolean> = {
    r2: !!(fd.r2.accountId && fd.r2.accessKeyId && fd.r2.secretAccessKey && fd.r2.bucketName && fd.r2.publicDomain),
    tencent: !!(fd.tencent.secretId && fd.tencent.secretKey && fd.tencent.region && fd.tencent.bucket && fd.tencent.publicDomain),
    aliyun: !!(fd.aliyun.accessKeyId && fd.aliyun.accessKeySecret && fd.aliyun.region && fd.aliyun.bucket && fd.aliyun.publicDomain),
    qiniu: !!(fd.qiniu.accessKey && fd.qiniu.secretKey && fd.qiniu.region && fd.qiniu.bucket && fd.qiniu.publicDomain),
    upyun: !!(fd.upyun.operator && fd.upyun.password && fd.upyun.bucket && fd.upyun.publicDomain),
    weibo: !!fd.weiboCookie?.trim(),
    zhihu: !!fd.zhihu.cookie?.trim(),
    nowcoder: !!fd.nowcoder.cookie?.trim(),
    nami: !!fd.nami.cookie?.trim(),
    bilibili: !!fd.bilibili.cookie?.trim(),
    chaoxing: !!fd.chaoxing.cookie?.trim(),
    smms: !!fd.smms.token?.trim(),
    github: !!(fd.github.token?.trim() && fd.github.owner?.trim() && fd.github.repo?.trim()),
    imgur: !!fd.imgur.clientId?.trim(),
    jd: true,
    qiyu: true,
  };
  for (const profile of fd.custom_s3_profiles || []) {
    result[makeCustomS3Id(profile.id)] = !!(profile.endpoint && profile.accessKeyId && profile.secretAccessKey && profile.region && profile.bucket);
  }
  return result;
});

function setAdvancedSaveState(status: SaveFeedbackStatus, message?: string) {
  advancedSaveState.value = { status, message, updatedAt: Date.now() };
  if (_advancedSavedResetTimer) {
    clearTimeout(_advancedSavedResetTimer);
    _advancedSavedResetTimer = null;
  }
  if (status === 'saved') {
    _advancedSavedResetTimer = setTimeout(() => {
      if (advancedSaveState.value.status === 'saved') {
        advancedSaveState.value = { status: 'idle' };
      }
      _advancedSavedResetTimer = null;
    }, 1800);
  }
}

// 防抖版保存：用于 blur/watch 触发的自动保存，500ms 内多次触发合并为一次
let _debouncedSaveTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingSaveTrackStatus = false;
function scheduleSave(trackAdvancedStatus = false) {
  _pendingSaveTrackStatus = _pendingSaveTrackStatus || trackAdvancedStatus;
  if (_debouncedSaveTimer !== null) clearTimeout(_debouncedSaveTimer);
  _debouncedSaveTimer = setTimeout(() => {
    _debouncedSaveTimer = null;
    const trackStatus = _pendingSaveTrackStatus;
    _pendingSaveTrackStatus = false;
    void saveSettings({ trackAdvancedStatus: trackStatus });
  }, 500);
}

function debouncedSaveSettings() {
  scheduleSave(false);
}

function debouncedSaveSettingsWithStatus() {
  scheduleSave(true);
}

function cancelDebouncedSave() {
  if (_debouncedSaveTimer !== null) {
    clearTimeout(_debouncedSaveTimer);
    _debouncedSaveTimer = null;
  }
  _pendingSaveTrackStatus = false;
}

watch(serviceConfigStatus, (newStatus, oldStatus) => {
  if (!oldStatus) return;
  let changed = false;
  for (const [svc, configured] of Object.entries(newStatus)) {
    const serviceId = svc as ServiceType;
    if (configured && !oldStatus[serviceId]) {
      if (!availableServices.value.includes(serviceId)) {
        availableServices.value.push(serviceId);
        changed = true;
      }
    } else if (!configured && oldStatus[serviceId]) {
      const idx = availableServices.value.indexOf(serviceId);
      if (idx !== -1) {
        availableServices.value.splice(idx, 1);
        changed = true;
      }
    }
  }
  if (changed) debouncedSaveSettings();
});

async function loadSettings() {
  try {
    const config = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

    formData.value.weiboCookie = (config.services?.weibo as any)?.cookie || '';
    formData.value.r2 = { ...formData.value.r2, ...(config.services?.r2 || {}) };
    formData.value.tencent = { ...formData.value.tencent, ...(config.services?.tencent || {}) };
    formData.value.aliyun = { ...formData.value.aliyun, ...(config.services?.aliyun || {}) };
    formData.value.qiniu = { ...formData.value.qiniu, ...(config.services?.qiniu || {}) };
    formData.value.upyun = { ...formData.value.upyun, ...(config.services?.upyun || {}) };
    formData.value.nowcoder = { ...formData.value.nowcoder, ...(config.services?.nowcoder || {}) };
    formData.value.zhihu = { ...formData.value.zhihu, ...(config.services?.zhihu || {}) };
    formData.value.nami = { ...formData.value.nami, ...(config.services?.nami || {}) };
    formData.value.bilibili = { ...formData.value.bilibili, ...(config.services?.bilibili || {}) };
    formData.value.chaoxing = { ...formData.value.chaoxing, ...(config.services?.chaoxing || {}) };
    formData.value.smms = { ...formData.value.smms, ...(config.services?.smms || {}) };
    formData.value.github = { ...formData.value.github, ...(config.services?.github || {}) };
    formData.value.imgur = { ...formData.value.imgur, ...(config.services?.imgur || {}) };

    // 迁移旧的单实例 custom_s3 配置到 profiles
    const oldCustomS3 = (config.services as any)?.custom_s3;
    if (oldCustomS3 && (!config.custom_s3_profiles || config.custom_s3_profiles.length === 0)) {
      if (oldCustomS3.endpoint || oldCustomS3.accessKeyId) {
        const profileId = generateId();
        config.custom_s3_profiles = [{
          id: profileId,
          name: '自定义 S3',
          endpoint: oldCustomS3.endpoint || '',
          accessKeyId: oldCustomS3.accessKeyId || '',
          secretAccessKey: oldCustomS3.secretAccessKey || '',
          region: oldCustomS3.region || '',
          bucket: oldCustomS3.bucket || '',
          path: oldCustomS3.path || '',
          publicDomain: oldCustomS3.publicDomain || '',
        }];
        const oldId = 'custom_s3';
        const newId = makeCustomS3Id(profileId);
        if (config.enabledServices?.includes(oldId)) {
          config.enabledServices = config.enabledServices.filter((s: string) => s !== oldId).concat(newId);
        }
        if (config.availableServices?.includes(oldId)) {
          config.availableServices = config.availableServices.filter((s: string) => s !== oldId).concat(newId);
        }
      }
      delete (config.services as any).custom_s3;
    }

    // 自定义 S3 profiles
    formData.value.custom_s3_profiles = config.custom_s3_profiles || [];
    syncCustomS3Uploaders(formData.value.custom_s3_profiles);

    // WebDAV 配置
    if (config.webdav) {
      const profiles = await Promise.all(
        (config.webdav.profiles || []).map(async (p: any) => {
          if (p.passwordEncrypted && !p.password) {
            try {
              p.password = await invoke<string>('decrypt_webdav_password', { encrypted: p.passwordEncrypted });
            } catch (e) {
              console.error('[WebDAV] 解密失败:', e);
              p.password = '';
            }
          }
          return p;
        })
      );
      formData.value.webdav = { profiles, activeId: config.webdav.activeId || null };
    }

    // 链接前缀
    if (config.linkPrefixConfig) {
      formData.value.linkPrefixEnabled = config.linkPrefixConfig.enabled ?? true;
      formData.value.selectedPrefixIndex = config.linkPrefixConfig.selectedIndex ?? 0;
      formData.value.linkPrefixList = config.linkPrefixConfig.prefixList || [...DEFAULT_PREFIXES];
    }

    // 链接输出配置
    if (config.linkOutput) {
      formData.value.linkOutput = { ...formData.value.linkOutput, ...config.linkOutput };
    }

    formData.value.analyticsEnabled = config.analytics?.enabled ?? true;
    formData.value.appBehavior = config.appBehavior ?? { autoStart: false, minimizeToTrayOnStart: false, closeToTray: true };
    if (formData.value.appBehavior.closeToTray === undefined) {
      formData.value.appBehavior.closeToTray = true;
    }
    formData.value.autoUpdateEnabled = config.autoUpdate?.enabled ?? true;
    formData.value.imageCompression = config.imageCompression ?? { ...DEFAULT_CONFIG.imageCompression! };
    formData.value.editorServer = { ...DEFAULT_CONFIG.editorServer!, ...(config.editorServer ?? {}) };
    formData.value.globalShortcut = config.globalShortcut ?? {
      enabled: true,
      uploadClipboard: 'CommandOrControl+Shift+C',
      uploadFromFile: 'CommandOrControl+Shift+O',
    };
    availableServices.value = config.availableServices || ['jd', 'qiyu'];

    // 从 OS 同步自启动真实状态
    try {
      const isEnabled = await invoke<boolean>('plugin:autostart|is_enabled');
      formData.value.appBehavior.autoStart = isEnabled;
    } catch { /* 忽略：插件不可用时保持配置值 */ }

    // 初始化图床健康状态
    await serviceHealth.loadHealthStatus();
    serviceHealth.evaluateConfig(config);

  } catch (e) {
    console.error('[设置] 加载失败:', e);
  }
}

async function saveSettings(options: { trackAdvancedStatus?: boolean } = {}): Promise<boolean> {
  const { trackAdvancedStatus = false } = options;
  if (trackAdvancedStatus) {
    setAdvancedSaveState('saving', '保存中…');
  }

  try {
    const config = await configStore.get<UserConfig>('config') || { ...DEFAULT_CONFIG };

    config.services = {
      ...config.services,
      weibo: { enabled: true, cookie: formData.value.weiboCookie },
      r2: { ...formData.value.r2, enabled: true },
      tencent: { ...formData.value.tencent, enabled: true },
      aliyun: { ...formData.value.aliyun, enabled: true },
      qiniu: { ...formData.value.qiniu, enabled: true },
      upyun: { ...formData.value.upyun, enabled: true },
      nowcoder: { ...formData.value.nowcoder, enabled: true },
      zhihu: { ...formData.value.zhihu, enabled: true },
      bilibili: { ...formData.value.bilibili, enabled: true },
      chaoxing: { ...formData.value.chaoxing, enabled: true },
      smms: { ...formData.value.smms, enabled: true },
      github: { ...formData.value.github, enabled: true },
      imgur: { ...formData.value.imgur, enabled: true },
    };

    // 自定义 S3 profiles
    config.custom_s3_profiles = formData.value.custom_s3_profiles;

    // Nami Token 提取
    const namiCookie = formData.value.nami.cookie;
    let namiAuthToken = formData.value.nami.authToken || '';
    if (namiCookie) {
      const tokenMatch = namiCookie.match(/token=([^;]+)/);
      if (tokenMatch) namiAuthToken = tokenMatch[1];
    }
    config.services.nami = { enabled: true, cookie: namiCookie, authToken: namiAuthToken };

    // WebDAV 密码加密
    const encryptedProfiles = await Promise.all(
      formData.value.webdav.profiles.map(async (p) => {
        let passwordEncrypted = p.passwordEncrypted;
        if (p.password && !passwordEncrypted) {
          try {
            passwordEncrypted = await invoke<string>('encrypt_webdav_password', { password: p.password });
          } catch (e) {
            console.error('[WebDAV] 加密失败:', e);
          }
        }
        return { ...p, password: '', passwordEncrypted };
      })
    );
    config.webdav = { profiles: encryptedProfiles, activeId: formData.value.webdav.activeId };

    config.linkPrefixConfig = {
      enabled: formData.value.linkPrefixEnabled,
      selectedIndex: formData.value.selectedPrefixIndex,
      prefixList: [...formData.value.linkPrefixList]
    };

    config.linkOutput = { ...formData.value.linkOutput };
    config.analytics = { enabled: formData.value.analyticsEnabled };
    config.appBehavior = { ...formData.value.appBehavior };
    config.globalShortcut = { ...formData.value.globalShortcut };
    config.autoUpdate = { enabled: formData.value.autoUpdateEnabled };
    config.imageCompression = { ...formData.value.imageCompression };
    config.editorServer = { ...formData.value.editorServer };
    config.availableServices = [...availableServices.value];

    await configManager.saveConfig(config, true);
    syncCustomS3Uploaders(formData.value.custom_s3_profiles);
    serviceHealth.evaluateConfig(config);

    if (trackAdvancedStatus) {
      setAdvancedSaveState('saved', '已保存');
    }
    return true;
  } catch (e) {
    console.error('[设置] 保存失败:', e);
    toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(String(e)));
    if (trackAdvancedStatus) {
      setAdvancedSaveState('error', `保存失败：${errorToString(e)}`);
    }
    return false;
  }
}


async function handleThemeChange(mode: ThemeMode) {
  try {
    await setTheme(mode);
    // 主题切换本身就是视觉反馈，无需 toast 通知
  } catch (e) {
    toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(String(e)));
  }
}


async function testTokenConnection(serviceId: string, token: string) {
  try {
    if (serviceId === 'smms') {
      const res = await fetch('https://sm.ms/api/v2/upload', {
        method: 'POST',
        headers: { 'Authorization': token }
      });
      if (!res.ok) throw new Error('Token 无效');
    } else if (serviceId === 'imgur') {
      const res = await fetch('https://api.imgur.com/3/account/albums', {
        headers: { 'Authorization': `Client-ID ${token}` }
      });
      if (!res.ok) throw new Error('Client ID 无效');
    }
    toast.showConfig('success', TOAST_MESSAGES.auth.tokenValid(serviceNames[serviceId as ServiceType]));
  } catch (error) {
    toast.showConfig('error', TOAST_MESSAGES.auth.tokenFailed(serviceNames[serviceId as ServiceType], String(error)));
    throw error;
  }
}

async function testGitHubConnection() {
  try {
    const config = formData.value.github;
    const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}`, {
      headers: { 'Authorization': `token ${config.token}`, 'User-Agent': 'PicNexus' }
    });
    if (!res.ok) throw new Error('验证失败');
    toast.showConfig('success', TOAST_MESSAGES.auth.configValid('GitHub'));
  } catch (error) {
    toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed('GitHub', String(error)));
    throw error;
  }
}

function errorToString(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    try { return JSON.stringify(error); } catch { /* fallthrough */ }
  }
  return String(error);
}

function validateS3Config(serviceId: ServiceType, config: Record<string, unknown>): string | null {
  const fields = SERVICE_REQUIRED_FIELDS[serviceId] || [];
  for (const field of fields) {
    const val = config[field];
    if (!val || String(val).trim().length < 2) {
      return `${field} 格式无效（至少 2 个字符）`;
    }
  }
  if (serviceId === 'r2' && config.accountId && !/^[a-f0-9]{32}$/.test(String(config.accountId))) {
    return 'Account ID 格式不正确（应为 32 位十六进制字符串）';
  }
  if (config.publicDomain && !/^https?:\/\/.+/.test(String(config.publicDomain))) {
    return '公开访问域名应以 http:// 或 https:// 开头';
  }
  return null;
}

async function testS3Connection(serviceId: string) {
  let config: any;
  let displayName: string;

  if (isCustomS3Id(serviceId)) {
    const profileId = getCustomS3ProfileId(serviceId);
    const profile = formData.value.custom_s3_profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('找不到该自定义 S3 配置');
    config = { ...profile };
    displayName = profile.name || '自定义 S3';
  } else {
    config = formData.value[serviceId as keyof typeof formData.value] as any;
    displayName = serviceNames[serviceId as ServiceType];
  }

  const validationError = validateS3Config(serviceId as ServiceType, config);
  if (validationError) {
    toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed(displayName, validationError));
    throw new Error(validationError);
  }
  try {
    await invoke('test_s3_connection', { serviceId, config });
    toast.showConfig('success', TOAST_MESSAGES.auth.configValid(displayName));
  } catch (error) {
    const msg = errorToString(error);
    toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed(displayName, msg));
    throw error;
  }
}

async function testConn(fn: () => Promise<void>, key: string) {
  testingConnections.value[key] = true;
  try {
    await fn();
    serviceHealth.markVerified(key as ServiceType);
  } catch (e) {
    serviceHealth.markTestFailed(key as ServiceType, errorToString(e));
  } finally {
    testingConnections.value[key] = false;
  }
}

async function testCookieConnection(command: string, params: Record<string, string>, serviceId: ServiceType) {
  try {
    await invoke(command, params);
    toast.showConfig('success', TOAST_MESSAGES.auth.cookieValid(serviceNames[serviceId]));
  } catch (e) {
    toast.showConfig('error', TOAST_MESSAGES.auth.testFailed(String(e)));
    throw e;
  }
}

const actions: Record<string, () => Promise<void>> = {
  r2: () => testS3Connection('r2'),
  tencent: () => testS3Connection('tencent'),
  aliyun: () => testS3Connection('aliyun'),
  qiniu: () => testS3Connection('qiniu'),
  upyun: () => testS3Connection('upyun'),
  smms: () => testTokenConnection('smms', formData.value.smms.token),
  github: () => testGitHubConnection(),
  imgur: () => testTokenConnection('imgur', formData.value.imgur.clientId),
  weibo: () => testCookieConnection('test_weibo_connection', { weiboCookie: formData.value.weiboCookie || '' }, 'weibo'),
  zhihu: () => testCookieConnection('test_zhihu_connection', { zhihuCookie: formData.value.zhihu?.cookie || '' }, 'zhihu'),
  nowcoder: () => testCookieConnection('test_nowcoder_cookie', { nowcoderCookie: formData.value.nowcoder?.cookie || '' }, 'nowcoder'),
  bilibili: () => testCookieConnection('test_bilibili_connection', { bilibiliCookie: formData.value.bilibili?.cookie || '' }, 'bilibili'),
  chaoxing: () => testCookieConnection('test_chaoxing_connection', { chaoxingCookie: formData.value.chaoxing?.cookie || '' }, 'chaoxing'),
  nami: () => {
    const cookie = formData.value.nami.cookie || '';
    const tokenMatch = cookie.match(/token=([^;]+)/);
    const authToken = formData.value.nami.authToken || (tokenMatch ? tokenMatch[1] : '');
    return testCookieConnection('test_nami_connection', { cookie, authToken }, 'nami');
  },
  jd: async () => {
    await checkJdAvailable(true);
    if (!jdAvailable.value) throw new Error('京东图床当前不可用');
  },
  qiyu: async () => {
    await checkQiyuAvailability(true);
    if (!qiyuAvailable.value) throw new Error('七鱼图床当前不可用');
  },
};

async function handleServiceTest(serviceId: string) {
  if (isCustomS3Id(serviceId)) {
    await testConn(() => testS3Connection(serviceId), serviceId);
    return;
  }
  await testConn(actions[serviceId], serviceId);
}

async function handleBuiltinCheck(serviceId: string) {
  if (serviceId === 'jd') {
    await checkJdAvailable();
    toast.showConfig('info', jdAvailable.value
      ? TOAST_MESSAGES.auth.serviceAvailable('京东图床')
      : TOAST_MESSAGES.auth.serviceUnavailable('京东图床'));
  } else if (serviceId === 'qiyu') {
    await checkQiyuAvailability(true);
    toast.showConfig('info', qiyuAvailable.value
      ? TOAST_MESSAGES.auth.serviceAvailable('七鱼图床')
      : TOAST_MESSAGES.auth.serviceUnavailable('七鱼图床'));
  }
}

const S3_SERVICE_IDS: ServiceType[] = ['r2', 'tencent', 'aliyun', 'qiniu', 'upyun'];

function preValidateService(serviceId: string): string | null {
  if (isCustomS3Id(serviceId)) {
    const profileId = getCustomS3ProfileId(serviceId);
    const profile = formData.value.custom_s3_profiles.find(p => p.id === profileId);
    if (!profile) return '找不到该自定义 S3 配置';
    return validateS3Config(serviceId as ServiceType, profile as any);
  }
  if (S3_SERVICE_IDS.includes(serviceId as ServiceType)) {
    const config = formData.value[serviceId as keyof typeof formData.value] as any;
    return validateS3Config(serviceId as ServiceType, config);
  }
  return null;
}

async function runServiceTest(serviceId: ServiceType, task: Promise<void>) {
  try {
    await task;
    serviceHealth.markVerified(serviceId);
  } catch (e) {
    serviceHealth.markTestFailed(serviceId, errorToString(e));
  }
}

async function testAllConfiguredServices() {
  if (isBatchTesting.value) return;

  const MIN_TOTAL_MS = 1500;
  const SLOW_SERVICES: ServiceType[] = ['qiyu'];

  const allServices = (Object.entries(serviceHealth.healthStatusMap.value) as [ServiceType, string][])
    .filter(([id]) => actions[id])
    .map(([id, status]) => ({ id: id as ServiceType, status }));

  if (allServices.length === 0) return;

  const normalServices = allServices.filter(s => !SLOW_SERVICES.includes(s.id));
  const slowServiceEntries = allServices.filter(s => SLOW_SERVICES.includes(s.id));
  const orderedServices = [...normalServices, ...slowServiceEntries];

  isBatchTesting.value = true;
  batchTestAborted.value = false;
  batchTestProgress.value = { current: 0, total: orderedServices.length, currentService: '' };
  suppressToasts(true);

  const slowPromises = new Map<ServiceType, Promise<void>>();
  for (const s of slowServiceEntries) {
    if (s.status !== 'unconfigured' && !preValidateService(s.id)) {
      slowPromises.set(s.id, actions[s.id]());
    }
  }

  const overallStartTime = Date.now();

  try {
    for (let i = 0; i < orderedServices.length; i++) {
      if (batchTestAborted.value) break;

      const { id: serviceId, status } = orderedServices[i];
      const startTime = Date.now();

      batchTestProgress.value = {
        current: i,
        total: orderedServices.length,
        currentService: serviceNames[serviceId],
      };
      testingConnections.value[serviceId] = true;

      if (status === 'unconfigured') {
        await delay(MIN_DISPLAY_MS);
      } else {
        const validationError = preValidateService(serviceId);
        if (validationError) {
          serviceHealth.markTestFailed(serviceId, validationError);
          await delay(MIN_DISPLAY_MS);
        } else {
          const task = slowPromises.get(serviceId) ?? actions[serviceId]();
          await runServiceTest(serviceId, task);
          const elapsed = Date.now() - startTime;
          if (elapsed < MIN_DISPLAY_MS) await delay(MIN_DISPLAY_MS - elapsed);
        }
      }

      testingConnections.value[serviceId] = false;
    }

    if (!batchTestAborted.value) {
      batchTestProgress.value = {
        current: orderedServices.length,
        total: orderedServices.length,
        currentService: '',
      };
      const totalElapsed = Date.now() - overallStartTime;
      await delay(Math.max(COMPLETE_LINGER_MS, MIN_TOTAL_MS - totalElapsed));
    }
  } finally {
    suppressToasts(false);
    isBatchTesting.value = false;
    batchTestProgress.value = null;
    batchTestCompletionKey.value++;
  }
}

function scrollToService(serviceId: string) {
  targetCardId.value = serviceId;
}

async function handleCookieLogin(serviceId: string) {
  await configManager.openCookieWebView(serviceId as ServiceType);
}


function addPrefix() {
  formData.value.linkPrefixList.push('');
}

function removePrefix(index: number) {
  if (formData.value.linkPrefixList.length > 1) {
    formData.value.linkPrefixList.splice(index, 1);
    if (formData.value.selectedPrefixIndex >= formData.value.linkPrefixList.length) {
      formData.value.selectedPrefixIndex = formData.value.linkPrefixList.length - 1;
    }
    saveSettings();
  }
}

function resetToDefaultPrefixes() {
  formData.value.linkPrefixList = [...DEFAULT_PREFIXES];
  formData.value.selectedPrefixIndex = 0;
  saveSettings();
}

function addCustomS3Profile() {
  const newProfile: CustomS3Profile = {
    id: generateId(),
    name: `自定义 S3 ${formData.value.custom_s3_profiles.length + 1}`,
    endpoint: '', accessKeyId: '', secretAccessKey: '',
    region: '', bucket: '', path: '', publicDomain: ''
  };
  formData.value.custom_s3_profiles.push(newProfile);
  saveSettings();
}

async function deleteCustomS3Profile(profileId: string) {
  const profile = formData.value.custom_s3_profiles.find(p => p.id === profileId);
  const profileName = profile?.name || '自定义 S3';
  const confirmed = await confirmDialog(
    `确定要删除「${profileName}」配置吗？删除后相关的编辑器服务绑定也会一并清除。`,
    '删除配置'
  );
  if (!confirmed) return;

  formData.value.custom_s3_profiles = formData.value.custom_s3_profiles.filter(p => p.id !== profileId);
  const compositeId = makeCustomS3Id(profileId);
  availableServices.value = availableServices.value.filter(s => s !== compositeId);

  // 级联清理：编辑器服务绑定
  const editor = formData.value.editorServer;
  if (editor.typoraService === compositeId) {
    editor.typoraService = '' as ServerServiceType;
  }
  if (editor.obsidianService === compositeId) {
    editor.obsidianService = '' as ServerServiceType;
  }

  saveSettings();
}

function updateCustomS3Profile(profile: CustomS3Profile) {
  const idx = formData.value.custom_s3_profiles.findIndex(p => p.id === profile.id);
  if (idx !== -1) {
    formData.value.custom_s3_profiles[idx] = { ...profile };
  }
  saveSettings();
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

function addWebDAVProfile() {
  const newProfile: WebDAVProfile = {
    id: generateId(),
    name: `配置 ${formData.value.webdav.profiles.length + 1}`,
    url: '',
    username: '',
    password: '',
    remotePath: '/PicNexus/'
  };
  formData.value.webdav.profiles.push(newProfile);
  formData.value.webdav.activeId = newProfile.id;
  saveSettings();
}

async function deleteWebDAVProfile(id: string) {
  const confirmed = await confirmDialog('确定要删除此 WebDAV 配置吗？', '删除配置');
  if (!confirmed) return;
  formData.value.webdav.profiles = formData.value.webdav.profiles.filter(p => p.id !== id);
  if (formData.value.webdav.activeId === id) {
    formData.value.webdav.activeId = formData.value.webdav.profiles[0]?.id || null;
  }
  saveSettings();
}

function switchWebDAVProfile(id: string) {
  formData.value.webdav.activeId = id;
  saveSettings();
}




async function handleClearHistory() {
  await historyManager.clearHistory();
}

async function handleClearAppCache() {
  isClearingCache.value = true;
  try {
    const webview = getCurrentWebview();
    await webview.clearAllBrowsingData();
    toast.showConfig('success', TOAST_MESSAGES.cache.clearSuccess);
  } catch (error) {
    console.error('[设置] 清理缓存失败:', error);
    toast.showConfig('error', TOAST_MESSAGES.cache.clearFailed(String(error)));
  } finally {
    isClearingCache.value = false;
  }
}

function buildServiceConfigJson(service: ServerServiceType | null): string | null {
  if (!service) return null;

  const svc = service;
  const fd = formData.value;

  switch (svc) {
    case 'jd':
      return JSON.stringify({ type: 'jd' });
    case 'qiyu':
      return JSON.stringify({ type: 'qiyu' });
    case 'github':
      return JSON.stringify({ type: 'github', token: fd.github.token, owner: fd.github.owner, repo: fd.github.repo, branch: fd.github.branch, path: fd.github.path });
    case 'smms':
      return JSON.stringify({ type: 'smms', token: fd.smms.token });
    case 'imgur':
      return JSON.stringify({ type: 'imgur', clientId: fd.imgur.clientId });
    case 'weibo':
      return JSON.stringify({ type: 'weibo', cookie: fd.weiboCookie });
    case 'bilibili':
      return JSON.stringify({ type: 'bilibili', cookie: fd.bilibili.cookie });
    case 'nowcoder':
      return JSON.stringify({ type: 'nowcoder', cookie: fd.nowcoder.cookie });
    case 'chaoxing':
      return JSON.stringify({ type: 'chaoxing', cookie: fd.chaoxing.cookie });
    case 'zhihu':
      return JSON.stringify({ type: 'zhihu', cookie: fd.zhihu.cookie });
    case 'nami': {
      const cookie = fd.nami.cookie;
      const tokenMatch = cookie.match(/token=([^;]+)/);
      const authToken = fd.nami.authToken || (tokenMatch ? tokenMatch[1] : '');
      return JSON.stringify({ type: 'nami', cookie, authToken });
    }
    case 'r2':
      return JSON.stringify({ type: 'r2', accountId: fd.r2.accountId, accessKeyId: fd.r2.accessKeyId, secretAccessKey: fd.r2.secretAccessKey, bucketName: fd.r2.bucketName, path: fd.r2.path, publicDomain: fd.r2.publicDomain });
    case 'tencent':
      return JSON.stringify({ type: 'tencent', secretId: fd.tencent.secretId, secretKey: fd.tencent.secretKey, region: fd.tencent.region, bucket: fd.tencent.bucket, path: fd.tencent.path, publicDomain: fd.tencent.publicDomain });
    case 'aliyun':
      return JSON.stringify({ type: 'aliyun', accessKeyId: fd.aliyun.accessKeyId, accessKeySecret: fd.aliyun.accessKeySecret, region: fd.aliyun.region, bucket: fd.aliyun.bucket, path: fd.aliyun.path, publicDomain: fd.aliyun.publicDomain });
    case 'qiniu':
      // 前端字段 publicDomain → Rust 侧 custom_domain（JSON: customDomain）
      return JSON.stringify({ type: 'qiniu', accessKey: fd.qiniu.accessKey, secretKey: fd.qiniu.secretKey, region: fd.qiniu.region, bucket: fd.qiniu.bucket, customDomain: fd.qiniu.publicDomain, path: fd.qiniu.path });
    case 'upyun':
      return JSON.stringify({ type: 'upyun', operator: fd.upyun.operator, password: fd.upyun.password, bucket: fd.upyun.bucket, publicDomain: fd.upyun.publicDomain });
    default: {
      if (isCustomS3Id(svc)) {
        const profileId = getCustomS3ProfileId(svc);
        const profile = fd.custom_s3_profiles.find(p => p.id === profileId);
        if (profile) {
          return JSON.stringify({ type: svc, endpoint: profile.endpoint, accessKeyId: profile.accessKeyId, secretAccessKey: profile.secretAccessKey, region: profile.region, bucket: profile.bucket, path: profile.path, publicDomain: profile.publicDomain });
        }
      }
      return null;
    }
  }
}

function buildObsidianApplyPayload(cfg: EditorServerConfig) {
  return {
    enabled: cfg.enabled,
    port: cfg.port,
    serviceConfigJson: buildServiceConfigJson(cfg.obsidianService),
  };
}

function buildEditorCredentialSignature(service: ServerServiceType, fd: typeof formData.value): string {
  switch (service) {
    case 'jd':
    case 'qiyu':
      return service;
    case 'github':
      return [fd.github.token, fd.github.owner, fd.github.repo, fd.github.branch, fd.github.path].join('|');
    case 'smms':
      return fd.smms.token;
    case 'imgur':
      return fd.imgur.clientId;
    case 'weibo':
      return fd.weiboCookie;
    case 'bilibili':
      return fd.bilibili.cookie;
    case 'nowcoder':
      return fd.nowcoder.cookie;
    case 'chaoxing':
      return fd.chaoxing.cookie;
    case 'zhihu':
      return fd.zhihu.cookie;
    case 'nami':
      return [fd.nami.cookie, fd.nami.authToken].join('|');
    case 'r2':
      return [fd.r2.accountId, fd.r2.accessKeyId, fd.r2.secretAccessKey, fd.r2.bucketName, fd.r2.path, fd.r2.publicDomain].join('|');
    case 'tencent':
      return [fd.tencent.secretId, fd.tencent.secretKey, fd.tencent.region, fd.tencent.bucket, fd.tencent.path, fd.tencent.publicDomain].join('|');
    case 'aliyun':
      return [fd.aliyun.accessKeyId, fd.aliyun.accessKeySecret, fd.aliyun.region, fd.aliyun.bucket, fd.aliyun.path, fd.aliyun.publicDomain].join('|');
    case 'qiniu':
      return [fd.qiniu.accessKey, fd.qiniu.secretKey, fd.qiniu.region, fd.qiniu.bucket, fd.qiniu.publicDomain, fd.qiniu.path].join('|');
    case 'upyun':
      return [fd.upyun.operator, fd.upyun.password, fd.upyun.bucket, fd.upyun.publicDomain].join('|');
    default: {
      if (isCustomS3Id(service)) {
        const profileId = getCustomS3ProfileId(service);
        const profile = fd.custom_s3_profiles.find(p => p.id === profileId);
        if (profile) return [profile.endpoint, profile.accessKeyId, profile.secretAccessKey, profile.region, profile.bucket, profile.path, profile.publicDomain].join('|');
      }
      return '';
    }
  }
}

const activeEditorServiceSignature = computed(() => {
  const cfg = formData.value.editorServer;
  const fd = formData.value;
  const typoraSig = cfg.typoraService
    ? `typora:${cfg.typoraService}:${buildEditorCredentialSignature(cfg.typoraService, fd)}`
    : 'typora:none';
  const obsidianSig = cfg.obsidianService
    ? `obsidian:${cfg.obsidianService}:${buildEditorCredentialSignature(cfg.obsidianService, fd)}`
    : 'obsidian:none';
  return `${typoraSig}|${obsidianSig}`;
});

watch(activeEditorServiceSignature, () => {
  if (!isSettingsReady.value) return;
  const cfg = formData.value.editorServer;
  if (!cfg.typoraService && !cfg.obsidianService) return;
  if (!cfg.enabled && !cfg.typoraEnabled) return;
  debouncedApplyEditorServer();
});

async function applyEditorServer(
  cfg: EditorServerConfig,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const { force = false } = options;

  if (!Number.isInteger(cfg.port) || cfg.port < 1024 || cfg.port > 65535) {
    return false;
  }

  const obsidianPayload = buildObsidianApplyPayload(cfg);
  const cliConfigJson = buildServiceConfigJson(cfg.typoraService);
  const payloadKey = JSON.stringify({ obsidian: obsidianPayload, cli: cliConfigJson });

  if (!force && payloadKey === lastAppliedEditorPayloadKey.value) {
    return true;
  }

  try {
    await invoke('update_server_config', obsidianPayload);
    await invoke('save_cli_config', { serviceConfigJson: cliConfigJson });
    lastAppliedEditorPayloadKey.value = payloadKey;
    return true;
  } catch (e) {
    console.error('[Server] 更新失败:', e);
    toast.showConfig('error', { summary: '编辑器服务启动失败', detail: errorToString(e) });
    return false;
  }
}

function debouncedApplyEditorServer() {
  if (_debouncedEditorApplyTimer) clearTimeout(_debouncedEditorApplyTimer);
  _debouncedEditorApplyTimer = setTimeout(() => {
    _debouncedEditorApplyTimer = null;
    void applyEditorServer(formData.value.editorServer);
  }, 500);
}

function handleAnalyticsToggle() {
  if (formData.value.analyticsEnabled) {
    analytics.enable();
  } else {
    analytics.disable();
  }
  saveSettings();
}


async function handleAutoStartChange(enabled: boolean) {
  formData.value.appBehavior.autoStart = enabled;
  try {
    await invoke(enabled ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
  } catch (e) {
    console.error('[设置] 自启动设置失败:', e);
    toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(String(e)));
    formData.value.appBehavior.autoStart = !enabled;
  }
  saveSettings();
}

async function handleCloseToTrayChange(enabled: boolean) {
  formData.value.appBehavior.closeToTray = enabled;
  await invoke('set_close_to_tray', { enabled });
  saveSettings();
}



onMounted(async () => {
  // 首次挂载时也检查 tab 跳转指令（处理从未访问过设置页的情况）
  applyTargetTab();

  try {
    appVersion.value = await getVersion();
  } catch (error) {
    console.error('获取版本号失败:', error);
    appVersion.value = '未知版本';
  }

  executablePath.value = await invoke<string>('get_executable_path').catch(() => '');

  await loadSettings();

  // 启动时同步编辑器配置（包含 CLI 配置与 Server 运行态）
  await applyEditorServer(formData.value.editorServer, { force: true });

  const { listen } = await import('@tauri-apps/api/event');
  compressionSyncUnlisten.value = await listen('config-updated', async () => {
    // 仅同步压缩配置，避免覆盖用户正在编辑的其他字段
    const updated = await configStore.get<UserConfig>('config');
    if (updated?.imageCompression) {
      formData.value.imageCompression = { ...updated.imageCompression };
    }
  });

  cookieUnlisten.value = await configManager.setupCookieListener(async (sid, cookie) => {
    if (sid === 'weibo') formData.value.weiboCookie = cookie;
    else if (['nowcoder', 'zhihu', 'nami', 'bilibili', 'chaoxing'].includes(sid)) {
      (formData.value as any)[sid].cookie = cookie;
    }
    await saveSettings();
  });

  isSettingsReady.value = true;
});

onUnmounted(() => {
  cancelDebouncedSave();
  if (_debouncedEditorApplyTimer) {
    clearTimeout(_debouncedEditorApplyTimer);
    _debouncedEditorApplyTimer = null;
  }
  // 同步保存：不用 void，而是让调用链完成（Tauri 在窗口关闭前会等待同步代码）
  saveSettings().catch(() => {});

  if (cookieUnlisten.value) {
    cookieUnlisten.value();
    cookieUnlisten.value = null;
  }

  if (compressionSyncUnlisten.value) {
    compressionSyncUnlisten.value();
    compressionSyncUnlisten.value = null;
  }
});
</script>

<template>
  <div class="settings-layout">
    <div class="settings-sidebar">
      <div class="sidebar-title">设置</div>
      <nav class="nav-list">
        <div v-for="(group, idx) in navGroups" :key="idx" class="nav-group">
          <div v-if="group.label" class="nav-group-label">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="item.id"
            class="nav-item"
            :class="{ active: activeTab === item.id }"
            @click="activeTab = item.id"
          >
            <i :class="item.icon" class="nav-icon"></i>
            <span>{{ item.label }}</span>
          </button>
        </div>
      </nav>

      <div class="sidebar-footer">
        <span class="version-text">PicNexus v{{ appVersion }}</span>
      </div>
    </div>

    <div class="settings-content">
      <!-- 常规设置 -->
      <div v-if="activeTab === 'general'" class="settings-section">
        <GeneralSettingsPanel
          :current-theme="currentTheme"
          :auto-start="formData.appBehavior.autoStart"
          :minimize-to-tray-on-start="formData.appBehavior.minimizeToTrayOnStart"
          :close-to-tray="formData.appBehavior.closeToTray"
          :analytics-enabled="formData.analyticsEnabled"
          :is-clearing-cache="isClearingCache"
          :link-default-format="formData.linkOutput.defaultFormat"
          :link-custom-template="formData.linkOutput.customTemplate"
          :link-auto-copy="formData.linkOutput.autoCopy"
          :global-shortcut-enabled="formData.globalShortcut.enabled"
          :shortcut-upload-clipboard="formData.globalShortcut.uploadClipboard"
          :shortcut-upload-from-file="formData.globalShortcut.uploadFromFile"
          @update:current-theme="handleThemeChange"
          @update:auto-start="handleAutoStartChange"
          @update:minimize-to-tray-on-start="(v) => { formData.appBehavior.minimizeToTrayOnStart = v; debouncedSaveSettings(); }"
          @update:close-to-tray="handleCloseToTrayChange"
          @update:analytics-enabled="(v) => { formData.analyticsEnabled = v; handleAnalyticsToggle(); }"
          @update:link-default-format="(v) => { formData.linkOutput.defaultFormat = v; }"
          @update:link-custom-template="(v) => { formData.linkOutput.customTemplate = v; }"
          @update:link-auto-copy="(v) => { formData.linkOutput.autoCopy = v; }"
          @update:global-shortcut-enabled="(v: boolean) => { formData.globalShortcut.enabled = v; }"
          @update:shortcut-upload-clipboard="(v: string) => { formData.globalShortcut.uploadClipboard = v; }"
          @update:shortcut-upload-from-file="(v: string) => { formData.globalShortcut.uploadFromFile = v; }"
          @clear-history="handleClearHistory"
          @clear-cache="handleClearAppCache"
          @save="debouncedSaveSettings"
        />
      </div>

      <!-- 高级设置 -->
      <div v-if="activeTab === 'advanced'" class="settings-section">
        <AdvancedSettingsPanel
          :image-compression="formData.imageCompression"
          :editor-server="formData.editorServer"
          :executable-path="executablePath"
          @update:image-compression="(v: ImageCompressionConfig) => { formData.imageCompression = v; debouncedSaveSettingsWithStatus(); }"
          @update:editor-server="async (v: EditorServerConfig) => { formData.editorServer = v; await applyEditorServer(v); debouncedSaveSettingsWithStatus(); }"
          @navigate-hosting="activeTab = 'hosting'"
          @save="debouncedSaveSettingsWithStatus"
        />
      </div>

      <!-- 图床设置 -->
      <div v-if="activeTab === 'hosting'" class="settings-section">
        <HostingSettingsPanel
          :private-form-data="{
            r2: formData.r2,
            tencent: formData.tencent,
            aliyun: formData.aliyun,
            qiniu: formData.qiniu,
            upyun: formData.upyun,
          }"
          :custom-s3-profiles="formData.custom_s3_profiles"
          :cookie-form-data="{
            weibo: { cookie: formData.weiboCookie },
            zhihu: formData.zhihu,
            nowcoder: formData.nowcoder,
            nami: formData.nami,
            bilibili: formData.bilibili,
            chaoxing: formData.chaoxing
          }"
          :token-form-data="{
            smms: formData.smms,
            github: formData.github,
            imgur: formData.imgur
          }"
          :testing-connections="testingConnections"
          :jd-available="jdAvailable"
          :qiyu-available="qiyuAvailable"
          :is-checking-jd="isCheckingJd"
          :is-checking-qiyu="isCheckingQiyu"
          :link-prefix-enabled="formData.linkPrefixEnabled"
          :prefix-list="formData.linkPrefixList"
          :selected-prefix-index="formData.selectedPrefixIndex"
          :github-cdn-config="formData.github.cdnConfig"
          :target-card-id="targetCardId"
          :is-batch-testing="isBatchTesting"
          :batch-test-progress="batchTestProgress"
          :batch-test-completion-key="batchTestCompletionKey"
          :service-names="serviceNames"
          :available-services="availableServices"
          :service-config-status="serviceConfigStatus"
          @update:available-services="(v) => { availableServices = v; debouncedSaveSettings(); }"
          @card-navigated="targetCardId = null"
          @test-all="testAllConfiguredServices"
          @cancel-batch-test="batchTestAborted = true"
          @scroll-to-service="scrollToService"
          @save="debouncedSaveSettings"
          @test-private="handleServiceTest"
          @test-token="handleServiceTest"
          @test-cookie="handleServiceTest"
          @check-builtin="handleBuiltinCheck"
          @login-cookie="handleCookieLogin"
          @update:link-prefix-enabled="(v) => { formData.linkPrefixEnabled = v; debouncedSaveSettings(); }"
          @update:prefix-list="(v) => { formData.linkPrefixList = v; }"
          @update:selected-prefix-index="(v) => { formData.selectedPrefixIndex = v; debouncedSaveSettings(); }"
          @update:github-cdn-config="(v) => { formData.github.cdnConfig = v; }"
          @add-prefix="addPrefix"
          @remove-prefix="removePrefix"
          @reset-to-default="resetToDefaultPrefixes"
          @add-custom-s3="addCustomS3Profile"
          @delete-custom-s3="deleteCustomS3Profile"
          @update-custom-s3="updateCustomS3Profile"
        />
      </div>

      <!-- 备份与同步 -->
      <div v-if="activeTab === 'backup'" class="settings-section">
        <BackupSyncPanel
          :webdav-config="formData.webdav"
          @update:webdav-config="(v) => { formData.webdav = v; debouncedSaveSettings(); }"
          @save="debouncedSaveSettings"
          @add-web-d-a-v-profile="addWebDAVProfile"
          @delete-web-d-a-v-profile="deleteWebDAVProfile"
          @switch-web-d-a-v-profile="switchWebDAVProfile"
        />
      </div>

      <!-- 关于与更新 -->
      <div v-if="activeTab === 'about'" class="settings-section">
        <AboutUpdatePanel
          :app-version="appVersion"
          :auto-update-enabled="formData.autoUpdateEnabled"
          @update:auto-update-enabled="(v) => { formData.autoUpdateEnabled = v; debouncedSaveSettings(); }"
          @reopen-onboarding="reopenOnboarding"
          @save="debouncedSaveSettings"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 布局容器 */
.settings-layout {
  display: flex;
  height: 100%;
  background-color: var(--bg-app);
  overflow: hidden;
}

/* === 侧边栏导航 === */
.settings-sidebar {
  width: 200px;
  background-color: var(--bg-sidebar-settings);
  border-right: 1px solid var(--border-subtle-light);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-title {
  height: 45px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle-light);
}

.nav-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-group + .nav-group {
  margin-top: 24px;
}

.nav-group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 12px 8px;
  user-select: none;
  cursor: default;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
  text-align: left;
  width: 100%;
}

.nav-item .nav-icon {
  font-size: 16px;
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.nav-item:hover {
  background-color: var(--hover-overlay-subtle);
  color: var(--text-primary);
}

.nav-item.active {
  background-color: var(--primary-alpha-12);
  color: var(--primary);
  font-weight: 600;
}

.nav-item.active .nav-icon {
  color: var(--primary);
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-subtle-light);
  text-align: center;
}

.version-text {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  opacity: 0.6;
}

/* === 内容区域 === */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px 48px;
}

.settings-section {
  max-width: 800px;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
