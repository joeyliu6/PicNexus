<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { getVersion } from '@tauri-apps/api/app';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Password from 'primevue/password';
import Checkbox from 'primevue/checkbox';
import RadioButton from 'primevue/radiobutton';
import ToggleSwitch from 'primevue/toggleswitch';
import Divider from 'primevue/divider';
import Tag from 'primevue/tag';
import Card from 'primevue/card';
import Message from 'primevue/message';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { useThemeManager } from '../../composables/useTheme';
import { useConfigManager } from '../../composables/useConfig';
import { useHistoryManager, invalidateCache } from '../../composables/useHistory';
import { useAnalytics } from '../../composables/useAnalytics';
import { useAutoSync, createDefaultAutoSyncConfig, type AutoSyncConfig } from '../../composables/useAutoSync';
import SyncConflictDialog from '../dialogs/SyncConflictDialog.vue';
import { Store } from '../../store';
import { WebDAVClient } from '../../utils/webdav';
import { historyDB } from '../../services/HistoryDatabase';
import { markdownRepairService, type RepairProgress, type DetectionResult } from '../../services/MarkdownRepairService';
import { clearAllCache as clearThumbnailCache } from '../../services/ThumbnailService';
import type { ThemeMode, UserConfig, ServiceType, HistoryItem, SyncStatus, WebDAVProfile, ServiceCheckStatus, MarkdownRepairOptions, MarkdownRepairResult, MarkdownDetectOptions, MarkdownExecuteOptions, ReplacementCandidate } from '../../config/types';
import { DEFAULT_CONFIG, DEFAULT_PREFIXES, PRIVATE_SERVICES, PUBLIC_SERVICES, migrateConfig, isValidUserConfig } from '../../config/types';

const toast = useToast();
const { confirm: confirmDialog, confirmThreeWay } = useConfirm();
const { currentTheme, setTheme } = useThemeManager();
const configManager = useConfigManager();
const historyManager = useHistoryManager();
const analytics = useAnalytics();

// 清空历史记录
const handleClearHistory = async () => {
  await historyManager.clearHistory();
};

// 【内存优化】清理应用缓存
const handleClearAppCache = async () => {
  isClearingCache.value = true;
  try {
    // 清理缩略图 IndexedDB 缓存
    await clearThumbnailCache();
    toast.success('缓存已清理', '应用缓存已成功清理，可能需要重新加载部分数据');
  } catch (error) {
    console.error('[设置] 清理缓存失败:', error);
    toast.error('清理失败', String(error));
  } finally {
    isClearingCache.value = false;
  }
};

// Cookie 监听器清理函数
const cookieUnlisten = ref<UnlistenFn | null>(null);

// 应用版本号
const appVersion = ref<string>('');

// 【内存优化】清理缓存状态
const isClearingCache = ref(false);

// --- 导航状态管理 ---
type SettingsTab = 'general' | 'r2' | 'builtin' | 'cookie_auth' | 'links' | 'md_repair' | 'backup';
const activeTab = ref<SettingsTab>('general');

const tabs = [
  { id: 'general', label: '常规设置', icon: 'pi pi-cog' },
  { type: 'separator' },
  { type: 'label', label: '私有图床' },
  { id: 'r2', label: 'Cloudflare R2', icon: 'pi pi-cloud' },
  { type: 'separator' },
  { type: 'label', label: '公共图床' },
  { id: 'builtin', label: '开箱即用', icon: 'pi pi-box' },
  { id: 'cookie_auth', label: 'Cookie 认证', icon: 'pi pi-key' },
  { type: 'separator' },
  { type: 'label', label: '高级' },
  { id: 'links', label: '链接前缀', icon: 'pi pi-link' },
  { id: 'md_repair', label: 'MD 图链修复', icon: 'pi pi-wrench' },
  { id: 'backup', label: '备份与同步', icon: 'pi pi-database' },
];

// --- 基础数据与逻辑 (复用原有逻辑) ---
// 主题
const themeOptions = [
  { label: '亮色模式', value: 'light', icon: 'pi pi-sun' },
  { label: '深色模式', value: 'dark', icon: 'pi pi-moon' }
];

const handleThemeChange = async (mode: ThemeMode) => {
  try {
    await setTheme(mode);
    toast.success('已切换', `当前主题：${mode === 'light' ? '亮色' : '深色'}`);
  } catch (e) { toast.error('失败', String(e)); }
};

// 表单数据
const formData = ref({
  weiboCookie: '',
  r2: { accountId: '', accessKeyId: '', secretAccessKey: '', bucketName: '', path: '', publicDomain: '' },
  nowcoder: { cookie: '' },
  zhihu: { cookie: '' },
  nami: { cookie: '' },
  webdav: { profiles: [] as Array<{ id: string; name: string; url: string; username: string; password: string; passwordEncrypted?: string; remotePath: string }>, activeId: null as string | null },
  linkPrefixEnabled: true,
  selectedPrefixIndex: 0,
  linkPrefixList: [...DEFAULT_PREFIXES],
  analyticsEnabled: true
});

// 服务列表
const availableServices = ref<ServiceType[]>(['weibo', 'r2', 'tcl', 'jd', 'nowcoder', 'qiyu', 'zhihu', 'nami']);
const serviceNames: Record<ServiceType, string> = {
  weibo: '微博', r2: 'R2', tcl: 'TCL', jd: '京东', nowcoder: '牛客', qiyu: '七鱼', zhihu: '知乎', nami: '纳米'
};

// 测试状态
const testingConnections = ref<Record<string, boolean>>({ weibo: false, r2: false, nowcoder: false, zhihu: false, nami: false, webdav: false });

// 七鱼可用性检测（完整检测：实际获取 Token）
const qiyuAvailable = ref(false);
const isCheckingQiyu = ref(false);

// 生成 7~12 天的随机毫秒数
function getRandomCheckInterval(): number {
  const minDays = 7;
  const maxDays = 12;
  const randomDays = Math.floor(Math.random() * (maxDays - minDays + 1)) + minDays;
  return randomDays * 24 * 60 * 60 * 1000;
}

// 判断是否需要检测七鱼
function shouldCheckQiyu(status: ServiceCheckStatus | undefined): boolean {
  // 从未检测过 → 需要检测
  if (!status || status.lastCheckTime === null) {
    return true;
  }
  // 上次不可用 → 需要检测
  if (!status.lastCheckResult) {
    return true;
  }
  // 上次可用，检查是否到达下次检测时间
  if (status.nextCheckTime && Date.now() >= status.nextCheckTime) {
    return true;
  }
  return false;
}

// 七鱼可用性检测（支持智能检测策略）
const checkQiyuAvailability = async (forceCheck = false) => {
  // 非强制检测时，先判断是否需要检测
  if (!forceCheck) {
    if (!shouldCheckQiyu(syncStatus.value.qiyuCheckStatus)) {
      // 不需要检测，使用缓存的结果
      qiyuAvailable.value = syncStatus.value.qiyuCheckStatus?.lastCheckResult ?? false;
      console.log('[七鱼检测] 使用缓存结果，跳过检测');
      return;
    }
  }

  isCheckingQiyu.value = true;
  try {
    qiyuAvailable.value = await invoke('check_qiyu_available');

    // 更新检测状态
    const now = Date.now();
    syncStatus.value.qiyuCheckStatus = {
      lastCheckTime: now,
      lastCheckResult: qiyuAvailable.value,
      nextCheckTime: qiyuAvailable.value ? now + getRandomCheckInterval() : null
    };
    await saveSyncStatus();

    console.log(`[七鱼检测] 检测完成，结果: ${qiyuAvailable.value ? '可用' : '不可用'}`);
  } catch (e) {
    qiyuAvailable.value = false;
    syncStatus.value.qiyuCheckStatus = {
      lastCheckTime: Date.now(),
      lastCheckResult: false,
      nextCheckTime: null
    };
    await saveSyncStatus();
  } finally {
    isCheckingQiyu.value = false;
  }
};

// 京东可用性检测
const jdAvailable = ref(false);
const isCheckingJd = ref(false);
const checkJdAvailable = async () => {
  isCheckingJd.value = true;
  try { jdAvailable.value = await invoke('check_jd_available'); }
  catch (e) { jdAvailable.value = false; }
  finally { isCheckingJd.value = false; }
};

// TCL 可用性检测
const tclAvailable = ref(false);
const isCheckingTcl = ref(false);
const checkTclAvailable = async () => {
  isCheckingTcl.value = true;
  try { tclAvailable.value = await invoke('check_tcl_available'); }
  catch (e) { tclAvailable.value = false; }
  finally { isCheckingTcl.value = false; }
};

// 可用性检测冷却机制（防止频繁切换页面导致过度检测，仅用于京东和 TCL）
const lastCheckTime = ref(0);
const CHECK_COOLDOWN = 5 * 60 * 1000; // 5 分钟冷却

const checkAllAvailabilityWithCooldown = async () => {
  const now = Date.now();
  const needCooldownCheck = now - lastCheckTime.value >= CHECK_COOLDOWN;

  // 七鱼使用智能检测策略（不受冷却机制影响）
  // 京东和 TCL 使用冷却机制
  await Promise.all([
    checkQiyuAvailability(false),  // 使用智能检测
    needCooldownCheck ? checkJdAvailable() : Promise.resolve(),
    needCooldownCheck ? checkTclAvailable() : Promise.resolve()
  ]);

  if (needCooldownCheck) {
    lastCheckTime.value = now;
  }
};

// 加载配置
const loadSettings = async () => {
  try {
    const cfg = await configManager.loadConfig();
    // 映射逻辑 (保持原有逻辑不变)
    formData.value.weiboCookie = cfg.services?.weibo?.cookie || '';

    // 修改点 1: R2 配置改为逐字段赋值，确保默认空字符串
    formData.value.r2 = {
      accountId: cfg.services?.r2?.accountId || '',
      accessKeyId: cfg.services?.r2?.accessKeyId || '',
      secretAccessKey: cfg.services?.r2?.secretAccessKey || '',
      bucketName: cfg.services?.r2?.bucketName || '',
      path: cfg.services?.r2?.path || '',
      publicDomain: cfg.services?.r2?.publicDomain || ''
    };

    formData.value.nowcoder.cookie = cfg.services?.nowcoder?.cookie || '';
    formData.value.zhihu.cookie = cfg.services?.zhihu?.cookie || '';
    formData.value.nami.cookie = cfg.services?.nami?.cookie || '';
    // 加载 WebDAV 配置（新结构）
    if (cfg.webdav) {
      const profiles = cfg.webdav.profiles || [];
      // 解密已保存的密码以便回显
      for (const profile of profiles) {
        if (profile.passwordEncrypted && !profile.password) {
          profile.password = await WebDAVClient.decryptPassword(profile.passwordEncrypted);
        }
      }
      formData.value.webdav.profiles = profiles;
      formData.value.webdav.activeId = cfg.webdav.activeId || null;
    }
    if (cfg.availableServices) availableServices.value = [...cfg.availableServices];
    if (cfg.linkPrefixConfig) {
      formData.value.linkPrefixEnabled = cfg.linkPrefixConfig.enabled;
      formData.value.selectedPrefixIndex = cfg.linkPrefixConfig.selectedIndex;
      formData.value.linkPrefixList = [...cfg.linkPrefixConfig.prefixList];
    }
    // 加载 Analytics 配置
    if (cfg.analytics) {
      formData.value.analyticsEnabled = cfg.analytics.enabled;
    }
  } catch (e) { console.error(e); }
};

// 自动保存
const saveSettings = async (silent = false) => {
  try {
    const currentConfig = configManager.config.value;

    // 处理 WebDAV 密码加密
    // 注意：需要深拷贝 profiles 数组，避免修改表单数据导致 UI 显示异常
    const webdavConfig = {
      ...formData.value.webdav,
      profiles: formData.value.webdav.profiles.map(p => ({ ...p }))
    };
    if (webdavConfig.profiles) {
      for (const profile of webdavConfig.profiles) {
        // 如果有明文密码，则加密存储
        if (profile.password && profile.password.trim()) {
          try {
            profile.passwordEncrypted = await WebDAVClient.encryptPassword(profile.password);
            // 保存时清除明文密码（仅在拷贝对象上操作，不影响 UI）
            profile.password = '';
          } catch (err) {
            console.error('[WebDAV] 密码加密失败:', err);
          }
        }
      }
    }

    const updatedConfig: UserConfig = {
      ...currentConfig,
      availableServices: [...availableServices.value],
      services: {
        ...currentConfig.services,
        weibo: { enabled: currentConfig.services?.weibo?.enabled ?? false, cookie: formData.value.weiboCookie.trim() },
        r2: { ...currentConfig.services?.r2, ...formData.value.r2, enabled: currentConfig.services?.r2?.enabled ?? false },
        nowcoder: { enabled: currentConfig.services?.nowcoder?.enabled ?? false, cookie: formData.value.nowcoder.cookie.trim() },
        zhihu: { enabled: currentConfig.services?.zhihu?.enabled ?? false, cookie: formData.value.zhihu.cookie.trim() },
        nami: { enabled: currentConfig.services?.nami?.enabled ?? false, cookie: formData.value.nami.cookie.trim(), authToken: '' }
      },
      webdav: webdavConfig,
      linkPrefixConfig: {
        enabled: formData.value.linkPrefixEnabled,
        selectedIndex: formData.value.selectedPrefixIndex,
        prefixList: formData.value.linkPrefixList.filter(p => p.trim() !== '')
      },
      analytics: {
        enabled: formData.value.analyticsEnabled
      }
    };
    // 特殊处理 Nami AuthToken
    const tokenMatch = updatedConfig.services?.nami?.cookie?.match(/Auth-Token=([^;]+)/);
    if (tokenMatch && updatedConfig.services?.nami) updatedConfig.services.nami.authToken = tokenMatch[1];

    await configManager.saveConfig(updatedConfig, silent);
  } catch (e) { console.error(e); }
};

// 测试连接 Wrapper
const testConn = async (key: string, fn: () => Promise<any>) => {
  testingConnections.value[key] = true;
  try {
    const res = await fn();
    res.success ? toast.success('成功', res.message) : toast.error('失败', res.message);
  } finally { testingConnections.value[key] = false; }
};

// 具体测试方法
const actions = {
  weibo: () => testConn('weibo', () => configManager.testWeiboConnection(formData.value.weiboCookie)),
  r2: () => testConn('r2', () => configManager.testR2Connection(formData.value.r2)),
  nowcoder: () => testConn('nowcoder', () => configManager.testNowcoderConnection(formData.value.nowcoder.cookie)),
  zhihu: () => testConn('zhihu', () => configManager.testZhihuConnection(formData.value.zhihu.cookie)),
  nami: () => testConn('nami', () => configManager.testNamiConnection(formData.value.nami.cookie)),
  webdav: () => testConn('webdav', () => configManager.testWebDAVConnection(formData.value.webdav)),
  login: (svc: ServiceType) => configManager.openCookieWebView(svc)
};

