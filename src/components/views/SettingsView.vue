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
import { SERVICE_DISPLAY_NAMES } from '../../constants/serviceNames';
import { SERVICE_REQUIRED_FIELDS } from '../../constants/serviceRequiredFields';
import { NO_CONFIG_SERVICES } from '../../constants/serviceRequiredFields';
import type { BatchTestProgress, BatchTestReport } from '../../types/batchTest';

// 组件
import HostingSettingsPanel from '../settings/HostingSettingsPanel.vue';
import GeneralSettingsPanel from '../settings/GeneralSettingsPanel.vue';
import BackupSyncPanel from '../settings/BackupSyncPanel.vue';

import { Store } from '../../store';
import type { ThemeMode, UserConfig, ServiceType, WebDAVProfile, GithubUrlStrategy } from '../../config/types';
import { DEFAULT_CONFIG, DEFAULT_PREFIXES } from '../../config/types';

// ==================== Composables ====================

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
  checkAllAvailabilityWithCooldown
} = useServiceAvailability();

const serviceHealth = useServiceHealth();

// ==================== 存储实例 ====================

const configStore = new Store('.settings.dat');

// ==================== 状态 ====================

const cookieUnlisten = ref<UnlistenFn | null>(null);
const appVersion = ref<string>('');
const isClearingCache = ref(false);

// 导航状态
type SettingsTab = 'general' | 'hosting' | 'backup';
const activeTab = ref<SettingsTab>('general');

// 接收来自 MainLayout 的 tab 跳转指令（不提供 fallback，确保拿到 provide 的同一个 ref）
const settingsTargetTab = inject<import('vue').Ref<string | null>>('settingsTargetTab');

const applyTargetTab = () => {
  if (settingsTargetTab?.value) {
    const validTabs: SettingsTab[] = ['general', 'hosting', 'backup'];
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
      { id: 'backup', label: '备份与同步', icon: 'pi pi-database' },
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
  nowcoder: { cookie: '' },
  zhihu: { cookie: '' },
  nami: { cookie: '', authToken: '' },
  bilibili: { cookie: '' },
  chaoxing: { cookie: '' },
  smms: { token: '' },
  github: { token: '', owner: '', repo: '', branch: 'main', path: 'images/' } as { token: string; owner: string; repo: string; branch: string; path: string; urlStrategy?: GithubUrlStrategy },
  imgur: { clientId: '', clientSecret: '' },
  webdav: { profiles: [] as WebDAVProfile[], activeId: null as string | null },
  linkPrefixEnabled: true,
  selectedPrefixIndex: 0,
  linkPrefixList: [...DEFAULT_PREFIXES],
  analyticsEnabled: true,
  appBehavior: { autoStart: false, minimizeToTrayOnStart: false },
  linkOutput: {
    defaultFormat: 'url' as import('../../utils/linkFormatter').LinkFormat,
    customTemplate: '{url}',
    autoCopy: true,
  }
});

// 测试连接状态
const testingConnections = ref<Record<string, boolean>>({
  weibo: false, r2: false, tencent: false, aliyun: false, qiniu: false, upyun: false,
  nowcoder: false, zhihu: false, nami: false, bilibili: false, chaoxing: false,
  smms: false, github: false, imgur: false, webdav: false
});

// 批量测试状态
const isBatchTesting = ref(false);
const batchTestProgress = ref<BatchTestProgress | null>(null);
const batchTestReport = ref<BatchTestReport | null>(null);

// 可用服务列表
const availableServices = ref<ServiceType[]>([]);

// 图床设置跳转：目标卡片 ID
const targetCardId = ref<string | null>(null);

// 图床名称映射（基于常量，覆盖部分显示名称以适应 UI）
const serviceNames: Record<ServiceType, string> = {
  ...SERVICE_DISPLAY_NAMES,
  r2: 'R2',  // 设置界面使用简短名称
};

// ==================== 计算属性 ====================

const serviceConfigStatus = computed<Record<ServiceType, boolean>>(() => {
  const fd = formData.value;
  return {
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
});

const activeWebDAVProfile = computed(() => {
  return formData.value.webdav.profiles.find(p => p.id === formData.value.webdav.activeId) || null;
});

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
  if (changed) saveSettings();
});

// ==================== 配置加载/保存 ====================

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
    formData.value.appBehavior = config.appBehavior ?? { autoStart: false, minimizeToTrayOnStart: false };
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

