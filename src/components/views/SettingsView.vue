<script setup lang="ts">
// 设置视图 - 重构后精简版
// 核心逻辑保留，UI 组件拆分到独立面板

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { useToast } from '../../composables/useToast';
import { TOAST_MESSAGES } from '../../constants';
import { useConfirm } from '../../composables/useConfirm';
import { useThemeManager } from '../../composables/useTheme';
import { useConfigManager } from '../../composables/useConfig';
import { useHistoryManager } from '../../composables/useHistory';
import { useAnalytics } from '../../composables/useAnalytics';
import { createDefaultAutoSyncConfig, type AutoSyncConfig } from '../../composables/useAutoSync';
import { useServiceAvailability } from '../../composables/useServiceAvailability';
import { SERVICE_DISPLAY_NAMES } from '../../constants/serviceNames';

// 组件
import HostingSettingsPanel from '../settings/HostingSettingsPanel.vue';
import GeneralSettingsPanel from '../settings/GeneralSettingsPanel.vue';
import AdvancedSettingsPanel from '../settings/AdvancedSettingsPanel.vue';
import BackupSyncPanel from '../settings/BackupSyncPanel.vue';

import { Store } from '../../store';
import type { ThemeMode, UserConfig, ServiceType, WebDAVProfile } from '../../config/types';
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

// ==================== 存储实例 ====================

const configStore = new Store('.settings.dat');

// ==================== 状态 ====================

const cookieUnlisten = ref<UnlistenFn | null>(null);
const appVersion = ref<string>('');
const isClearingCache = ref(false);

// 导航状态
type SettingsTab = 'general' | 'hosting' | 'advanced' | 'backup';
const activeTab = ref<SettingsTab>('general');

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
  github: { token: '', owner: '', repo: '', branch: 'main', path: 'images/' },
  imgur: { clientId: '', clientSecret: '' },
  webdav: { profiles: [] as WebDAVProfile[], activeId: null as string | null },
  linkPrefixEnabled: true,
  selectedPrefixIndex: 0,
  linkPrefixList: [...DEFAULT_PREFIXES],
  analyticsEnabled: true,
  defaultHistoryViewMode: 'grid' as 'table' | 'grid'
});

// 测试连接状态
const testingConnections = ref<Record<string, boolean>>({
  weibo: false, r2: false, tencent: false, aliyun: false, qiniu: false, upyun: false,
  nowcoder: false, zhihu: false, nami: false, bilibili: false, chaoxing: false,
  smms: false, github: false, imgur: false, webdav: false
});

// 可用服务列表
const availableServices = ref<ServiceType[]>([]);

// 图床名称映射（基于常量，覆盖部分显示名称以适应 UI）
const serviceNames: Record<ServiceType, string> = {
  ...SERVICE_DISPLAY_NAMES,
  r2: 'R2',  // 设置界面使用简短名称
};

// 自动同步配置
const autoSyncConfig = ref<AutoSyncConfig>(createDefaultAutoSyncConfig());

// ==================== 计算属性 ====================