// Analytics 开关切换
const handleAnalyticsToggle = async () => {
  if (formData.value.analyticsEnabled) {
    await analytics.enable();
  } else {
    await analytics.disable();
  }
};

// 前缀管理
const addPrefix = () => { formData.value.linkPrefixList.push(''); formData.value.selectedPrefixIndex = formData.value.linkPrefixList.length - 1; };
const removePrefix = (idx: number) => {
  if (formData.value.linkPrefixList.length <= 1) return;
  formData.value.linkPrefixList.splice(idx, 1);
  if (formData.value.selectedPrefixIndex >= formData.value.linkPrefixList.length) formData.value.selectedPrefixIndex = 0;
  saveSettings();
};

// 修改点 2: 添加恢复默认前缀功能
const resetToDefaultPrefixes = () => {
  formData.value.linkPrefixList = [...DEFAULT_PREFIXES];
  formData.value.selectedPrefixIndex = 0;
  saveSettings();
  toast.success('已恢复', '前缀列表已恢复为默认值');
};

// ========== 备份与同步功能 ==========
// 存储实例
const configStore = new Store('.settings.dat');
const syncStatusStore = new Store('.sync-status.dat');

// 同步状态（持久化）
const syncStatus = ref<SyncStatus>({
  configLastSync: null,
  configSyncResult: null,
  configSyncError: undefined,
  historyLastSync: null,
  historySyncResult: null,
  historySyncError: undefined,
});

// 加载同步状态
async function loadSyncStatus() {
  try {
    const saved = await syncStatusStore.get<SyncStatus>('status');
    if (saved) {
      syncStatus.value = saved;
    }
  } catch (e) {
    console.error('[备份] 加载同步状态失败:', e);
  }
}

// 保存同步状态
async function saveSyncStatus() {
  try {
    await syncStatusStore.set('status', syncStatus.value);
    await syncStatusStore.save();
  } catch (e) {
    console.error('[备份] 保存同步状态失败:', e);
  }
}

// 获取当前时间的完整格式字符串
function getFullTimestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

// 更新配置同步状态
function updateConfigSyncStatus(result: 'success' | 'failed', error?: string) {
  syncStatus.value.configLastSync = getFullTimestamp();
  syncStatus.value.configSyncResult = result;
  syncStatus.value.configSyncError = error;
  saveSyncStatus();
}

// 更新历史记录同步状态
function updateHistorySyncStatus(result: 'success' | 'failed', error?: string) {
  syncStatus.value.historyLastSync = getFullTimestamp();
  syncStatus.value.historySyncResult = result;
  syncStatus.value.historySyncError = error;
  saveSyncStatus();
}

// 提取错误码（用于显示具体错误信息）
function extractErrorCode(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);

  // 尝试提取 HTTP 状态码
  const httpMatch = msg.match(/(\d{3})/);
  if (httpMatch) {
    const code = httpMatch[1];
    const statusTexts: Record<string, string> = {
      '401': 'HTTP 401: 认证失败',
      '403': 'HTTP 403: 访问被拒绝',
      '404': 'HTTP 404: 文件不存在',
      '500': 'HTTP 500: 服务器错误',
      '507': 'HTTP 507: 存储空间不足',
    };
    return statusTexts[code] || `HTTP ${code}`;
  }

  // 网络错误
  if (msg.includes('ECONNREFUSED')) return 'ECONNREFUSED: 连接被拒绝';
  if (msg.includes('ETIMEDOUT')) return 'ETIMEDOUT: 连接超时';
  if (msg.includes('ENOTFOUND')) return 'ENOTFOUND: 域名解析失败';
  if (msg.includes('fetch')) return '网络错误: 无法连接服务器';

  // 返回原始消息（截断）
  return msg.length > 50 ? msg.substring(0, 50) + '...' : msg;
}

// ========== 多 WebDAV 配置管理 ==========
// 当前选中的 WebDAV 配置
const activeWebDAVProfile = computed(() => {
  const config = formData.value.webdav;
  if (!config.profiles.length || !config.activeId) return null;
  return config.profiles.find(p => p.id === config.activeId) || null;
});

// 生成唯一 ID
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// 添加新 WebDAV 配置
function addWebDAVProfile() {
  const newProfile: WebDAVProfile = {
    id: generateId(),
    name: `配置 ${formData.value.webdav.profiles.length + 1}`,
    url: '',
    username: '',
    password: '',
    remotePath: '/PicNexus/',
  };
  formData.value.webdav.profiles.push(newProfile);
  formData.value.webdav.activeId = newProfile.id;
  saveSettings();
}

// 删除 WebDAV 配置
function deleteWebDAVProfile(id: string) {
  const index = formData.value.webdav.profiles.findIndex(p => p.id === id);
  if (index > -1) {
    formData.value.webdav.profiles.splice(index, 1);
    // 如果删除的是当前选中的，切换到第一个或置空
    if (formData.value.webdav.activeId === id) {
      formData.value.webdav.activeId = formData.value.webdav.profiles[0]?.id || null;
    }
    saveSettings();
    toast.success('已删除 WebDAV 配置');
  }
}

// 切换 WebDAV 配置
function switchWebDAVProfile(id: string) {
  formData.value.webdav.activeId = id;
  // 静默保存，仅切换配置不需要提示
  saveSettings(true);
}

// 测试当前选中的 WebDAV 连接
async function testActiveWebDAV() {
  const profile = activeWebDAVProfile.value;
  if (!profile) {
    toast.warn('请先选择一个 WebDAV 配置');
    return;
  }

  testingConnections.value.webdav = true;
  try {
    const res = await configManager.testWebDAVConnection({
      url: profile.url,
      username: profile.username,
      password: profile.password,
      remotePath: profile.remotePath,
    } as any);
    res.success ? toast.success('连接成功', res.message) : toast.error('连接失败', res.message);
  } catch (e) {
    toast.error('测试失败', String(e));
  } finally {
    testingConnections.value.webdav = false;
  }
}

// 按钮加载状态
const exportSettingsLoading = ref(false);
const importSettingsLoading = ref(false);
const uploadSettingsLoading = ref(false);
const downloadSettingsLoading = ref(false);
const exportHistoryLoading = ref(false);
const importHistoryLoading = ref(false);
const uploadHistoryLoading = ref(false);
const downloadHistoryLoading = ref(false);

// ========== 自动同步功能 ==========
// 自动同步配置
const autoSyncConfig = ref<AutoSyncConfig>(createDefaultAutoSyncConfig());

// 初始化自动同步 composable
const {
  isEnabled: isAutoSyncEnabled,
  lastAutoSync,
  nextAutoSync,
  lastResult: autoSyncLastResult,
  isSyncing: isAutoSyncing,
  remainingTimeFormatted,
  start: startAutoSync,
  stop: stopAutoSync,
  syncNow: syncNowAuto,
  updateInterval: updateAutoSyncInterval
} = useAutoSync(
  () => activeWebDAVProfile.value,
  {
    interval: autoSyncConfig.value.intervalHours * 60 * 60 * 1000,
    syncOnMount: false,
    syncSettings: true,
    syncHistory: true
  }
);

// 自动同步开关变化处理
function handleAutoSyncToggle(enabled: boolean) {
  autoSyncConfig.value.enabled = enabled;
  if (enabled) {
    startAutoSync();
    toast.success('自动同步已启用', `每 ${autoSyncConfig.value.intervalHours} 小时同步一次`);
  } else {
    stopAutoSync();
    toast.info('自动同步已关闭');
  }
  saveAutoSyncConfig();
}

// 自动同步间隔变化处理
function handleAutoSyncIntervalChange(hours: number) {
  const validHours = Math.max(1, Math.min(720, hours));
  autoSyncConfig.value.intervalHours = validHours;
  updateAutoSyncInterval(validHours);
  saveAutoSyncConfig();
}

// 保存自动同步配置
async function saveAutoSyncConfig() {
  try {
    const config = await configStore.get<UserConfig>('config');
    if (config) {
      config.autoSync = autoSyncConfig.value;
      await configStore.set('config', config);
      await configStore.save();
    }
  } catch (e) {
    console.error('[自动同步] 保存配置失败:', e);
  }
}

// 加载自动同步配置
async function loadAutoSyncConfig() {
  try {
    const config = await configStore.get<UserConfig>('config');
    if (config?.autoSync) {
      autoSyncConfig.value = config.autoSync;
      // 如果之前启用了自动同步，则自动恢复
      if (autoSyncConfig.value.enabled && activeWebDAVProfile.value) {
        startAutoSync();
      }
    }
  } catch (e) {
    console.error('[自动同步] 加载配置失败:', e);
  }
}

// 立即同步 - 同步全部（配置 + 历史记录）
async function syncNowAll() {
  syncNowMenuVisible.value = false;
  await syncNowAuto();
}

// 立即同步 - 仅同步配置
async function syncNowSettingsOnly() {
  syncNowMenuVisible.value = false;
  if (!activeWebDAVProfile.value) {
    toast.error('请先配置 WebDAV 连接');
    return;
  }
  await uploadSettingsCloud();
}

// 立即同步 - 仅同步历史记录
async function syncNowHistoryOnly() {
  syncNowMenuVisible.value = false;
  if (!activeWebDAVProfile.value) {
    toast.error('请先配置 WebDAV 连接');
    return;
  }
  await uploadHistoryMerge();
}

// ========== Markdown 修复功能 ==========
// 工作流程阶段
type RepairPhase = 'idle' | 'detecting' | 'result' | 'executing';
const mdRepairPhase = ref<RepairPhase>('idle');
const mdRepairProgress = ref<RepairProgress | null>(null);

// 检测选项
const mdDetectOptions = ref<MarkdownDetectOptions>({
  directoryPath: '',
  includeSubdirs: true
});

// 检测结果
const mdDetectionResult = ref<DetectionResult | null>(null);

// 执行选项
const mdSelectedReplacements = ref<Map<string, string>>(new Map()); // 原始URL -> 替换URL
const mdSelectedForReupload = ref<Set<string>>(new Set()); // 需要重新上传的URL
const mdSelectedForBackup = ref<Set<string>>(new Set()); // 需要增加冗余的URL
const mdRepairTargetServices = ref<ServiceType[]>([]); // 修复用目标图床（用于组合操作）
const mdBackupTargetServices = ref<ServiceType[]>([]); // 备份用目标图床（用于 C 类冗余备份）
const mdBackupEnabled = ref(true);
const mdCleanOldBackups = ref(false);

// 已存在的备份
const mdExistingBackups = ref<string[]>([]);

// 折叠状态（默认折叠）
const mdReplaceableSectionExpanded = ref(false);
const mdNeedReuploadSectionExpanded = ref(false);
const mdCanBackupSectionExpanded = ref(false);

// C 类分页状态
const mdCanBackupPage = ref(1);
const mdCanBackupPageSize = 20;

// C 类分页计算属性
const mdCanBackupPaginated = computed(() => {
  const start = (mdCanBackupPage.value - 1) * mdCanBackupPageSize;
  return mdDetectionResult.value?.linksByCategory.canBackup.slice(start, start + mdCanBackupPageSize) || [];
});

const mdCanBackupTotalPages = computed(() => {
  const total = mdDetectionResult.value?.linksByCategory.canBackup.length || 0;
  return Math.ceil(total / mdCanBackupPageSize);
});

// 计算属性：是否有任何选择
const hasAnyMdSelection = computed(() => {
  return mdSelectedReplacements.value.size > 0 || mdSelectedForBackup.value.size > 0;
});

// 计算属性：是否有修复选择（A 类替换）
const hasRepairSelection = computed(() => {
  return mdSelectedReplacements.value.size > 0;
});

// 计算属性：是否有备份选择（C 类冗余备份）- 保留兼容性
const hasBackupSelection = computed(() => {
  return mdSelectedForBackup.value.size > 0;
});

// 计算属性：C 类可备份链接总数
const canBackupCount = computed(() => {
  return mdDetectionResult.value?.linksByCategory.canBackup.length || 0;
});

// 计算属性：C 类链接涉及的图床统计
const canBackupServiceStats = computed(() => {
  if (!mdDetectionResult.value) return new Map<ServiceType | 'external', number>();
  const stats = new Map<ServiceType | 'external', number>();
  for (const item of mdDetectionResult.value.linksByCategory.canBackup) {
    const service = item.serviceId;
    stats.set(service, (stats.get(service) || 0) + 1);
  }
  return stats;
});

// 计算属性：实际需要上传的链接数量（排除已存在于目标图床的）
const actualBackupCount = computed(() => {
  if (!mdDetectionResult.value || mdBackupTargetServices.value.length === 0) {
    return canBackupCount.value;
  }
  return mdDetectionResult.value.linksByCategory.canBackup.filter(item => {
    // 外部链接始终需要上传
    if (item.serviceId === 'external') return true;
    // 已有该图床的链接跳过
    return !mdBackupTargetServices.value.includes(item.serviceId as ServiceType);
  }).length;
});

// 兼容旧代码（保留但不再直接使用）
const mdRepairOptions = ref<MarkdownRepairOptions>({
  directoryPath: '',
  includeSubdirs: true,
  repairMode: 'replace',
  targetServices: []
});
const mdRepairResult = ref<MarkdownRepairResult | null>(null);

// 可用于重新上传的图床列表（已配置好的图床）
const availableServicesForReupload = computed(() => {
  return availableServices.value.filter((s: ServiceType) => {
    // 开箱即用图床（TCL、京东、七鱼）始终可用
    if (['tcl', 'jd', 'qiyu'].includes(s)) return true;
    // 其他图床需要检查配置
    const cfg = configManager.config.value.services?.[s];
    if (!cfg) return false;
    if (s === 'weibo' || s === 'nowcoder' || s === 'zhihu') return !!(cfg as any).cookie;
    if (s === 'nami') return !!(cfg as any).cookie && !!(cfg as any).authToken;
    if (s === 'r2') return !!(cfg as any).accountId && !!(cfg as any).accessKeyId;
    return false;
  });
});

// 选择目录
async function selectMdRepairDirectory() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择要扫描的目录'
    });
    if (selected && typeof selected === 'string') {
      mdDetectOptions.value.directoryPath = selected;
      // 检查已存在的备份
      mdExistingBackups.value = await markdownRepairService.getExistingBackups(selected);
    }
  } catch (e) {
    console.error('选择目录失败:', e);
  }
}

// 重置检测状态
function resetMdRepair() {
  mdRepairPhase.value = 'idle';
  mdDetectionResult.value = null;
  mdSelectedReplacements.value = new Map();
  mdSelectedForReupload.value = new Set();
  mdSelectedForBackup.value = new Set();
  mdRepairProgress.value = null;
  mdCanBackupPage.value = 1; // 重置分页
}