async function saveSettings() {
  try {
    const config = await configStore.get<UserConfig>('config') || { ...DEFAULT_CONFIG };

    config.services = {
      ...config.services,
      weibo: { enabled: true, cookie: formData.value.weiboCookie },
      r2: { enabled: true, ...formData.value.r2 },
      tencent: { enabled: true, ...formData.value.tencent },
      aliyun: { enabled: true, ...formData.value.aliyun },
      qiniu: { enabled: true, ...formData.value.qiniu },
      upyun: { enabled: true, ...formData.value.upyun },
      nowcoder: { enabled: true, ...formData.value.nowcoder },
      zhihu: { enabled: true, ...formData.value.zhihu },
      bilibili: { enabled: true, ...formData.value.bilibili },
      chaoxing: { enabled: true, ...formData.value.chaoxing },
      smms: { enabled: true, ...formData.value.smms },
      github: { enabled: true, ...formData.value.github },
      imgur: { enabled: true, ...formData.value.imgur },
    };

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
      prefixList: formData.value.linkPrefixList
    };

    config.linkOutput = formData.value.linkOutput;
    config.analytics = { enabled: formData.value.analyticsEnabled };
    config.appBehavior = formData.value.appBehavior;
    config.availableServices = availableServices.value;

    await configManager.saveConfig(config, true);
    serviceHealth.evaluateConfig(config);
  } catch (e) {
    console.error('[设置] 保存失败:', e);
    toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(String(e)));
  }
}

// ==================== 主题处理 ====================

async function handleThemeChange(mode: ThemeMode) {
  try {
    await setTheme(mode);
    // 主题切换本身就是视觉反馈，无需 toast 通知
  } catch (e) {
    toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(String(e)));
  }
}

// ==================== 测试连接 ====================

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

async function testS3Connection(serviceId: ServiceType) {
  const config = formData.value[serviceId as keyof typeof formData.value] as any;
  const validationError = validateS3Config(serviceId, config);
  if (validationError) {
    toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed(serviceNames[serviceId], validationError));
    throw new Error(validationError);
  }
  try {
    await invoke('test_s3_connection', { serviceId, config });
    toast.showConfig('success', TOAST_MESSAGES.auth.configValid(serviceNames[serviceId]));
  } catch (error) {
    const msg = errorToString(error);
    toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed(serviceNames[serviceId], msg));
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
};

async function handleServiceTest(serviceId: string) {
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

async function testAllConfiguredServices() {
  const configuredServices = (Object.entries(serviceHealth.healthStatusMap.value) as [ServiceType, string][])
    .filter(([id, status]) => status !== 'unconfigured' && !NO_CONFIG_SERVICES.includes(id) && actions[id])
    .map(([id]) => id);

  if (configuredServices.length === 0) {
    toast.showConfig('info', { summary: '没有已配置的图床需要测试' });
    return;
  }

  isBatchTesting.value = true;
  batchTestReport.value = null;
  batchTestProgress.value = { current: 0, total: configuredServices.length, currentService: '' };
  suppressToasts(true);

  const failed: BatchTestReport['failed'] = [];
  let passed = 0;
  let completed = 0;

  try {
    const tasks = configuredServices.map((serviceId) => async () => {
      batchTestProgress.value = { current: completed + 1, total: configuredServices.length, currentService: serviceNames[serviceId] };
      testingConnections.value[serviceId] = true;
      try {
        await actions[serviceId]();
        serviceHealth.markVerified(serviceId);
        passed++;
      } catch (e) {
        const msg = errorToString(e);
        serviceHealth.markTestFailed(serviceId, msg);
        failed.push({ serviceId, name: serviceNames[serviceId], error: msg });
      } finally {
        testingConnections.value[serviceId] = false;
        completed++;
        batchTestProgress.value = { current: completed, total: configuredServices.length, currentService: '' };
      }
    });

    // 有限并发执行（max 3）
    let nextIndex = 0;
    async function runNext(): Promise<void> {
      while (nextIndex < tasks.length) {
        const task = tasks[nextIndex++];
        await task();
      }
    }
    const concurrency = Math.min(3, tasks.length);
    await Promise.all(Array.from({ length: concurrency }, () => runNext()));
  } finally {
    suppressToasts(false);
    batchTestReport.value = { total: configuredServices.length, passed, failed, completedAt: Date.now() };
    isBatchTesting.value = false;
    batchTestProgress.value = null;
  }
}

async function handleCookieLogin(serviceId: string) {
  await configManager.openCookieWebView(serviceId as ServiceType);
}

// ==================== 链接前缀管理 ====================

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

// ==================== WebDAV 配置管理 ====================

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

async function testActiveWebDAV() {
  const profile = activeWebDAVProfile.value;
  if (!profile) return;
  testingConnections.value.webdav = true;
  try {
    const result = await invoke<string>('test_webdav_connection', {
      config: {
        url: profile.url,
        username: profile.username,
        password: profile.password,
        remotePath: profile.remotePath || '/PicNexus/'
      }
    });
    // 更新连接状态为成功
    updateWebDAVProfileStatus(profile.id, 'success', undefined);
    toast.showConfig('success', result || TOAST_MESSAGES.auth.success('WebDAV'));
  } catch (e) {
    // 更新连接状态为失败，并记录错误信息
    const errorMsg = String(e);
    updateWebDAVProfileStatus(profile.id, 'failed', errorMsg);
    toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed('WebDAV', errorMsg));
  } finally {
    testingConnections.value.webdav = false;
  }
}