const activeWebDAVProfile = computed(() => {
  return formData.value.webdav.profiles.find(p => p.id === formData.value.webdav.activeId) || null;
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

    formData.value.analyticsEnabled = config.analytics?.enabled ?? true;
    formData.value.defaultHistoryViewMode = config.defaultHistoryViewMode || 'grid';
    availableServices.value = config.availableServices || ['jd', 'qiyu'];

    // 自动同步配置
    if (config.autoSync) {
      autoSyncConfig.value = config.autoSync;
    }
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

    config.analytics = { enabled: formData.value.analyticsEnabled };
    config.defaultHistoryViewMode = formData.value.defaultHistoryViewMode;
    config.availableServices = availableServices.value;
    config.autoSync = autoSyncConfig.value;

    await configStore.set('config', config);
    await configStore.save();
    await configManager.loadConfig();
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

async function testS3Connection(serviceId: ServiceType) {
  const config = formData.value[serviceId as keyof typeof formData.value] as any;
  try {
    await invoke('test_s3_connection', { serviceId, config });
    toast.showConfig('success', TOAST_MESSAGES.auth.configValid(serviceNames[serviceId]));
  } catch (error) {
    toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed(serviceNames[serviceId], String(error)));
    throw error;
  }
}

async function testConn(fn: () => Promise<void>, key: string) {
  testingConnections.value[key] = true;
  try {
    await fn();
  } finally {
    testingConnections.value[key] = false;
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
};

async function handleS3Test(serviceId: string) {
  await testConn(actions[serviceId], serviceId);
}

async function handleTokenTest(serviceId: string) {
  await testConn(actions[serviceId], serviceId);
}

async function handleCookieTest(serviceId: string) {
  testingConnections.value[serviceId] = true;
  try {
    const fd = formData.value as any;
    const cookie = serviceId === 'weibo' ? fd.weiboCookie : fd[serviceId]?.cookie;
    await invoke('test_cookie_connection', { serviceId, cookie });
    toast.showConfig('success', TOAST_MESSAGES.auth.cookieValid(serviceNames[serviceId as ServiceType]));
  } catch (e) {
    toast.showConfig('error', TOAST_MESSAGES.auth.testFailed(String(e)));
  } finally {
    testingConnections.value[serviceId] = false;
  }
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
    const result = await invoke<boolean>('test_webdav_connection', {
      url: profile.url,
      username: profile.username,
      password: profile.password
    });
    if (result) {
      toast.showConfig('success', TOAST_MESSAGES.auth.success('WebDAV'));
    } else {
      toast.showConfig('error', TOAST_MESSAGES.auth.failed('WebDAV'));
    }
  } catch (e) {
    toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed('WebDAV', String(e)));
  } finally {
    testingConnections.value.webdav = false;
  }
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

// ==================== 生命周期 ====================

onMounted(async () => {
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
        <span class="version-text">v{{ appVersion }}</span>
      </div>
    </div>

    <div class="settings-content">
      <!-- 常规设置 -->
      <div v-if="activeTab === 'general'" class="settings-section">
        <GeneralSettingsPanel
          :current-theme="currentTheme"
          :available-services="availableServices"
          :default-history-view-mode="formData.defaultHistoryViewMode"
          :service-names="serviceNames"
          @update:current-theme="handleThemeChange"
          @update:available-services="(v) => { availableServices = v; saveSettings(); }"
          @update:default-history-view-mode="(v) => { formData.defaultHistoryViewMode = v; saveSettings(); }"
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
          @save="saveSettings"
          @test-private="handleS3Test"
          @test-token="handleTokenTest"
          @test-cookie="handleCookieTest"
          @check-builtin="handleBuiltinCheck"
          @login-cookie="handleCookieLogin"
        />
      </div>

      <!-- 高级设置 -->
      <div v-if="activeTab === 'advanced'" class="settings-section">
        <AdvancedSettingsPanel
          :link-prefix-enabled="formData.linkPrefixEnabled"
          :prefix-list="formData.linkPrefixList"
          :selected-prefix-index="formData.selectedPrefixIndex"
          :analytics-enabled="formData.analyticsEnabled"
          :is-clearing-cache="isClearingCache"
          @update:link-prefix-enabled="(v) => { formData.linkPrefixEnabled = v; saveSettings(); }"
          @update:prefix-list="(v) => { formData.linkPrefixList = v; }"
          @update:selected-prefix-index="(v) => { formData.selectedPrefixIndex = v; saveSettings(); }"
          @update:analytics-enabled="(v) => { formData.analyticsEnabled = v; handleAnalyticsToggle(); }"
          @save="saveSettings"
          @add-prefix="addPrefix"
          @remove-prefix="removePrefix"
          @reset-to-default="resetToDefaultPrefixes"
          @clear-history="handleClearHistory"
          @clear-cache="handleClearAppCache"
        />
      </div>

      <!-- 备份与同步 -->
      <div v-if="activeTab === 'backup'" class="settings-section">
        <BackupSyncPanel
          :webdav-config="formData.webdav"
          :auto-sync-config="autoSyncConfig"
          @update:webdav-config="(v) => { formData.webdav = v; saveSettings(); }"
          @update:auto-sync-config="(v) => { autoSyncConfig = v; saveSettings(); }"
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
  background-color: var(--bg-card);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-title {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle);
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
  gap: 2px;
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
  border-radius: 6px;
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
  background-color: rgba(59, 130, 246, 0.1);
  color: var(--primary);
  font-weight: 600;
}

.nav-item.active .nav-icon {
  color: var(--primary);
}

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-subtle);
  text-align: center;
}

.version-text {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  opacity: 0.7;
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