// 开始检测
async function startMdDetection() {
  if (!mdDetectOptions.value.directoryPath) {
    toast.warn('请先选择要扫描的目录');
    return;
  }

  mdRepairPhase.value = 'detecting';
  mdDetectionResult.value = null;
  mdRepairProgress.value = {
    stage: 'scanning',
    stageText: '正在准备...',
    completed: 0,
    total: 0,
    percent: 0
  };

  try {
    // 获取已保存的前缀列表配置（用于去除前缀后检测和匹配）
    // 使用已保存的配置而非未保存的表单数据，确保一致性
    const allPrefixes = configManager.config.value.linkPrefixConfig?.prefixList || [];

    const result = await markdownRepairService.detect(
      mdDetectOptions.value,
      allPrefixes,
      (progress) => {
        mdRepairProgress.value = progress;
      }
    );

    mdDetectionResult.value = result;
    mdRepairPhase.value = 'result';

    // 自动选择所有可替换的链接（使用第一个有效替换）
    for (const item of result.linksByCategory.replaceable) {
      const validReplacement = item.replacements.find(r => r.isValid);
      if (validReplacement) {
        mdSelectedReplacements.value.set(item.originalUrl, validReplacement.url);
      }
    }

    // 显示检测结果提示
    const { summary } = result;
    if (summary.totalLinks === 0) {
      toast.info('扫描完成', `共扫描 ${summary.totalFiles} 个文件，未发现图片链接`);
    } else {
      toast.success(
        '检测完成',
        `共 ${summary.totalLinks} 个链接，${summary.validLinks} 有效，${summary.invalidLinks} 失效`
      );
    }
  } catch (e) {
    toast.error('检测失败', String(e));
    console.error('Markdown 检测失败:', e);
    mdRepairPhase.value = 'idle';
  }
}

// 选择替换链接
function selectReplacement(originalUrl: string, replacementUrl: string) {
  mdSelectedReplacements.value.set(originalUrl, replacementUrl);
}

// 取消选择替换
function unselectReplacement(originalUrl: string) {
  mdSelectedReplacements.value.delete(originalUrl);
}

// 切换重新上传选择
function toggleReuploadSelection(url: string) {
  if (mdSelectedForReupload.value.has(url)) {
    mdSelectedForReupload.value.delete(url);
  } else {
    mdSelectedForReupload.value.add(url);
  }
}

// 切换冗余备份选择
function toggleBackupSelection(url: string) {
  if (mdSelectedForBackup.value.has(url)) {
    mdSelectedForBackup.value.delete(url);
  } else {
    mdSelectedForBackup.value.add(url);
  }
}

// 复制链接到剪贴板
async function copyLinkToClipboard(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('复制成功', '链接已复制到剪贴板');
  } catch (e) {
    console.error('复制失败:', e);
    toast.error('复制失败', String(e));
  }
}

// 判断图床是否可用
function isMdServiceAvailable(serviceId: ServiceType): boolean {
  switch (serviceId) {
    case 'tcl':
      return tclAvailable.value;
    case 'jd':
      return jdAvailable.value;
    case 'qiyu':
      return qiyuAvailable.value;
    case 'weibo':
    case 'nowcoder':
    case 'zhihu':
    case 'nami': {
      // Cookie 认证图床需要检查配置
      const cfg = configManager.config.value.services?.[serviceId];
      return !!(cfg as any)?.cookie;
    }
    case 'r2': {
      // R2 需要检查配置
      const r2Cfg = configManager.config.value.services?.r2;
      return !!(r2Cfg as any)?.accountId && !!(r2Cfg as any)?.accessKeyId;
    }
    default:
      return false;
  }
}

// 执行修复
async function executeMdRepair() {
  if (!mdDetectionResult.value) return;

  // 检查是否有需要执行的操作
  const hasReplacements = mdSelectedReplacements.value.size > 0;
  const hasReuploads = mdSelectedForReupload.value.size > 0 || mdSelectedForBackup.value.size > 0;

  if (!hasReplacements && !hasReuploads) {
    toast.warn('请先选择需要执行的操作');
    return;
  }

  // 如果有重新上传/增加冗余操作，需要选择目标图床
  if (hasReuploads && mdRepairTargetServices.value.length === 0) {
    toast.warn('请选择目标图床');
    return;
  }

  mdRepairPhase.value = 'executing';
  mdRepairProgress.value = {
    stage: 'repairing',
    stageText: '正在执行...',
    completed: 0,
    total: 0,
    percent: 0
  };

  try {
    // 合并需要重新上传的链接
    const linksToReupload = [
      ...Array.from(mdSelectedForReupload.value),
      ...Array.from(mdSelectedForBackup.value)
    ];

    const result = await markdownRepairService.execute(
      mdDetectionResult.value,
      {
        // 创建 Map 副本，确保正确传递
        linksToReplace: new Map(mdSelectedReplacements.value),
        linksToReupload,
        targetServices: mdRepairTargetServices.value,
        backup: mdBackupEnabled.value,
        cleanOldBackups: mdCleanOldBackups.value
      },
      configManager.config.value,
      (progress) => {
        mdRepairProgress.value = progress;
      }
    );

    mdRepairResult.value = result;

    // 显示执行结果
    const { summary } = result;
    if (summary.modifiedFiles > 0) {
      toast.success('执行完成', `已修改 ${summary.modifiedFiles} 个文件，替换 ${summary.replacedLinks} 个链接`);
    } else {
      toast.info('执行完成', '无文件被修改');
    }

    // 返回结果展示界面，刷新检测结果
    mdRepairPhase.value = 'result';
  } catch (e) {
    toast.error('执行失败', String(e));
    console.error('Markdown 修复执行失败:', e);
    mdRepairPhase.value = 'result';
  }
}

// 执行修复（仅 A 类替换）
async function executeMdRepairOnly() {
  if (!mdDetectionResult.value) return;

  // 检查是否有需要执行的操作
  if (mdSelectedReplacements.value.size === 0) {
    toast.warn('请先选择需要替换的链接');
    return;
  }

  mdRepairPhase.value = 'executing';
  mdRepairProgress.value = {
    stage: 'repairing',
    stageText: '正在执行替换...',
    completed: 0,
    total: 0,
    percent: 0
  };

  try {
    const result = await markdownRepairService.execute(
      mdDetectionResult.value,
      {
        // 创建 Map 副本，确保正确传递
        linksToReplace: new Map(mdSelectedReplacements.value),
        linksToReupload: [],
        targetServices: [],
        backup: mdBackupEnabled.value,
        cleanOldBackups: mdCleanOldBackups.value
      },
      configManager.config.value,
      (progress) => {
        mdRepairProgress.value = progress;
      }
    );

    mdRepairResult.value = result;

    // 显示执行结果
    const { summary } = result;
    if (summary.modifiedFiles > 0) {
      toast.success('修复完成', `已修改 ${summary.modifiedFiles} 个文件，替换 ${summary.replacedLinks} 个链接`);
    } else {
      toast.info('修复完成', '无文件被修改');
    }

    // 返回结果展示界面
    mdRepairPhase.value = 'result';
  } catch (e) {
    toast.error('修复失败', String(e));
    console.error('Markdown 替换修复失败:', e);
    mdRepairPhase.value = 'result';
  }
}

// 执行上传（C 类冗余备份 - 默认全选所有链接）
async function executeMdBackup() {
  if (!mdDetectionResult.value) return;

  // 获取所有 C 类链接
  const allCanBackupLinks = mdDetectionResult.value.linksByCategory.canBackup || [];

  // 检查是否有需要执行的操作
  if (allCanBackupLinks.length === 0) {
    toast.warn('没有可备份的链接');
    return;
  }

  // 检查是否选择了目标图床
  if (mdBackupTargetServices.value.length === 0) {
    toast.warn('请选择目标图床');
    return;
  }

  mdRepairPhase.value = 'executing';
  mdRepairProgress.value = {
    stage: 'reuploading',
    stageText: '正在上传备份...',
    completed: 0,
    total: 0,
    percent: 0
  };

  try {
    // 过滤掉已经存在于目标图床的链接（避免重复上传）
    const linksToUpload = allCanBackupLinks
      .filter(item => {
        // 外部链接始终需要上传
        if (item.serviceId === 'external') return true;
        // 已有该图床的链接跳过
        return !mdBackupTargetServices.value.includes(item.serviceId as ServiceType);
      })
      .map(item => item.originalUrl);

    if (linksToUpload.length === 0) {
      toast.info('无需上传', '所有链接已存在于所选图床中');
      mdRepairPhase.value = 'result';
      return;
    }

    const result = await markdownRepairService.execute(
      mdDetectionResult.value,
      {
        linksToReplace: new Map(),
        linksToReupload: linksToUpload,
        targetServices: mdBackupTargetServices.value,
        backup: mdBackupEnabled.value,
        cleanOldBackups: mdCleanOldBackups.value
      },
      configManager.config.value,
      (progress) => {
        mdRepairProgress.value = progress;
      }
    );

    mdRepairResult.value = result;

    // 显示执行结果
    const { summary } = result;
    if (summary.reuploadedLinks > 0) {
      toast.success('备份上传完成', `已上传 ${summary.reuploadedLinks} 个链接到目标图床`);
    } else {
      toast.info('备份上传完成', '无链接被上传');
    }

    // 返回结果展示界面
    mdRepairPhase.value = 'result';
  } catch (e) {
    toast.error('备份上传失败', String(e));
    console.error('Markdown 备份上传失败:', e);
    mdRepairPhase.value = 'result';
  }
}

// 兼容旧的 startMdRepair 函数
async function startMdRepair() {
  await startMdDetection();
}

// 历史记录上传菜单状态
const uploadHistoryMenuVisible = ref(false);
const uploadHistoryDropdownRef = ref<HTMLElement | null>(null);

// 配置下载菜单状态
const downloadSettingsMenuVisible = ref(false);
const downloadSettingsDropdownRef = ref<HTMLElement | null>(null);

// 历史记录下载菜单状态
const downloadHistoryMenuVisible = ref(false);
const downloadHistoryDropdownRef = ref<HTMLElement | null>(null);

// 立即同步菜单状态
const syncNowMenuVisible = ref(false);
const syncNowDropdownRef = ref<HTMLElement | null>(null);

// 区域展开状态（默认关闭）
const configSectionExpanded = ref(false);
const historySectionExpanded = ref(false);

// 切换历史记录上传菜单
const toggleUploadHistoryMenu = () => {
  const willOpen = !uploadHistoryMenuVisible.value;
  // 关闭其他菜单
  downloadSettingsMenuVisible.value = false;
  downloadHistoryMenuVisible.value = false;
  syncNowMenuVisible.value = false;
  uploadHistoryMenuVisible.value = willOpen;
};

// 切换配置下载菜单
const toggleDownloadSettingsMenu = () => {
  const willOpen = !downloadSettingsMenuVisible.value;
  // 关闭其他菜单
  uploadHistoryMenuVisible.value = false;
  downloadHistoryMenuVisible.value = false;
  syncNowMenuVisible.value = false;
  downloadSettingsMenuVisible.value = willOpen;
};

// 切换历史记录下载菜单
const toggleDownloadHistoryMenu = () => {
  const willOpen = !downloadHistoryMenuVisible.value;
  // 关闭其他菜单
  uploadHistoryMenuVisible.value = false;
  downloadSettingsMenuVisible.value = false;
  syncNowMenuVisible.value = false;
  downloadHistoryMenuVisible.value = willOpen;
};

// 切换立即同步菜单
const toggleSyncNowMenu = () => {
  const willOpen = !syncNowMenuVisible.value;
  // 关闭其他菜单
  uploadHistoryMenuVisible.value = false;
  downloadSettingsMenuVisible.value = false;
  downloadHistoryMenuVisible.value = false;
  syncNowMenuVisible.value = willOpen;
};

/**
 * 导出配置到本地文件
 */
async function exportSettingsLocal() {
  try {
    exportSettingsLoading.value = true;

    let config = await configStore.get<UserConfig>('config');

    // 验证配置数据格式，如果数据已损坏则使用默认配置并修复存储
    if (!config || !isValidUserConfig(config)) {
      console.error('[备份] 配置数据格式异常，使用默认配置');

      // 尝试修复：将默认配置保存回存储
      config = { ...DEFAULT_CONFIG };
      await configStore.set('config', config);
      await configStore.save();

      toast.warn('配置已重置', '检测到配置数据异常，已使用默认配置');
    }

    const jsonContent = JSON.stringify(config, null, 2);

    const filePath = await save({
      defaultPath: 'picnexus_settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (!filePath) {
      toast.warn('已取消导出');
      return;
    }

    await writeTextFile(filePath, jsonContent);
    toast.success('配置已导出到本地文件');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导出配置失败:', error);
    toast.error('导出失败', errorMsg);
  } finally {
    exportSettingsLoading.value = false;
  }
}

/**
 * 从本地文件导入配置
 */
async function importSettingsLocal() {
  try {
    importSettingsLoading.value = true;

    const filePath = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false
    });

    if (!filePath || Array.isArray(filePath)) {
      toast.warn('已取消导入');
      return;
    }

    const content = await readTextFile(filePath);
    let importedConfig = JSON.parse(content) as UserConfig;

    // 验证数据格式，防止导入错误格式的数据（如历史记录数据）
    if (!isValidUserConfig(importedConfig)) {
      toast.error('导入失败', '文件内容不是有效的配置数据格式');
      return;
    }

    importedConfig = migrateConfig(importedConfig);

    const currentConfig = await configStore.get<UserConfig>('config') || DEFAULT_CONFIG;

    // 询问用户导入方式
    const result = await confirmThreeWay({
      header: '导入配置',
      message: '检测到配置文件包含 WebDAV 连接信息，请选择导入方式：',
      acceptLabel: '覆盖',
      rejectLabel: '仅保留 WebDAV 配置',
      icon: 'pi pi-exclamation-triangle'
    });

    // 点击叉叉/ESC 时取消整个操作
    if (result === 'dismiss') {
      toast.warn('已取消导入');
      return;
    }

    const shouldOverwriteWebDAV = result === 'accept';

    const mergedConfig: UserConfig = {
      ...importedConfig,
      webdav: shouldOverwriteWebDAV ? importedConfig.webdav : currentConfig.webdav
    };

    await configStore.set('config', mergedConfig);
    await configStore.save();

    toast.success('配置已从本地文件导入');

    setTimeout(() => {
      toast.info('部分配置可能需要刷新页面后生效');
    }, 1000);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导入配置失败:', error);

    if (errorMsg.includes('JSON')) {
      toast.error('导入失败', 'JSON 格式错误，请检查文件格式');
    } else {
      toast.error('导入失败', errorMsg);
    }
  } finally {
    importSettingsLoading.value = false;
  }
}

/**
 * 获取当前 WebDAV 客户端和远程路径
 * @param fileType 文件类型：'settings' 或 'history'
 */