function updateWebDAVProfileStatus(profileId: string, status: 'pending' | 'success' | 'failed', error?: string) {
  const profiles = formData.value.webdav.profiles.map(p => {
    if (p.id === profileId) {
      return {
        ...p,
        connectionStatus: status,
        lastTestedAt: status !== 'pending' ? Date.now() : p.lastTestedAt,
        lastError: error
      };
    }
    return p;
  });
  formData.value.webdav.profiles = profiles;
  saveSettings();
}

// ==================== 其他处理函数 ====================

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

function handleAnalyticsToggle() {
  if (formData.value.analyticsEnabled) {
    analytics.enable();
  } else {
    analytics.disable();
  }
  saveSettings();
}

// ==================== 自启动控制 ====================

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

// ==================== 图床跳转 ====================

function handleNavigateToHosting(serviceId: ServiceType) {
  targetCardId.value = serviceId;
  activeTab.value = 'hosting';
}

// ==================== 生命周期 ====================

onMounted(async () => {
  // 首次挂载时也检查 tab 跳转指令（处理从未访问过设置页的情况）
  applyTargetTab();

  try {
    appVersion.value = await getVersion();
  } catch (error) {
    console.error('获取版本号失败:', error);
    appVersion.value = '未知版本';
  }

  await loadSettings();
  await checkAllAvailabilityWithCooldown();

  cookieUnlisten.value = await configManager.setupCookieListener(async (sid, cookie) => {
    if (sid === 'weibo') formData.value.weiboCookie = cookie;
    else if (['nowcoder', 'zhihu', 'nami', 'bilibili', 'chaoxing'].includes(sid)) {
      (formData.value as any)[sid].cookie = cookie;
    }
    await saveSettings();
  });
});

onUnmounted(() => {
  if (cookieUnlisten.value) {
    cookieUnlisten.value();
    cookieUnlisten.value = null;
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
          :available-services="availableServices"
          :service-names="serviceNames"
          :service-config-status="serviceConfigStatus"
          :auto-start="formData.appBehavior.autoStart"
          :minimize-to-tray-on-start="formData.appBehavior.minimizeToTrayOnStart"
          :analytics-enabled="formData.analyticsEnabled"
          :is-clearing-cache="isClearingCache"
          :link-default-format="formData.linkOutput.defaultFormat"
          :link-custom-template="formData.linkOutput.customTemplate"
          :link-auto-copy="formData.linkOutput.autoCopy"
          @update:current-theme="handleThemeChange"
          @update:available-services="(v) => { availableServices = v; saveSettings(); }"
          @update:auto-start="handleAutoStartChange"
          @update:minimize-to-tray-on-start="(v) => { formData.appBehavior.minimizeToTrayOnStart = v; saveSettings(); }"
          @update:analytics-enabled="(v) => { formData.analyticsEnabled = v; handleAnalyticsToggle(); }"
          @update:link-default-format="(v) => { formData.linkOutput.defaultFormat = v; }"
          @update:link-custom-template="(v) => { formData.linkOutput.customTemplate = v; }"
          @update:link-auto-copy="(v) => { formData.linkOutput.autoCopy = v; }"
          @navigate-to-hosting="handleNavigateToHosting"
          @clear-history="handleClearHistory"
          @clear-cache="handleClearAppCache"
          @save="saveSettings"
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
            upyun: formData.upyun
          }"
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
          :github-url-strategy="formData.github.urlStrategy"
          :target-card-id="targetCardId"
          :is-batch-testing="isBatchTesting"
          :batch-test-progress="batchTestProgress"
          :batch-test-report="batchTestReport"
          @card-navigated="targetCardId = null"
          @test-all="testAllConfiguredServices"
          @save="saveSettings"
          @test-private="handleServiceTest"
          @test-token="handleServiceTest"
          @test-cookie="handleServiceTest"
          @check-builtin="handleBuiltinCheck"
          @login-cookie="handleCookieLogin"
          @update:link-prefix-enabled="(v) => { formData.linkPrefixEnabled = v; saveSettings(); }"
          @update:prefix-list="(v) => { formData.linkPrefixList = v; }"
          @update:selected-prefix-index="(v) => { formData.selectedPrefixIndex = v; saveSettings(); }"
          @update:github-url-strategy="(v) => { formData.github.urlStrategy = v; }"
          @add-prefix="addPrefix"
          @remove-prefix="removePrefix"
          @reset-to-default="resetToDefaultPrefixes"
        />
      </div>

      <!-- 备份与同步 -->
      <div v-if="activeTab === 'backup'" class="settings-section">
        <BackupSyncPanel
          :webdav-config="formData.webdav"
          @update:webdav-config="(v) => { formData.webdav = v; saveSettings(); }"
          @save="saveSettings"
          @test-web-d-a-v="testActiveWebDAV"
          @add-web-d-a-v-profile="addWebDAVProfile"
          @delete-web-d-a-v-profile="deleteWebDAVProfile"
          @switch-web-d-a-v-profile="switchWebDAVProfile"
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
  background-color: rgba(59, 130, 246, 0.12);
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