async function getWebDAVClientAndPath(fileType: 'settings' | 'history'): Promise<{ client: WebDAVClient; remotePath: string } | null> {
  const profile = activeWebDAVProfile.value;
  if (!profile || !profile.url || !profile.username || (!profile.password && !profile.passwordEncrypted)) {
    toast.warn('请先配置 WebDAV 连接');
    return null;
  }

  // 使用安全的加密密码创建客户端
  const client = await WebDAVClient.fromEncryptedConfig({
    url: profile.url,
    username: profile.username,
    password: profile.password,
    passwordEncrypted: profile.passwordEncrypted,
    remotePath: profile.remotePath,
  });

  let remotePath = profile.remotePath || '/PicNexus/';
  if (remotePath.endsWith('/')) {
    remotePath += `${fileType}.json`;
  } else if (!remotePath.toLowerCase().endsWith('.json')) {
    remotePath += `/${fileType}.json`;
  } else {
    // 如果路径以 .json 结尾，替换文件名
    remotePath = remotePath.replace(/[^/]+\.json$/i, `${fileType}.json`);
  }

  return { client, remotePath };
}

/**
 * 上传配置到云端 (WebDAV)
 */
async function uploadSettingsCloud() {
  const webdav = await getWebDAVClientAndPath('settings');
  if (!webdav) return;

  try {
    uploadSettingsLoading.value = true;

    const config = await configStore.get<UserConfig>('config');
    if (!config) {
      throw new Error('无法读取本地配置');
    }

    const jsonContent = JSON.stringify(config, null, 2);
    await webdav.client.putFile(webdav.remotePath, jsonContent);

    updateConfigSyncStatus('success');
    toast.success('配置已上传到云端');
  } catch (error) {
    const errorCode = extractErrorCode(error);
    console.error('[备份] 上传配置失败:', error);
    updateConfigSyncStatus('failed', errorCode);
    toast.error('上传失败', errorCode);
  } finally {
    uploadSettingsLoading.value = false;
  }
}

/**
 * 从云端下载配置 - 覆盖本地
 * 完全使用云端配置替换本地配置
 */
async function downloadSettingsOverwrite() {
  downloadSettingsMenuVisible.value = false;

  const webdav = await getWebDAVClientAndPath('settings');
  if (!webdav) return;

  // 二次确认
  const confirmed = await confirmDialog(
    '⚠️ 警告：此操作将完全覆盖本地配置！\n\n本地的所有配置（包括 WebDAV 连接信息）将被云端数据替换。\n是否继续？',
    '覆盖本地配置'
  );
  if (!confirmed) return;

  try {
    downloadSettingsLoading.value = true;

    const content = await webdav.client.getFile(webdav.remotePath);

    if (!content) {
      throw new Error('云端配置文件不存在');
    }

    let importedConfig = JSON.parse(content) as UserConfig;

    // 验证数据格式，防止导入错误格式的数据（如历史记录数据）
    if (!isValidUserConfig(importedConfig)) {
      updateConfigSyncStatus('failed', '云端数据格式无效');
      toast.error('下载失败', '云端配置文件内容格式无效，可能不是配置数据');
      return;
    }

    importedConfig = migrateConfig(importedConfig);

    await configStore.set('config', importedConfig);
    await configStore.save();

    updateConfigSyncStatus('success');
    toast.success('配置已从云端恢复（覆盖本地）');

    setTimeout(() => {
      toast.info('请刷新页面以使配置生效');
    }, 1000);
  } catch (error) {
    const errorCode = extractErrorCode(error);
    console.error('[备份] 下载配置失败:', error);
    updateConfigSyncStatus('failed', errorCode);
    toast.error('下载失败', errorCode);
  } finally {
    downloadSettingsLoading.value = false;
  }
}

/**
 * 从云端下载配置 - 合并（保留本地 WebDAV 配置）
 * 保留本地的 WebDAV 连接信息，其他配置用云端的
 */
async function downloadSettingsMerge() {
  downloadSettingsMenuVisible.value = false;

  const webdav = await getWebDAVClientAndPath('settings');
  if (!webdav) return;

  try {
    downloadSettingsLoading.value = true;

    const currentConfig = await configStore.get<UserConfig>('config');
    const content = await webdav.client.getFile(webdav.remotePath);

    if (!content) {
      throw new Error('云端配置文件不存在');
    }

    let importedConfig = JSON.parse(content) as UserConfig;

    // 验证数据格式，防止导入错误格式的数据（如历史记录数据）
    if (!isValidUserConfig(importedConfig)) {
      updateConfigSyncStatus('failed', '云端数据格式无效');
      toast.error('下载失败', '云端配置文件内容格式无效，可能不是配置数据');
      return;
    }

    importedConfig = migrateConfig(importedConfig);

    // 合并配置：保留本地 WebDAV 配置，其他用云端的
    const mergedConfig: UserConfig = {
      ...importedConfig,
      webdav: currentConfig?.webdav || importedConfig.webdav  // 保留本地 WebDAV 配置
    };

    await configStore.set('config', mergedConfig);
    await configStore.save();

    updateConfigSyncStatus('success');
    toast.success('配置已从云端恢复（保留本地 WebDAV）');

    setTimeout(() => {
      toast.info('请刷新页面以使配置生效');
    }, 1000);
  } catch (error) {
    const errorCode = extractErrorCode(error);
    console.error('[备份] 合并下载配置失败:', error);
    updateConfigSyncStatus('failed', errorCode);
    toast.error('下载失败', errorCode);
  } finally {
    downloadSettingsLoading.value = false;
  }
}

/**
 * 导出历史记录到本地文件
 */
async function exportHistoryLocal() {
  try {
    exportHistoryLoading.value = true;

    const count = await historyDB.getCount();
    if (count === 0) {
      toast.warn('没有可导出的历史记录');
      return;
    }

    const jsonContent = await historyDB.exportToJSON();

    const filePath = await save({
      defaultPath: 'picnexus_history.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (!filePath) {
      toast.warn('已取消导出');
      return;
    }

    await writeTextFile(filePath, jsonContent);
    toast.success(`已导出 ${count} 条记录到本地文件`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导出历史记录失败:', error);
    toast.error('导出失败', errorMsg);
  } finally {
    exportHistoryLoading.value = false;
  }
}

/**
 * 从本地文件导入历史记录（合并）
 */
async function importHistoryLocal() {
  try {
    importHistoryLoading.value = true;

    const filePath = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false
    });

    if (!filePath || Array.isArray(filePath)) {
      toast.warn('已取消导入');
      return;
    }

    const content = await readTextFile(filePath);
    const importedItems = JSON.parse(content) as HistoryItem[];

    if (!Array.isArray(importedItems)) {
      throw new Error('JSON 格式错误：期望数组格式');
    }

    // 获取导入前的记录数
    const countBefore = await historyDB.getCount();

    // 使用 SQLite 的合并导入
    const importedCount = await historyDB.importFromJSON(content, 'merge');

    // 获取导入后的记录数
    const countAfter = await historyDB.getCount();

    // 使缓存失效，让其他视图在下次激活时重新加载
    invalidateCache();

    const addedCount = countAfter - countBefore;
    toast.success(
      `导入完成：共 ${countAfter} 条记录`,
      `新增 ${addedCount} 条，去重/更新 ${importedItems.length - addedCount} 条`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[备份] 导入历史记录失败:', error);

    if (errorMsg.includes('JSON')) {
      toast.error('导入失败', 'JSON 格式错误，请检查文件格式');
    } else {
      toast.error('导入失败', errorMsg);
    }
  } finally {
    importHistoryLoading.value = false;
  }
}

/**
 * 上传历史记录到云端 - 强制覆盖（Force Push）
 * 完全使用本地数据替换云端数据
 */
async function uploadHistoryForce() {
  uploadHistoryMenuVisible.value = false;

  const webdav = await getWebDAVClientAndPath('history');
  if (!webdav) return;

  // 二次确认
  const confirmed = await confirmDialog(
    '⚠️ 警告：此操作将完全覆盖云端数据！\n\n云端现有的所有记录将被删除，替换为本地数据。\n此操作不可撤销，是否继续？',
    '强制覆盖云端'
  );
  if (!confirmed) return;

  try {
    uploadHistoryLoading.value = true;

    const count = await historyDB.getCount();
    if (count === 0) {
      toast.warn('没有可上传的历史记录');
      return;
    }

    const jsonContent = await historyDB.exportToJSON();
    await webdav.client.putFile(webdav.remotePath, jsonContent);

    updateHistorySyncStatus('success');
    toast.success(`已强制覆盖云端记录（${count} 条）`);
  } catch (error) {
    const errorCode = extractErrorCode(error);
    console.error('[备份] 强制上传历史记录失败:', error);
    updateHistorySyncStatus('failed', errorCode);
    toast.error('上传失败', errorCode);
  } finally {
    uploadHistoryLoading.value = false;
  }
}

/**
 * 智能合并上传历史记录
 * 流程：下载云端 -> 与本地合并 -> 上传合并结果
 */
async function uploadHistoryMerge() {
  uploadHistoryMenuVisible.value = false;

  const webdav = await getWebDAVClientAndPath('history');
  if (!webdav) return;

  try {
    uploadHistoryLoading.value = true;

    const localCount = await historyDB.getCount();
    if (localCount === 0) {
      toast.warn('没有可上传的历史记录');
      return;
    }

    // 导出本地数据为 JSON
    const localJsonContent = await historyDB.exportToJSON();
    const localItems = JSON.parse(localJsonContent) as HistoryItem[];

    // 1. 尝试下载云端数据
    let cloudItems: HistoryItem[] = [];
    try {
      const content = await webdav.client.getFile(webdav.remotePath);
      if (content) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          cloudItems = parsed;
        }
      }
    } catch (e) {
      // 云端文件不存在或解析失败，使用空数组
      console.log('[备份] 云端文件不存在或无法解析，将进行全量上传');
    }

    // 2. 合并本地和云端数据
    const itemMap = new Map<string, HistoryItem>();

    // 先添加云端数据
    cloudItems.forEach(item => {
      if (item.id) {
        itemMap.set(item.id, item);
      }
    });

    // 再用本地数据覆盖（本地优先，基于时间戳）
    localItems.forEach(item => {
      if (item.id) {
        const existing = itemMap.get(item.id);
        // 如果本地记录更新或云端不存在，使用本地记录
        if (!existing || (item.timestamp && item.timestamp > (existing.timestamp || 0))) {
          itemMap.set(item.id, item);
        }
      } else {
        // 没有 ID 的记录，生成一个并添加
        item.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        itemMap.set(item.id, item);
      }
    });

    // 3. 排序并上传
    const mergedItems = Array.from(itemMap.values());
    mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const jsonContent = JSON.stringify(mergedItems, null, 2);
    await webdav.client.putFile(webdav.remotePath, jsonContent);

    const newCount = mergedItems.length - cloudItems.length;
    updateHistorySyncStatus('success');
    toast.success(
      `合并上传完成：共 ${mergedItems.length} 条记录`,
      newCount > 0 ? `新增 ${newCount} 条到云端` : '云端数据已是最新'
    );
  } catch (error) {
    const errorCode = extractErrorCode(error);
    console.error('[备份] 智能合并上传失败:', error);
    updateHistorySyncStatus('failed', errorCode);
    toast.error('上传失败', errorCode);
  } finally {
    uploadHistoryLoading.value = false;
  }
}

/**
 * 仅上传本地新增的历史记录
 * 只上传云端不存在的记录，保留云端原有数据
 */
async function uploadHistoryIncremental() {
  uploadHistoryMenuVisible.value = false;

  const webdav = await getWebDAVClientAndPath('history');
  if (!webdav) return;

  try {
    uploadHistoryLoading.value = true;

    const localCount = await historyDB.getCount();
    if (localCount === 0) {
      toast.warn('没有可上传的历史记录');
      return;
    }

    // 导出本地数据为 JSON
    const localJsonContent = await historyDB.exportToJSON();
    const localItems = JSON.parse(localJsonContent) as HistoryItem[];

    // 1. 下载云端数据获取已存在的 ID
    let cloudItems: HistoryItem[] = [];
    const cloudIdSet = new Set<string>();

    try {
      const content = await webdav.client.getFile(webdav.remotePath);
      if (content) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          cloudItems = parsed;
          cloudItems.forEach(item => {
            if (item.id) cloudIdSet.add(item.id);
          });
        }
      }
    } catch (e) {
      // 云端文件不存在，视为空
      console.log('[备份] 云端文件不存在，将进行全量上传');
    }

    // 2. 找出本地有但云端没有的记录
    const newItems = localItems.filter(item => item.id && !cloudIdSet.has(item.id));

    if (newItems.length === 0) {
      updateHistorySyncStatus('success');
      toast.info('无需上传', '本地没有新增的记录');
      return;
    }

    // 3. 合并云端数据和新增数据
    const mergedItems = [...cloudItems, ...newItems];
    mergedItems.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const jsonContent = JSON.stringify(mergedItems, null, 2);
    await webdav.client.putFile(webdav.remotePath, jsonContent);

    updateHistorySyncStatus('success');
    toast.success(
      `增量上传完成`,
      `新增 ${newItems.length} 条记录到云端，共 ${mergedItems.length} 条`
    );
  } catch (error) {
    const errorCode = extractErrorCode(error);
    console.error('[备份] 增量上传失败:', error);
    updateHistorySyncStatus('failed', errorCode);
    toast.error('上传失败', errorCode);
  } finally {
    uploadHistoryLoading.value = false;
  }
}

/**
 * 从云端下载历史记录 - 覆盖本地
 * 完全使用云端数据替换本地历史记录
 */
async function downloadHistoryOverwrite() {
  downloadHistoryMenuVisible.value = false;

  const webdav = await getWebDAVClientAndPath('history');
  if (!webdav) return;

  // 二次确认
  const confirmed = await confirmDialog(
    '⚠️ 警告：此操作将完全覆盖本地数据！\n\n本地现有的所有记录将被删除，替换为云端数据。\n是否继续？',
    '覆盖本地数据'
  );
  if (!confirmed) return;

  try {
    downloadHistoryLoading.value = true;

    const content = await webdav.client.getFile(webdav.remotePath);

    if (!content) {
      throw new Error('云端历史记录文件不存在');
    }

    const cloudItems = JSON.parse(content) as HistoryItem[];

    if (!Array.isArray(cloudItems)) {
      throw new Error('云端数据格式错误：期望数组格式');
    }

    // 使用 SQLite 的覆盖导入
    await historyDB.importFromJSON(content, 'replace');

    // 使缓存失效，让其他视图在下次激活时重新加载
    invalidateCache();

    updateHistorySyncStatus('success');
    toast.success(`下载完成：共 ${cloudItems.length} 条记录（覆盖本地）`);
  } catch (error) {
    const errorCode = extractErrorCode(error);
    console.error('[备份] 下载历史记录失败:', error);
    updateHistorySyncStatus('failed', errorCode);
    toast.error('下载失败', errorCode);
  } finally {
    downloadHistoryLoading.value = false;
  }
}

/**
 * 从云端下载历史记录 - 智能合并
 * 与本地记录合并，保留更新的版本
 */
async function downloadHistoryMerge() {
  downloadHistoryMenuVisible.value = false;

  const webdav = await getWebDAVClientAndPath('history');
  if (!webdav) return;

  try {
    downloadHistoryLoading.value = true;

    const content = await webdav.client.getFile(webdav.remotePath);

    if (!content) {
      throw new Error('云端历史记录文件不存在');
    }

    const cloudItems = JSON.parse(content) as HistoryItem[];

    if (!Array.isArray(cloudItems)) {
      throw new Error('云端数据格式错误：期望数组格式');
    }

    // 获取导入前的记录数
    const countBefore = await historyDB.getCount();

    // 使用 SQLite 的合并导入
    await historyDB.importFromJSON(content, 'merge');

    // 获取导入后的记录数
    const countAfter = await historyDB.getCount();

    // 使缓存失效，让其他视图在下次激活时重新加载
    invalidateCache();

    const addedCount = countAfter - countBefore;
    updateHistorySyncStatus('success');
    toast.success(
      `下载完成：共 ${countAfter} 条记录`,
      `新增 ${addedCount} 条，合并 ${cloudItems.length - addedCount} 条`
    );
  } catch (error) {
    const errorCode = extractErrorCode(error);
    console.error('[备份] 下载历史记录失败:', error);
    updateHistorySyncStatus('failed', errorCode);
    toast.error('下载失败', errorCode);
  } finally {
    downloadHistoryLoading.value = false;
  }
}

// 点击外部关闭下拉菜单
const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as Node;

  // 关闭历史记录上传菜单
  if (uploadHistoryMenuVisible.value && uploadHistoryDropdownRef.value) {
    if (!uploadHistoryDropdownRef.value.contains(target)) {
      uploadHistoryMenuVisible.value = false;
    }
  }

  // 关闭配置下载菜单
  if (downloadSettingsMenuVisible.value && downloadSettingsDropdownRef.value) {
    if (!downloadSettingsDropdownRef.value.contains(target)) {
      downloadSettingsMenuVisible.value = false;
    }
  }

  // 关闭历史记录下载菜单
  if (downloadHistoryMenuVisible.value && downloadHistoryDropdownRef.value) {
    if (!downloadHistoryDropdownRef.value.contains(target)) {
      downloadHistoryMenuVisible.value = false;
    }
  }

  // 关闭立即同步菜单
  if (syncNowMenuVisible.value && syncNowDropdownRef.value) {
    if (!syncNowDropdownRef.value.contains(target)) {
      syncNowMenuVisible.value = false;
    }
  }
};

// 监听 Cookie 更新
onMounted(async () => {
  // 获取应用版本号
  try {
    appVersion.value = await getVersion();
  } catch (error) {
    console.error('获取版本号失败:', error);
    appVersion.value = '未知版本';
  }

  await loadSettings();
  await loadSyncStatus();  // 加载同步状态
  await loadAutoSyncConfig();  // 加载自动同步配置

  // 初始化七鱼可用状态（使用缓存值，避免检测前显示错误状态）
  if (syncStatus.value.qiyuCheckStatus?.lastCheckResult !== undefined) {
    qiyuAvailable.value = syncStatus.value.qiyuCheckStatus.lastCheckResult;
  }

  // 可用性检测（七鱼使用智能检测策略，京东/TCL使用5分钟冷却）
  await checkAllAvailabilityWithCooldown();
  cookieUnlisten.value = await configManager.setupCookieListener(async (sid, cookie) => {
    if (sid === 'weibo') formData.value.weiboCookie = cookie;
    else if (['nowcoder', 'zhihu', 'nami'].includes(sid)) (formData.value as any)[sid].cookie = cookie;
    await saveSettings(true); // 静默保存，不显示"保存成功"提示
  });

  // 添加点击外部关闭菜单监听
  document.addEventListener('click', handleClickOutside);
});

// 组件卸载时清理监听器
onUnmounted(() => {
  if (cookieUnlisten.value) {
    cookieUnlisten.value();
    cookieUnlisten.value = null;
  }

  // 移除点击外部关闭菜单监听
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div class="settings-layout">
    <div class="settings-sidebar">
      <div class="sidebar-header">设置</div>
      <div class="nav-list">
        <template v-for="(item, index) in tabs" :key="index">
          <div v-if="item.type === 'separator'" class="nav-separator"></div>
          <div v-else-if="item.type === 'label'" class="nav-label">{{ item.label }}</div>
          <button
            v-else
            class="nav-item"
            :class="{ active: activeTab === item.id }"
            @click="activeTab = item.id as SettingsTab"
          >
            <i :class="item.icon"></i>
            <span>{{ item.label }}</span>
          </button>
        </template>
      </div>

      <div class="sidebar-footer">
        <span class="version-text">PicNexus v{{ appVersion }}</span>
      </div>
    </div>

    <div class="settings-content">

      <div v-if="activeTab === 'general'" class="settings-section">
        <div class="section-header">
          <h2>常规设置</h2>
          <p class="section-desc">管理应用外观与启用的服务模块。</p>
        </div>

        <div class="form-group">
          <label class="group-label">外观主题</label>
          <div class="theme-options">
            <div
              v-for="opt in themeOptions" :key="opt.value"
              class="theme-card"
              :class="{ active: currentTheme === opt.value }"
              @click="handleThemeChange(opt.value as ThemeMode)"
            >
              <i :class="opt.icon"></i>
              <span>{{ opt.label }}</span>
            </div>
          </div>
        </div>

        <Divider />

        <div class="form-group">
          <label class="group-label">启用的图床服务</label>
          <p class="helper-text">勾选要在"上传界面"显示的服务。</p>

          <div class="service-group-section">
            <div class="service-group-title">私有图床</div>
            <div class="service-toggles-grid">
              <div
                v-for="svc in PRIVATE_SERVICES"
                :key="svc"
                class="toggle-chip"
              >
                <Checkbox :inputId="'svc-'+svc" v-model="availableServices" :value="svc" @change="saveSettings" />
                <label :for="'svc-'+svc">{{ serviceNames[svc] }}</label>
              </div>
            </div>
          </div>

          <div class="service-group-section">
            <div class="service-group-title">公共图床</div>
            <div class="service-toggles-grid">
              <div
                v-for="svc in PUBLIC_SERVICES"
                :key="svc"
                class="toggle-chip"
              >
                <Checkbox :inputId="'svc-'+svc" v-model="availableServices" :value="svc" @change="saveSettings" />
                <label :for="'svc-'+svc">{{ serviceNames[svc] }}</label>
              </div>
            </div>
          </div>
        </div>

        <Divider />

        <div class="form-group">
          <label class="group-label">数据管理</label>
          <p class="helper-text">管理上传历史记录和应用缓存。</p>
          <div class="flex gap-2 flex-wrap">
            <Button
              label="清空历史记录"
              icon="pi pi-trash"
              severity="danger"
              outlined
              @click="handleClearHistory"
            />
            <Button
              label="清理应用缓存"
              icon="pi pi-refresh"
              severity="secondary"
              outlined
              @click="handleClearAppCache"
              :loading="isClearingCache"
            />
          </div>
        </div>

        <Divider />

        <div class="form-group">
          <label class="group-label">隐私设置</label>
          <p class="helper-text">管理应用使用数据的收集。</p>

          <div class="privacy-setting">
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">使用数据收集</span>
                <span class="setting-desc">
                  允许发送匿名使用统计，帮助改进应用。不收集任何个人信息或上传内容。
                </span>
              </div>
              <ToggleSwitch
                v-model="formData.analyticsEnabled"
                @change="handleAnalyticsToggle"
              />
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'r2'" class="settings-section">
        <div class="section-header">
          <h2>Cloudflare R2</h2>
          <p class="section-desc">配置 S3 兼容的高速存储，用于数据备份与分发。</p>
        </div>

        <div class="form-grid">
            <div class="form-item">
                <label>Account ID</label>
                <InputText v-model="formData.r2.accountId" @blur="saveSettings" class="w-full" />
            </div>
            <div class="form-item">
                <label>Bucket Name</label>
                <InputText v-model="formData.r2.bucketName" @blur="saveSettings" class="w-full" />
            </div>
            <div class="form-item">
                <label>Access Key ID</label>
                <Password v-model="formData.r2.accessKeyId" @blur="saveSettings" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
            </div>
            <div class="form-item">
                <label>Secret Access Key</label>
                <Password v-model="formData.r2.secretAccessKey" @blur="saveSettings" :feedback="false" toggleMask class="w-full" inputClass="w-full" />
            </div>
            <div class="form-item span-full">
                <label>自定义路径 (Optional)</label>
                <InputText v-model="formData.r2.path" @blur="saveSettings" placeholder="e.g. blog/images/" class="w-full" />
            </div>
            <div class="form-item span-full">
                <label>公开访问域名 (Public Domain)</label>
                <InputText v-model="formData.r2.publicDomain" @blur="saveSettings" placeholder="https://images.example.com" class="w-full" />
            </div>
        </div>

        <div class="actions-row mt-4">
            <Button label="测试 R2 连接" icon="pi pi-check" @click="actions.r2" :loading="testingConnections.r2" severity="secondary" outlined size="small" />
        </div>
      </div>

      <div v-if="activeTab === 'builtin'" class="settings-section">
        <div class="section-header">
          <h2>开箱即用</h2>
          <p class="section-desc">无需配置，直接使用的图床服务。</p>
        </div>

        <div class="service-cards-row">
          <div class="service-card-flat">
            <div class="sc-content">
              <h3>京东图床</h3>
              <p>速度极快，CDN 全球分发。最大支持 15MB。</p>
              <div class="service-status">
                <Tag
                  :value="isCheckingJd ? '检测中' : (jdAvailable ? '可用' : '不可用')"
                  :severity="isCheckingJd ? 'info' : (jdAvailable ? 'success' : 'danger')"
                  :icon="isCheckingJd ? 'pi pi-spin pi-spinner' : undefined"
                  class="clickable-tag"
                  @click="!isCheckingJd && checkJdAvailable()"
                />
              </div>
            </div>
          </div>
          <div class="service-card-flat">
            <div class="sc-content">
              <h3>TCL 图床</h3>
              <p>无需配置，直接使用。支持多种格式。</p>
              <div class="service-status">
                <Tag
                  :value="isCheckingTcl ? '检测中' : (tclAvailable ? '可用' : '不可用')"
                  :severity="isCheckingTcl ? 'info' : (tclAvailable ? 'success' : 'danger')"
                  :icon="isCheckingTcl ? 'pi pi-spin pi-spinner' : undefined"
                  class="clickable-tag"
                  @click="!isCheckingTcl && checkTclAvailable()"
                />
              </div>
            </div>
          </div>
          <div class="service-card-flat">
            <div class="sc-content">
              <h3>七鱼图床</h3>
              <p>基于网易七鱼客服系统，Token 自动获取。</p>
              <div class="service-status">
                <Tag
                  :value="isCheckingQiyu ? '检测中' : (qiyuAvailable ? '可用' : '不可用')"
                  :severity="isCheckingQiyu ? 'info' : (qiyuAvailable ? 'success' : 'danger')"
                  :icon="isCheckingQiyu ? 'pi pi-spin pi-spinner' : undefined"
                  class="clickable-tag"
                  @click="!isCheckingQiyu && checkQiyuAvailability(true)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'cookie_auth'" class="settings-section">
        <div class="section-header">
          <h2>Cookie 认证</h2>
          <p class="section-desc">需要提供 Cookie 的图床服务。</p>
        </div>

        <div class="sub-section">
          <div class="flex justify-between items-center mb-2">
            <h3>微博图床</h3>
            <div class="actions-mini">
              <Button label="获取" icon="pi pi-globe" @click="actions.login('weibo')" text size="small"/>
              <Button label="测试" icon="pi pi-check" @click="actions.weibo" :loading="testingConnections.weibo" text size="small"/>
            </div>
          </div>
          <Textarea v-model="formData.weiboCookie" @blur="saveSettings" rows="4" class="mono-input w-full" placeholder="SUB=...; (粘贴完整 Cookie)" />
        </div>

        <Divider />

        <div class="sub-section">
          <div class="flex justify-between items-center mb-2">
            <h3>知乎图床</h3>
            <div class="actions-mini">
              <Button label="获取" icon="pi pi-globe" @click="actions.login('zhihu')" text size="small"/>
              <Button label="测试" icon="pi pi-check" @click="actions.zhihu" :loading="testingConnections.zhihu" text size="small"/>
            </div>
          </div>
          <Textarea v-model="formData.zhihu.cookie" @blur="saveSettings" rows="4" class="mono-input w-full" placeholder="知乎 Cookie..." />
        </div>

        <Divider />

        <div class="sub-section">
          <div class="flex justify-between items-center mb-2">
            <h3>牛客图床</h3>
            <div class="actions-mini">
              <Button label="获取" icon="pi pi-globe" @click="actions.login('nowcoder')" text size="small"/>
              <Button label="测试" icon="pi pi-check" @click="actions.nowcoder" :loading="testingConnections.nowcoder" text size="small"/>
            </div>
          </div>
          <Textarea v-model="formData.nowcoder.cookie" @blur="saveSettings" rows="4" class="mono-input w-full" placeholder="牛客 Cookie..." />
        </div>

        <Divider />

        <div class="sub-section">
          <div class="flex justify-between items-center mb-2">
            <h3>纳米图床</h3>
            <div class="actions-mini">
              <Button label="获取" icon="pi pi-globe" @click="actions.login('nami')" text size="small"/>
              <Button label="测试" icon="pi pi-check" @click="actions.nami" :loading="testingConnections.nami" text size="small"/>
            </div>
          </div>
          <Textarea v-model="formData.nami.cookie" @blur="saveSettings" rows="4" class="mono-input w-full" placeholder="纳米 Cookie..." />
        </div>
      </div>

      <div v-if="activeTab === 'links'" class="settings-section">
        <div class="section-header">
          <h2>链接前缀</h2>
          <p class="section-desc">为微博图片添加代理前缀以绕过防盗链限制。</p>
        </div>

        <div class="form-group mb-4">
            <div class="flex items-center gap-2">
                <Checkbox v-model="formData.linkPrefixEnabled" :binary="true" inputId="prefix-enable" @change="saveSettings" />
                <label for="prefix-enable" class="font-medium cursor-pointer">启用链接前缀</label>
            </div>
        </div>

        <div v-if="formData.linkPrefixEnabled" class="prefix-list">
            <div v-for="(_prefix, idx) in formData.linkPrefixList" :key="idx" class="prefix-row">
                <RadioButton v-model="formData.selectedPrefixIndex" :value="idx" :inputId="'p-'+idx" @change="saveSettings()" />
                <InputText v-model="formData.linkPrefixList[idx]" @blur="saveSettings()" class="flex-1" />
                <Button icon="pi pi-trash" @click="removePrefix(idx)" text severity="danger" :disabled="formData.linkPrefixList.length <= 1"/>
            </div>
            <Button label="添加新前缀" icon="pi pi-plus" @click="addPrefix" outlined class="w-full mt-2" size="small" />
            <!-- 修改点 3: 添加恢复默认前缀按钮 -->
            <Button
              label="恢复默认前缀"
              icon="pi pi-refresh"
              @click="resetToDefaultPrefixes"
              outlined
              severity="secondary"
              size="small"
              class="w-full mt-2"
            />
        </div>
      </div>

      <div v-if="activeTab === 'md_repair'" class="settings-section">
        <div class="section-header">
          <h2>MD 图链修复</h2>
          <p class="section-desc">扫描 Markdown 文件中的图片链接，检测并修复失效链接。</p>
        </div>

        <!-- ========== 阶段 1: 配置与检测 ========== -->
        <template v-if="mdRepairPhase === 'idle' || mdRepairPhase === 'detecting'">
          <!-- 扫描目录选择 -->
          <div class="form-item mb-4">
            <label>扫描目录</label>
            <div class="flex gap-2">
              <InputText
                v-model="mdDetectOptions.directoryPath"
                class="flex-1"
                placeholder="选择要扫描的目录"
                readonly
              />
              <Button
                icon="pi pi-folder-open"
                @click="selectMdRepairDirectory"
                outlined
                :disabled="mdRepairPhase === 'detecting'"
              />
            </div>
          </div>

          <!-- 包含子目录选项 -->
          <div class="flex items-center gap-2 mb-4">
            <Checkbox
              v-model="mdDetectOptions.includeSubdirs"
              :binary="true"
              inputId="md-include-subdirs"
              :disabled="mdRepairPhase === 'detecting'"
            />
            <label for="md-include-subdirs" class="cursor-pointer">包含子目录</label>
          </div>

          <!-- 开始检测按钮 -->
          <div class="md-repair-actions mt-4">
            <Button
              :label="mdRepairPhase === 'detecting' ? '检测中...' : '开始检测'"
              :icon="mdRepairPhase === 'detecting' ? 'pi pi-spin pi-spinner' : 'pi pi-search'"
              :disabled="mdRepairPhase === 'detecting' || !mdDetectOptions.directoryPath"
              @click="startMdDetection"
            />
          </div>

          <!-- 进度条 -->
          <div v-if="mdRepairProgress && mdRepairPhase === 'detecting'" class="md-repair-progress mt-4">
            <div class="progress-header">
              <span class="progress-stage">{{ mdRepairProgress.stageText }}</span>
              <span class="progress-percent">{{ mdRepairProgress.percent }}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: mdRepairProgress.percent + '%' }"></div>
            </div>
            <p v-if="mdRepairProgress.current" class="progress-current">
              {{ mdRepairProgress.current }}
            </p>
          </div>
        </template>

        <!-- ========== 阶段 2: 结果展示 ========== -->
        <template v-if="mdRepairPhase === 'result' && mdDetectionResult">
          <!-- 操作栏 -->
          <div class="result-actions-bar mb-4">
            <span class="current-path text-muted">
              <i class="pi pi-folder"></i>
              {{ mdDetectionResult.directoryPath }}
            </span>
            <Button
              label="重新检测"
              icon="pi pi-refresh"
              @click="resetMdRepair"
              outlined
              size="small"
            />
          </div>

          <!-- 统计概览 -->
          <div class="md-repair-result">
            <div class="result-header">
              <h4>检测结果</h4>
            </div>
            <div class="result-stats cols-5">
              <div class="stat-card">
                <div class="stat-value">{{ mdDetectionResult.summary.totalFiles }}</div>
                <div class="stat-label">扫描文件</div>
              </div>
              <div class="stat-card text-green">
                <div class="stat-value">{{ mdDetectionResult.summary.validLinks }}</div>
                <div class="stat-label">有效链接</div>
              </div>
              <div class="stat-card text-red">
                <div class="stat-value">{{ mdDetectionResult.summary.invalidLinks }}</div>
                <div class="stat-label">失效链接</div>
              </div>
              <div class="stat-card text-blue">
                <div class="stat-value">{{ mdDetectionResult.summary.replaceableLinks }}</div>
                <div class="stat-label">可替换</div>
              </div>
              <div class="stat-card text-orange">
                <div class="stat-value">{{ mdDetectionResult.summary.needReuploadLinks }}</div>
                <div class="stat-label">需上传</div>
              </div>
            </div>
          </div>

          <!-- B类：需重新上传链接（移到顶部） -->
          <div class="link-category-section collapsible mt-4">
            <div class="category-header clickable" @click="mdNeedReuploadSectionExpanded = !mdNeedReuploadSectionExpanded">
              <div class="header-left">
                <i class="pi pi-exclamation-triangle text-orange"></i>
                <h4>需重新上传 ({{ mdDetectionResult.linksByCategory.needReupload.length }})</h4>
              </div>
              <i :class="mdNeedReuploadSectionExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
            </div>
            <p class="category-desc">这些失效链接没有可用的替换，需手动获取图片后重新上传</p>
            <Transition name="collapse">
              <div v-if="mdNeedReuploadSectionExpanded" class="section-content">
                <!-- 空状态 -->
                <div v-if="mdDetectionResult.linksByCategory.needReupload.length === 0" class="empty-state">
                  <i class="pi pi-inbox"></i>
                  <p>暂无需重新上传的链接</p>
                </div>
                <!-- 链接列表 -->
                <div v-else class="link-list">
                  <div
                    v-for="item in mdDetectionResult.linksByCategory.needReupload"
                    :key="item.originalUrl"
                    class="link-item"
                  >
                    <div class="link-main">
                      <div class="link-url broken">
                        <i class="pi pi-times-circle"></i>
                        <span class="url-text">{{ item.originalUrl }}</span>
                      </div>
                      <div class="link-files">
                        <span class="file-badge" v-for="fp in item.filePaths.slice(0, 3)" :key="fp">{{ fp }}</span>
                        <span v-if="item.filePaths.length > 3" class="file-more">+{{ item.filePaths.length - 3 }} 更多</span>
                      </div>
                    </div>
                    <div class="link-status">
                      <Tag
                        value="无可用替换"
                        severity="warning"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Transition>
          </div>

          <!-- A类：可替换链接列表 -->
          <div class="link-category-section collapsible mt-4">
            <div class="category-header clickable" @click="mdReplaceableSectionExpanded = !mdReplaceableSectionExpanded">
              <div class="header-left">
                <i class="pi pi-check-circle text-blue"></i>
                <h4>可替换链接 ({{ mdDetectionResult.linksByCategory.replaceable.length }})</h4>
              </div>
              <i :class="mdReplaceableSectionExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
            </div>
            <p class="category-desc">这些失效链接在历史记录中有可用的替换</p>
            <Transition name="collapse">
              <div v-if="mdReplaceableSectionExpanded" class="section-content">
                <!-- 空状态 -->
                <div v-if="mdDetectionResult.linksByCategory.replaceable.length === 0" class="empty-state">
                  <i class="pi pi-inbox"></i>
                  <p>暂无可替换链接</p>
                </div>
                <!-- 链接列表 -->
                <div v-else class="link-list">
                  <div
                    v-for="item in mdDetectionResult.linksByCategory.replaceable"
                    :key="item.originalUrl"
                    class="link-item"
                  >
                    <div class="link-main">
                      <div class="link-url broken">
                        <i class="pi pi-times-circle"></i>
                        <span class="url-text">{{ item.originalUrl }}</span>
                      </div>
                      <div class="link-files">
                        <span class="file-badge" v-for="fp in item.filePaths.slice(0, 3)" :key="fp">{{ fp }}</span>
                        <span v-if="item.filePaths.length > 3" class="file-more">+{{ item.filePaths.length - 3 }} 更多</span>
                      </div>
                    </div>
                    <div class="link-replacements">
                      <span class="replacement-label">替换为:</span>
                      <div class="replacement-options">
                        <div
                          v-for="rep in item.replacements.filter(r => r.isValid)"
                          :key="rep.url"
                          class="replacement-option"
                          :class="{ selected: mdSelectedReplacements.get(item.originalUrl) === rep.url }"
                          @click="selectReplacement(item.originalUrl, rep.url)"
                        >
                          <Tag
                            :value="serviceNames[rep.serviceId]"
                            :severity="rep.isValid ? 'success' : 'danger'"
                            class="clickable-tag"
                            @click.stop="copyLinkToClipboard(rep.url)"
                            v-tooltip.top="'点击复制链接'"
                          />
                          <span
                            class="rep-url clickable"
                            @click.stop="copyLinkToClipboard(rep.url)"
                            v-tooltip.top="'点击复制链接'"
                          >{{ rep.url.slice(0, 50) }}...</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Transition>
          </div>

          <!-- ==================== 修复区域 ==================== -->
          <div class="repair-section mt-4">
            <!-- 目标图床（修复用，保留以备扩展） -->
            <div class="form-group">
              <label class="group-label">目标图床</label>
              <p class="helper-text">选择重新上传的目标图床（用于后续扩展）</p>
              <div class="service-checkboxes">
                <div
                  v-for="service in availableServices"
                  :key="service"
                  class="service-checkbox"
                  :class="{ disabled: !isMdServiceAvailable(service) }"
                >
                  <Checkbox
                    v-model="mdRepairTargetServices"
                    :value="service"
                    :inputId="'repair-target-' + service"
                    :disabled="!isMdServiceAvailable(service)"
                  />
                  <label :for="'repair-target-' + service" class="cursor-pointer">{{ serviceNames[service] }}</label>
                </div>
              </div>
            </div>

            <!-- 备份选项（修复用） -->
            <div class="form-group mt-3">
              <div class="flex items-center gap-2">
                <Checkbox v-model="mdBackupEnabled" :binary="true" inputId="md-repair-backup-enable" />
                <label for="md-repair-backup-enable" class="cursor-pointer">执行前备份文件</label>
              </div>
              <p class="helper-text ml-6 mt-2">
                修改前自动备份原文件到 .md_repair_backup_[时间戳] 目录
              </p>
              <div v-if="mdBackupEnabled && mdExistingBackups.length > 0" class="flex items-center gap-2 mt-2 ml-6">
                <Checkbox v-model="mdCleanOldBackups" :binary="true" inputId="md-repair-clean-backups" />
                <label for="md-repair-clean-backups" class="cursor-pointer text-sm text-muted">
                  清理旧备份 ({{ mdExistingBackups.length }} 个)
                </label>
              </div>
            </div>

            <!-- 执行修复按钮 -->
            <div class="md-repair-actions mt-4">
              <Button
                :label="hasRepairSelection ? `执行修复 (${mdSelectedReplacements.size} 个替换)` : '执行修复'"
                icon="pi pi-wrench"
                :disabled="!hasRepairSelection"
                @click="executeMdRepairOnly"
              />
              <p v-if="!hasRepairSelection" class="helper-text text-muted mt-2">
                请先在"可替换链接"区域选择要替换的链接
              </p>
            </div>
          </div>

          <Divider />

          <!-- ==================== 附加选项区域 ==================== -->
          <div class="backup-section">
            <h3 class="section-subtitle">附加选项</h3>
            <p class="section-desc mb-4">
              为单一来源的图片链接创建多图床备份，提高链接可靠性。
            </p>

            <!-- C类：可增加冗余（默认全选，无复选框） -->
            <div class="link-category-section collapsible">
              <div class="category-header clickable" @click="mdCanBackupSectionExpanded = !mdCanBackupSectionExpanded">
                <div class="header-left">
                  <i class="pi pi-shield text-purple"></i>
                  <h4>可增加冗余 ({{ mdDetectionResult.linksByCategory.canBackup.length }})</h4>
                </div>
                <i :class="mdCanBackupSectionExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
              </div>
              <p class="category-desc">以下链接仅存储在单个图床，建议备份到其他图床</p>
              <Transition name="collapse">
                <div v-if="mdCanBackupSectionExpanded" class="section-content">
                  <!-- 空状态 -->
                  <div v-if="mdDetectionResult.linksByCategory.canBackup.length === 0" class="empty-state">
                    <i class="pi pi-inbox"></i>
                    <p>暂无可增加冗余的链接</p>
                  </div>
                  <!-- 链接列表（无复选框） -->
                  <div v-else class="link-list">
                    <div
                      v-for="item in mdCanBackupPaginated"
                      :key="item.originalUrl"
                      class="link-item"
                    >
                      <div class="link-main">
                        <div class="link-url valid">
                          <i class="pi pi-check-circle"></i>
                          <span class="url-text">{{ item.originalUrl }}</span>
                        </div>
                        <div class="link-files">
                          <span class="file-badge" v-for="fp in item.filePaths.slice(0, 3)" :key="fp">{{ fp }}</span>
                          <span v-if="item.filePaths.length > 3" class="file-more">+{{ item.filePaths.length - 3 }} 更多</span>
                        </div>
                      </div>
                      <div class="link-status">
                        <Tag
                          :value="item.serviceId === 'external' ? '外部链接' : serviceNames[item.serviceId]"
                          :severity="item.serviceId === 'external' ? 'info' : undefined"
                          size="small"
                          class="cursor-pointer"
                          @click="copyLinkToClipboard(item.originalUrl)"
                          v-tooltip.top="'点击复制链接'"
                        />
                      </div>
                    </div>
                    <!-- 分页控件 -->
                    <div v-if="mdCanBackupTotalPages > 1" class="pagination-controls mt-3">
                      <Button
                        icon="pi pi-chevron-left"
                        size="small"
                        text
                        :disabled="mdCanBackupPage === 1"
                        @click="mdCanBackupPage--"
                      />
                      <span class="page-info">{{ mdCanBackupPage }} / {{ mdCanBackupTotalPages }}</span>
                      <Button
                        icon="pi pi-chevron-right"
                        size="small"
                        text
                        :disabled="mdCanBackupPage === mdCanBackupTotalPages"
                        @click="mdCanBackupPage++"
                      />
                    </div>
                  </div>
                </div>
              </Transition>
            </div>

            <!-- 当前涉及图床统计 -->
            <div v-if="canBackupServiceStats.size > 0" class="service-stats-inline mt-4 mb-3">
              <span class="stats-label">当前链接来源：</span>
              <Tag
                v-for="[serviceId, count] in canBackupServiceStats"
                :key="serviceId"
                :value="`${serviceId === 'external' ? '外部链接' : serviceNames[serviceId]}: ${count}`"
                :severity="serviceId === 'external' ? 'info' : 'secondary'"
                size="small"
                class="mr-2"
              />
            </div>

            <!-- 目标图床（备份用，移到 C 类下方） -->
            <div class="form-group mt-4">
              <label class="group-label">目标图床</label>
              <p class="helper-text">选择备份目标图床（建议避开已有的图床类型）</p>
              <div class="service-checkboxes">
                <div
                  v-for="service in availableServices"
                  :key="service"
                  class="service-checkbox"
                  :class="{ disabled: !isMdServiceAvailable(service) }"
                >
                  <Checkbox
                    v-model="mdBackupTargetServices"
                    :value="service"
                    :inputId="'backup-target-' + service"
                    :disabled="!isMdServiceAvailable(service)"
                  />
                  <label :for="'backup-target-' + service" class="cursor-pointer">{{ serviceNames[service] }}</label>
                </div>
              </div>
            </div>

            <!-- 执行上传按钮 -->
            <div class="md-repair-actions mt-4">
              <Button
                :label="`执行上传 (${actualBackupCount} 个)`"
                icon="pi pi-cloud-upload"
                :disabled="actualBackupCount === 0 || mdBackupTargetServices.length === 0"
                @click="executeMdBackup"
              />
              <p v-if="mdBackupTargetServices.length > 0 && actualBackupCount === 0" class="helper-text text-muted mt-2">
                所有链接已存在于所选图床中
              </p>
            </div>
          </div>
        </template>

        <!-- ========== 阶段 3: 执行中 ========== -->
        <template v-if="mdRepairPhase === 'executing'">
          <div class="md-repair-progress mt-4">
            <div class="progress-header">
              <span class="progress-stage">{{ mdRepairProgress?.stageText || '执行中...' }}</span>
              <span class="progress-percent">{{ mdRepairProgress?.percent || 0 }}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: (mdRepairProgress?.percent || 0) + '%' }"></div>
            </div>
            <p v-if="mdRepairProgress?.current" class="progress-current">
              {{ mdRepairProgress.current }}
            </p>
          </div>
        </template>
      </div>

      <div v-if="activeTab === 'backup'" class="settings-section">
        <div class="section-header">
          <h2>备份与同步</h2>
          <p class="section-desc">基于 WebDAV 的配置管理与数据流转服务，支持多端环境同步。</p>
        </div>

        <!-- 配置文件区域（可折叠） -->
        <div class="sub-section collapsible">
          <div class="section-header-collapsible" @click="configSectionExpanded = !configSectionExpanded">
            <div class="section-title-row">
              <h3>配置文件</h3>
              <i :class="configSectionExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
            </div>
            <p class="helper-text">包含图床密钥、cookie 及偏好设置，用于迁移配置。</p>
          </div>

          <Transition name="collapse">
            <div v-if="configSectionExpanded" class="section-content">
              <div class="backup-group">
                <span class="backup-group-label">本地</span>
                <div class="backup-actions">
                  <Button
                    @click="exportSettingsLocal"
                    :loading="exportSettingsLoading"
                    icon="pi pi-upload"
                    label="导出"
                    outlined
                    size="small"
                  />
                  <Button
                    @click="importSettingsLocal"
                    :loading="importSettingsLoading"
                    icon="pi pi-download"
                    label="导入"
                    outlined
                    size="small"
                  />
                </div>
              </div>

              <div class="backup-group">
                <span class="backup-group-label">云端</span>
                <div class="backup-actions">
                  <Button
                    @click="uploadSettingsCloud"
                    :loading="uploadSettingsLoading"
                    :disabled="!activeWebDAVProfile"
                    icon="pi pi-cloud-upload"
                    label="上传"
                    size="small"
                  />
                  <!-- 配置文件下载下拉菜单 -->
                  <div class="upload-dropdown-wrapper" ref="downloadSettingsDropdownRef">
                    <Button
                      @click.stop="toggleDownloadSettingsMenu"
                      :loading="downloadSettingsLoading"
                      :disabled="!activeWebDAVProfile"
                      icon="pi pi-cloud-download"
                      label="下载"
                      size="small"
                    />
                    <Transition name="dropdown">
                      <div v-if="downloadSettingsMenuVisible" class="upload-menu">
                        <button class="upload-menu-item" @click="downloadSettingsMerge">
                          <i class="pi pi-sync"></i>
                          <div class="menu-item-content">
                            <span class="menu-item-title">保留当前 WebDAV 配置</span>
                            <span class="menu-item-desc">其他配置采用云端 (推荐)</span>
                          </div>
                        </button>
                        <button class="upload-menu-item danger" @click="downloadSettingsOverwrite">
                          <i class="pi pi-exclamation-triangle"></i>
                          <div class="menu-item-content">
                            <span class="menu-item-title">完全覆盖本地</span>
                            <span class="menu-item-desc">丢弃所有本地配置</span>
                          </div>
                        </button>
                      </div>
                    </Transition>
                  </div>
                </div>
              </div>
              <!-- 同步状态 -->
              <div class="sync-status-line">
                <template v-if="syncStatus.configLastSync">
                  <span v-if="syncStatus.configSyncResult === 'success'" class="status-success">
                    ✓ 上次同步: {{ syncStatus.configLastSync }}
                  </span>
                  <span v-else class="status-error">
                    ✗ 同步失败: {{ syncStatus.configLastSync }} ({{ syncStatus.configSyncError }})
                  </span>
                </template>
                <span v-else class="status-pending">尚未同步</span>
              </div>
            </div>
          </Transition>
        </div>

        <Divider />

        <!-- 上传记录区域（可折叠） -->
        <div class="sub-section collapsible">
          <div class="section-header-collapsible" @click="historySectionExpanded = !historySectionExpanded">
            <div class="section-title-row">
              <h3>上传记录</h3>
              <i :class="historySectionExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"></i>
            </div>
            <p class="helper-text">图片外链与上传记录，建议定期同步确保多端一致。</p>
          </div>

          <Transition name="collapse">
            <div v-if="historySectionExpanded" class="section-content">
              <div class="backup-group">
                <span class="backup-group-label">本地</span>
                <div class="backup-actions">
                  <Button
                    @click="exportHistoryLocal"
                    :loading="exportHistoryLoading"
                    icon="pi pi-upload"
                    label="导出"
                    outlined
                    size="small"
                  />
                  <Button
                    @click="importHistoryLocal"
                    :loading="importHistoryLoading"
                    icon="pi pi-download"
                    label="导入"
                    outlined
                    size="small"
                  />
                </div>
              </div>

              <div class="backup-group">
                <span class="backup-group-label">云端</span>
                <div class="backup-actions">
                  <!-- 上传记录上传下拉菜单 -->
                  <div class="upload-dropdown-wrapper" ref="uploadHistoryDropdownRef">
                    <Button
                      @click.stop="toggleUploadHistoryMenu"
                      :loading="uploadHistoryLoading"
                      :disabled="!activeWebDAVProfile"
                      icon="pi pi-cloud-upload"
                      label="上传"
                      size="small"
                    />
                    <Transition name="dropdown">
                      <div v-if="uploadHistoryMenuVisible" class="upload-menu">
                        <button class="upload-menu-item" @click="uploadHistoryMerge">
                          <i class="pi pi-sync"></i>
                          <div class="menu-item-content">
                            <span class="menu-item-title">智能合并</span>
                            <span class="menu-item-desc">对比并合并双端差异 (推荐)</span>
                          </div>
                        </button>
                        <button class="upload-menu-item" @click="uploadHistoryIncremental">
                          <i class="pi pi-plus"></i>
                          <div class="menu-item-content">
                            <span class="menu-item-title">仅上传新增</span>
                            <span class="menu-item-desc">只上传云端没有的记录</span>
                          </div>
                        </button>
                        <button class="upload-menu-item danger" @click="uploadHistoryForce">
                          <i class="pi pi-exclamation-triangle"></i>
                          <div class="menu-item-content">
                            <span class="menu-item-title">强制覆盖云端</span>
                            <span class="menu-item-desc">丢弃云端数据，以本地为准</span>
                          </div>
                        </button>
                      </div>
                    </Transition>
                  </div>
                  <!-- 上传记录下载下拉菜单 -->
                  <div class="upload-dropdown-wrapper" ref="downloadHistoryDropdownRef">
                    <Button
                      @click.stop="toggleDownloadHistoryMenu"
                      :loading="downloadHistoryLoading"
                      :disabled="!activeWebDAVProfile"
                      icon="pi pi-cloud-download"
                      label="下载"
                      size="small"
                    />
                    <Transition name="dropdown">
                      <div v-if="downloadHistoryMenuVisible" class="upload-menu">
                        <button class="upload-menu-item" @click="downloadHistoryMerge">
                          <i class="pi pi-sync"></i>
                          <div class="menu-item-content">
                            <span class="menu-item-title">智能合并</span>
                            <span class="menu-item-desc">与本地记录合并 (推荐)</span>
                          </div>
                        </button>
                        <button class="upload-menu-item danger" @click="downloadHistoryOverwrite">
                          <i class="pi pi-exclamation-triangle"></i>
                          <div class="menu-item-content">
                            <span class="menu-item-title">覆盖本地</span>
                            <span class="menu-item-desc">丢弃本地数据，以云端为准</span>
                          </div>
                        </button>
                      </div>
                    </Transition>
                  </div>
                </div>
              </div>
              <!-- 同步状态 -->
              <div class="sync-status-line">
                <template v-if="syncStatus.historyLastSync">
                  <span v-if="syncStatus.historySyncResult === 'success'" class="status-success">
                    ✓ 上次同步: {{ syncStatus.historyLastSync }}
                  </span>
                  <span v-else class="status-error">
                    ✗ 同步失败: {{ syncStatus.historyLastSync }} ({{ syncStatus.historySyncError }})
                  </span>
                </template>
                <span v-else class="status-pending">尚未同步</span>
              </div>
            </div>
          </Transition>
        </div>

        <Divider />

        <!-- WebDAV 配置区域（放在最底下） -->
        <div class="sub-section">
          <h3>WebDAV 配置</h3>

          <!-- 配置切换卡片 -->
          <div class="webdav-profile-tabs">
            <button
              v-for="profile in formData.webdav.profiles"
              :key="profile.id"
              class="profile-tab"
              :class="{ active: formData.webdav.activeId === profile.id }"
              @click="switchWebDAVProfile(profile.id)"
            >
              <span class="profile-indicator"></span>
              <span>{{ profile.name }}</span>
            </button>
            <button class="profile-tab add-btn" @click="addWebDAVProfile">
              <i class="pi pi-plus"></i>
            </button>
          </div>

          <!-- 当前配置表单 -->
          <div v-if="activeWebDAVProfile" class="webdav-form">
            <div class="form-grid">
              <div class="form-item">
                <label>配置名称</label>
                <InputText v-model="activeWebDAVProfile.name" @blur="saveSettings" placeholder="如：坚果云、群晖 NAS" />
              </div>
              <div class="form-item">
                <label>服务器 URL</label>
                <InputText v-model="activeWebDAVProfile.url" @blur="saveSettings" placeholder="https://dav.example.com" />
              </div>
              <div class="form-item">
                <label>用户名</label>
                <InputText v-model="activeWebDAVProfile.username" @blur="saveSettings" />
              </div>
              <div class="form-item">
                <label>密码</label>
                <Password v-model="activeWebDAVProfile.password" @blur="saveSettings" :feedback="false" toggleMask />
              </div>
              <div class="form-item span-full">
                <label>远程路径</label>
                <InputText v-model="activeWebDAVProfile.remotePath" @blur="saveSettings" placeholder="/PicNexus/" />
              </div>
            </div>
            <div class="webdav-actions-row">
              <Button label="测试连接" icon="pi pi-check" @click="testActiveWebDAV" :loading="testingConnections.webdav" outlined size="small" />
              <Button label="删除此配置" icon="pi pi-trash" @click="deleteWebDAVProfile(activeWebDAVProfile.id)" severity="danger" text size="small" />
            </div>
          </div>

          <!-- 无配置提示 -->
          <div v-else class="empty-webdav">
            <p>尚未配置 WebDAV 连接</p>
            <Button label="添加配置" icon="pi pi-plus" @click="addWebDAVProfile" outlined />
          </div>
        </div>

        <Divider />

        <!-- 自动同步配置 -->
        <div class="sub-section">
          <h3>自动同步</h3>
          <p class="helper-text">定时自动备份配置和历史记录到云端。</p>

          <!-- 未配置 WebDAV 提示 -->
          <div v-if="!activeWebDAVProfile" class="auto-sync-warning">
            <i class="pi pi-info-circle"></i>
            <span>请先配置 WebDAV 连接后才能使用自动同步</span>
          </div>

          <!-- 自动同步表单 -->
          <div v-else class="auto-sync-form">
            <!-- 启用开关行 -->
            <div class="auto-sync-toggle">
              <span class="toggle-label-text">启用自动同步</span>
              <ToggleSwitch
                :modelValue="autoSyncConfig.enabled"
                @update:modelValue="handleAutoSyncToggle"
              />
            </div>

            <!-- 同步状态行 -->
            <div v-if="isAutoSyncEnabled" class="auto-sync-status-line">
              <span class="status-item">
                <span class="status-label">上次自动同步:</span>
                <span v-if="lastAutoSync" :class="['status-value', autoSyncLastResult === 'success' ? 'success' : autoSyncLastResult === 'failed' ? 'error' : 'partial']">
                  {{ lastAutoSync.toLocaleString() }}
                  <template v-if="autoSyncLastResult === 'success'"> ✓</template>
                  <template v-else-if="autoSyncLastResult === 'partial'"> (部分成功)</template>
                  <template v-else-if="autoSyncLastResult === 'failed'"> ✗</template>
                </span>
                <span v-else class="status-value muted">暂无</span>
              </span>
              <span class="status-separator">|</span>
              <span class="status-item">
                <span class="status-label">下次同步:</span>
                <span v-if="isAutoSyncing" class="status-value syncing">
                  <i class="pi pi-spin pi-spinner"></i> 同步中...
                </span>
                <span v-else-if="remainingTimeFormatted" class="status-value">{{ remainingTimeFormatted }}</span>
              </span>
            </div>

            <!-- 同步间隔设置 -->
            <div v-if="autoSyncConfig.enabled" class="auto-sync-interval-row">
              <label>同步间隔（小时）</label>
              <div class="interval-input">
                <InputText
                  type="number"
                  :modelValue="autoSyncConfig.intervalHours"
                  @update:modelValue="(val: string | number) => handleAutoSyncIntervalChange(Number(val))"
                  :min="1"
                  :max="720"
                />
                <span class="interval-hint">1 ~ 720 小时</span>
              </div>
            </div>

            <!-- 立即同步下拉菜单 -->
            <div v-if="autoSyncConfig.enabled" class="auto-sync-actions">
              <div class="upload-dropdown-wrapper" ref="syncNowDropdownRef">
                <Button
                  @click.stop="toggleSyncNowMenu"
                  :loading="isAutoSyncing"
                  icon="pi pi-sync"
                  label="立即同步"
                  size="small"
                  outlined
                />
                <Transition name="dropdown">
                  <div v-if="syncNowMenuVisible" class="upload-menu">
                    <button class="upload-menu-item" @click="syncNowAll">
                      <i class="pi pi-cloud-upload"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">同步全部</span>
                        <span class="menu-item-desc">上传配置和上传记录 (推荐)</span>
                      </div>
                    </button>
                    <button class="upload-menu-item" @click="syncNowSettingsOnly">
                      <i class="pi pi-cog"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">仅同步配置</span>
                        <span class="menu-item-desc">只上传应用配置文件</span>
                      </div>
                    </button>
                    <button class="upload-menu-item" @click="syncNowHistoryOnly">
                      <i class="pi pi-history"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">仅同步上传记录</span>
                        <span class="menu-item-desc">智能合并上传记录</span>
                      </div>
                    </button>
                  </div>
                </Transition>
              </div>
            </div>
          </div>
        </div>
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
  width: 240px;
  background-color: var(--bg-card);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
}

.nav-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.nav-item:hover {
  background-color: var(--hover-overlay-subtle);
  color: var(--text-primary);
}

.nav-item.active {
  background-color: rgba(59, 130, 246, 0.1);
  color: var(--primary);
  font-weight: 600;
}

.nav-item i {
  font-size: 16px;
}

.nav-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  padding: 16px 12px 6px;
  letter-spacing: 0.05em;
}

.nav-separator {
  height: 1px;
  background-color: var(--border-subtle);
  margin: 8px 12px;
  opacity: 0.5;
}

.sidebar-footer {
  padding: 16px;
  border-top: 1px solid var(--border-subtle);
  text-align: center;
}

.version-text {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* === 内容区域 === */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 32px 48px;
}

.settings-section {
  max-width: 800px; /* 限制内容最大宽度以保证可读性 */
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

.section-header {
  margin-bottom: 32px;
}

.section-header h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.section-desc {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

/* 表单通用样式 */
.form-group {
  margin-bottom: 24px;
}

.group-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.helper-text {
  font-size: 13px;
  color: var(--text-muted);
  margin: -4px 0 12px 0;
}

/* Grid Layout for Forms */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-item.span-full {
  grid-column: 1 / -1;
}

.form-item label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

/* 主题卡片 */
.theme-options {
  display: flex;
  gap: 16px;
}

.theme-card {
  flex: 1;
  padding: 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background-color: var(--bg-card);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: all 0.2s;
  color: var(--text-secondary);
}

.theme-card:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.theme-card.active {
  border-color: var(--primary);
  background-color: rgba(59, 130, 246, 0.05);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--primary);
}

/* Service Toggles */
.service-toggles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.toggle-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-chip:hover {
  border-color: var(--text-muted);
}

.toggle-chip label {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
}

/* Info Blocks & Flat Cards */
.info-block {
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.info-block.warning {
  background-color: rgba(234, 179, 8, 0.1);
  color: var(--warning);
  border: 1px solid rgba(234, 179, 8, 0.2);
}

.info-block.success {
  background-color: rgba(16, 185, 129, 0.1);
  color: var(--success);
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.info-block.danger {
  background-color: rgba(239, 68, 68, 0.1);
  color: var(--error);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.service-card-flat {
  display: flex;
  gap: 16px;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  margin-bottom: 16px;
  align-items: flex-start;
}

.sc-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--bg-input);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 20px;
  flex-shrink: 0;
}

.sc-content h3 {
  margin: 0 0 4px 0;
  font-size: 15px;
  color: var(--text-primary);
}

.sc-content p {
  margin: 0 0 8px 0;
  font-size: 13px;
  color: var(--text-secondary);
}

/* 子章节 */
.sub-section {
  margin-bottom: 24px;
}

.sub-section h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px 0;
}

/* 链接前缀 */
.prefix-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prefix-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Utility */
.w-full { width: 100%; }
.mt-2 { margin-top: 8px; }
.mt-4 { margin-top: 16px; }
.mb-2 { margin-bottom: 8px; }
.mb-4 { margin-bottom: 16px; }
.gap-2 { gap: 8px; }
.mono-input { font-family: var(--font-mono); font-size: 13px; }
.flex { display: flex; }
.flex-1 { flex: 1; }
.justify-between { justify-content: space-between; }
.items-center { align-items: center; }
.text-muted { color: var(--text-muted); }
.font-medium { font-weight: 500; }
.cursor-pointer { cursor: pointer; }

/* Actions */
.actions-row {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.actions-mini {
  display: flex;
  gap: 4px;
}

/* 服务分组样式（常规设置中的启用选择器） */
.service-group-section {
  margin-bottom: 16px;
}

.service-group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

/* 公共图床配置页分组样式 */
.public-group {
  margin-bottom: 8px;
}

.public-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.public-group-header i {
  color: var(--primary);
}

.service-cards-row {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.service-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

/* ========== 备份与同步样式 ========== */
.sub-section h3 {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sub-section h3 i {
  color: var(--primary);
  font-size: 14px;
}

.backup-group {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.backup-group:last-child {
  border-bottom: none;
}

.backup-group-label {
  width: 100px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.backup-actions {
  display: flex;
  gap: 8px;
}

.backup-status {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}

/* ========== 历史记录上传下拉菜单 ========== */
.upload-dropdown-wrapper {
  position: relative;
  display: inline-block;
}

.upload-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 260px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}

.upload-menu-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s;
}

.upload-menu-item:hover {
  background: var(--hover-overlay-subtle);
}

.upload-menu-item:not(:last-child) {
  border-bottom: 1px solid var(--border-subtle);
}

.upload-menu-item i {
  font-size: 16px;
  color: var(--primary);
  margin-top: 2px;
  flex-shrink: 0;
}

.menu-item-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menu-item-title {
  font-size: 13px;
  font-weight: 500;
}

.menu-item-desc {
  font-size: 11px;
  color: var(--text-muted);
}

/* 危险操作菜单项 */
.upload-menu-item.danger {
  color: var(--error);
}

.upload-menu-item.danger i {
  color: var(--error);
}

.upload-menu-item.danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

/* ========== WebDAV 配置区域 ========== */
.webdav-profile-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.profile-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
}

.profile-tab:hover {
  border-color: var(--primary);
  color: var(--text-primary);
}

.profile-tab.active {
  border-color: var(--primary);
  background: rgba(59, 130, 246, 0.1);
  color: var(--primary);
}

.profile-tab .profile-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}

.profile-tab.active .profile-indicator {
  background: var(--primary);
}

.profile-tab.add-btn {
  border-style: dashed;
  padding: 8px 12px;
}

.profile-tab.add-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.webdav-form {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 20px;
}

.webdav-actions-row {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.empty-webdav {
  text-align: center;
  padding: 32px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-radius: 8px;
}

.empty-webdav p {
  margin-bottom: 16px;
}

/* ========== 自动同步样式 ========== */
.auto-sync-form {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 20px;
}

.auto-sync-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toggle-label-text {
  font-weight: 500;
  font-size: 14px;
  color: var(--text-primary);
}

/* 同步状态行 */
.auto-sync-status-line {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.auto-sync-status-line .status-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.auto-sync-status-line .status-label {
  color: var(--text-muted);
}

.auto-sync-status-line .status-value {
  color: var(--text-primary);
}

.auto-sync-status-line .status-value.success {
  color: var(--success-color, #10b981);
}

.auto-sync-status-line .status-value.error {
  color: var(--error-color, #ef4444);
}

.auto-sync-status-line .status-value.partial {
  color: var(--warning-color, #f59e0b);
}

.auto-sync-status-line .status-value.muted {
  color: var(--text-muted);
}

.auto-sync-status-line .status-value.syncing {
  color: var(--primary);
}

.auto-sync-status-line .status-value.syncing .pi-spinner {
  margin-right: 4px;
}

.auto-sync-status-line .status-separator {
  color: var(--border-subtle);
}

/* 同步间隔设置行 */
.auto-sync-interval-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.auto-sync-interval-row label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

.interval-input {
  display: flex;
  align-items: center;
  gap: 8px;
}

.interval-input :deep(.p-inputtext) {
  width: 80px;
}

.interval-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.auto-sync-actions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.auto-sync-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background-color: var(--warning-bg, rgba(245, 158, 11, 0.1));
  border-radius: 8px;
  font-size: 13px;
  color: var(--warning-color, #f59e0b);
}

.auto-sync-warning .pi {
  font-size: 16px;
}

/* ========== 同步状态样式 ========== */
.sync-status-line {
  margin-top: 12px;
  font-size: 12px;
  font-family: var(--font-mono);
}

/* ========== 可折叠区域样式 ========== */
.sub-section.collapsible {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 0 16px;
  margin-bottom: 0;
}

.section-header-collapsible {
  cursor: pointer;
  padding: 16px 0;
  user-select: none;
}

.section-header-collapsible:hover {
  opacity: 0.8;
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.section-title-row h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.section-title-row i {
  color: var(--text-muted);
  font-size: 14px;
  transition: transform 0.2s;
}

.section-content {
  padding-bottom: 16px;
}

/* 折叠过渡动画 */
.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.25s ease;
  overflow: hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  max-height: 0;
  padding-bottom: 0;
}

.collapse-enter-to,
.collapse-leave-from {
  opacity: 1;
  max-height: 500px;
}

.status-success {
  color: var(--success);
}

.status-error {
  color: var(--error);
}

.status-pending {
  color: var(--text-muted);
}

/* 下拉菜单过渡动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Password 组件眼睛图标放入框内 */
:deep(.p-password) {
  position: relative;
  display: flex;
  width: 100%;
}

:deep(.p-password .p-password-input) {
  width: 100%;
  padding-right: 40px; /* 为眼睛图标留出空间 */
}

:deep(.p-password .p-password-toggle-mask-btn) {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}

:deep(.p-password .p-password-toggle-mask-btn:hover) {
  color: var(--text-main);
}

/* 可点击的状态 Tag */
.clickable-tag {
  cursor: pointer;
}

/* ========== 隐私设置样式 ========== */
.privacy-setting {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 16px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.setting-info {
  flex: 1;
}

.setting-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.setting-desc {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.mono-input {
  font-family: var(--font-mono);
}

/* ========== Markdown 修复样式 ========== */

/* 运行模式选项 */
.mode-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.mode-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-option:hover {
  background: var(--hover-overlay-subtle);
}

.mode-option.active {
  border-color: var(--primary);
  background: rgba(59, 130, 246, 0.05);
}

.mode-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mode-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
}

.mode-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.mode-tag {
  flex-shrink: 0;
}

/* 图床复选框 */
.service-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 8px;
}

.service-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 修复操作按钮 */
.md-repair-actions {
  margin-top: 16px;
}

/* 进度条样式 */
.md-repair-progress {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 16px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.progress-stage {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.progress-percent {
  font-size: 13px;
  color: var(--primary);
  font-weight: 600;
  font-family: var(--font-mono);
}

.progress-bar {
  height: 6px;
  background: var(--bg-input);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-current {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 结果统计样式 */
.md-repair-result {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 16px;
}

.result-header h4 {
  margin: 0 0 16px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.result-stats {
  display: grid;
  gap: 12px;
}

.result-stats.cols-5 {
  grid-template-columns: repeat(5, 1fr);
}

.result-stats.cols-6 {
  grid-template-columns: repeat(6, 1fr);
}

.stat-card {
  text-align: center;
  padding: 12px 8px;
  background: var(--bg-card);
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  font-family: var(--font-mono);
  margin-bottom: 4px;
}

.stat-label {
  font-size: 11px;
  color: var(--text-muted);
}

.stat-card.text-green .stat-value {
  color: var(--success);
}

.stat-card.text-blue .stat-value {
  color: var(--primary);
}

.stat-card.text-purple .stat-value {
  color: #a855f7;
}

.stat-card.text-orange .stat-value {
  color: var(--warning);
}

.stat-card.text-red .stat-value {
  color: var(--danger);
}

/* 链接分类区域 */
.link-category-section {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 16px;
}

.link-category-section.collapsible {
  /* 可折叠区域样式 */
}

.category-header {
  margin-bottom: 12px;
}

.category-header.clickable {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
  margin-bottom: 0;
  padding: 4px 0;
  transition: opacity 0.15s;
}

.category-header.clickable:hover {
  opacity: 0.8;
}

.category-header.clickable > i {
  color: var(--text-muted);
  font-size: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-left h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-left > i {
  font-size: 16px;
}

.category-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.category-header h4 i {
  font-size: 16px;
}

.category-desc {
  margin: 4px 0 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.section-content {
  margin-top: 12px;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--text-muted);
}

.empty-state i {
  font-size: 32px;
  margin-bottom: 8px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-size: 13px;
}

/* 可点击的 Tag */
.clickable-tag {
  cursor: pointer;
}

/* 禁用状态 */
.service-checkbox.disabled {
  opacity: 0.6;
}

.service-checkbox.disabled label {
  cursor: not-allowed;
}

/* 链接列表 */
.link-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.link-list.compact {
  gap: 8px;
}

.link-item {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 12px;
}

.link-item.compact {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
}

.link-main {
  flex: 1;
  min-width: 0;
}

.link-url {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-family: var(--font-mono);
}

.link-url.broken {
  color: var(--danger);
}

.link-url.broken i {
  color: var(--danger);
}

.link-url.valid {
  color: var(--success);
}

.link-url.valid i {
  color: var(--success);
}

.url-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.url-text.clickable {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
}

.url-text.clickable:hover {
  text-decoration-style: solid;
}

.link-files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.file-badge {
  font-size: 10px;
  padding: 2px 6px;
  background: var(--bg-input);
  border-radius: 4px;
  color: var(--text-muted);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-more {
  font-size: 10px;
  color: var(--text-muted);
  padding: 2px 4px;
}

/* 替换选项 */
.link-replacements {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.replacement-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 6px;
  display: block;
}

.replacement-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.replacement-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-input);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.replacement-option:hover {
  background: var(--hover-overlay-subtle);
}

.replacement-option.selected {
  border-color: var(--primary);
  background: rgba(59, 130, 246, 0.08);
}

.rep-url {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-status {
  margin-top: 8px;
}

/* 执行区域 */
.execute-section h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

/* 结果操作栏 */
.result-actions-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 当前检测路径 */
.current-path {
  font-size: 0.875rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}

/* 附加选项区域标题 */
.section-subtitle {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

/* 图床统计信息（简化内联样式） */
.service-stats-inline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.service-stats-inline .stats-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

/* 文本颜色工具类 */
.text-blue {
  color: var(--primary);
}

.text-orange {
  color: var(--warning);
}

.text-purple {
  color: #a855f7;
}

.text-muted {
  color: var(--text-muted);
}

.text-sm {
  font-size: 12px;
}

.ml-6 {
  margin-left: 24px;
}
</style>
