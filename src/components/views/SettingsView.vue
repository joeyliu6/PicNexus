<script setup lang="ts">
// 设置视图 - 逻辑已拆分至 composables/settings/
// 本组件仅负责：tab 导航、事件编排、面板 props 传递

import { ref, watch, inject, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { useToast } from '../../composables/useToast';
import { TOAST_MESSAGES } from '../../constants';
import { useThemeManager } from '../../composables/useTheme';
import { useConfigManager } from '../../composables/useConfig';
import { useHistoryManager } from '../../composables/useHistory';
import { useAnalytics } from '../../composables/useAnalytics';
import { useOnboarding } from '../../composables/useOnboarding';
import { useSettingsForm } from '../../composables/settings/useSettingsForm';
import { useConnectionTest } from '../../composables/settings/useConnectionTest';
import { useEditorIntegration } from '../../composables/settings/useEditorIntegration';
import { useSettingsReset } from '../../composables/settings/useSettingsReset';

import HostingSettingsPanel from '../settings/HostingSettingsPanel.vue';
import GeneralSettingsPanel from '../settings/GeneralSettingsPanel.vue';
import AdvancedSettingsPanel from '../settings/AdvancedSettingsPanel.vue';
import BackupSyncPanel from '../settings/BackupSyncPanel.vue';
import AboutUpdatePanel from '../settings/AboutUpdatePanel.vue';

import { configStore } from '../../store/instances';
import type { ThemeMode, UserConfig, ServiceType, ImageCompressionConfig, EditorServerConfig } from '../../config/types';

const toast = useToast();
const { currentTheme, setTheme } = useThemeManager();
const configManager = useConfigManager();
const historyManager = useHistoryManager();
const analytics = useAnalytics();
const { reopen: reopenOnboarding } = useOnboarding();

// ---- Composables ----

const {
  formData, isSettingsReady, availableServices, serviceNames, serviceConfigStatus,
  loadSettings, saveSettings, debouncedSaveSettings, debouncedSaveSettingsWithStatus,
  cancelDebouncedSave, errorToString, validateS3Config, clearTimers: clearFormTimers,
  resetToDefaultSettings,
  addPrefix, updatePrefix, removePrefix, resetToDefaultPrefixes,
  addCustomS3Profile, deleteCustomS3Profile, updateCustomS3Profile,
  addWebDAVProfile, deleteWebDAVProfile, switchWebDAVProfile,
} = useSettingsForm();

const {
  qiyuAvailable, jdAvailable, isCheckingQiyu, isCheckingJd,
  testingConnections, activeSession, visibleRefreshingServiceIds,
  isBatchTesting, batchTestProgress, batchTestCompletionKey,
  handleServiceTest, handleBuiltinCheck, testAllConfiguredServices, cancelBatchTest,
} = useConnectionTest({
  formData, serviceNames,
  errorToString, validateS3Config,
});

const { applyEditorServer, clearTimer: clearEditorTimer } = useEditorIntegration({
  formData, isSettingsReady, errorToString,
});

const { isResettingDefaults, handleResetDefaults } = useSettingsReset({
  formData,
  cancelDebouncedSave,
  resetToDefaultSettings,
  loadSettings,
  errorToString,
  applyEditorServer,
});

// ---- 导航 ----

type SettingsTab = 'general' | 'hosting' | 'advanced' | 'backup' | 'about';
const activeTab = ref<SettingsTab>('general');
const settingsTargetTab = inject<import('vue').Ref<string | null>>('settingsTargetTab');
const settingsTargetSection = inject<import('vue').Ref<string | null>>('settingsTargetSection');
const targetCardId = ref<string | null>(null);

const applyHostingTargetSection = () => {
  const section = settingsTargetSection?.value;
  if (!section) return;

  const pendingTab = settingsTargetTab?.value;
  if (pendingTab && pendingTab !== 'hosting') return;
  if (!pendingTab && activeTab.value !== 'hosting') return;

  settingsTargetSection.value = null;
  targetCardId.value = section;
};

const applyTargetTab = () => {
  if (!settingsTargetTab?.value) {
    applyHostingTargetSection();
    return;
  }
  const val = settingsTargetTab.value;
  settingsTargetTab.value = null;
  if (val === 'compression' || val === 'editor') { activeTab.value = 'advanced'; return; }
  const validTabs: SettingsTab[] = ['general', 'hosting', 'advanced', 'backup', 'about'];
  if (validTabs.includes(val as SettingsTab)) activeTab.value = val as SettingsTab;
  applyHostingTargetSection();
};

onActivated(() => {
  applyTargetTab();
  applyHostingTargetSection();
});
onDeactivated(() => { clearFormTimers(); clearEditorTimer(); });
if (settingsTargetTab) { watch(settingsTargetTab, (val) => { if (val) applyTargetTab(); }); }
if (settingsTargetSection) { watch(settingsTargetSection, (val) => { if (val) applyHostingTargetSection(); }); }

// ---- UI 状态 ----

const cookieUnlisten = ref<UnlistenFn | null>(null);
const compressionSyncUnlisten = ref<UnlistenFn | null>(null);
const appVersion = ref('');
const executablePath = ref('');
const isClearingCache = ref(false);
const webdavTesting = ref(false);

const navGroups = [{
  items: [
    { id: 'general' as SettingsTab, label: '常规设置', icon: 'pi pi-cog' },
    { id: 'hosting' as SettingsTab, label: '图床设置', icon: 'pi pi-images' },
    { id: 'advanced' as SettingsTab, label: '高级设置', icon: 'pi pi-sliders-h' },
    { id: 'backup' as SettingsTab, label: '备份与同步', icon: 'pi pi-database' },
    { id: 'about' as SettingsTab, label: '关于与更新', icon: 'pi pi-info-circle' },
  ]
}];

// ---- 事件处理 ----

async function handleThemeChange(mode: ThemeMode) {
  try { await setTheme(mode); }
  catch (e) { toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(String(e))); }
}

async function handleAutoStartChange(enabled: boolean) {
  // Why: OS 侧（autostart 插件）与磁盘配置必须同步落地。旧逻辑把 saveSettings 放在
  //   try/catch 外，invoke 成功但 saveSettings 失败时会出现"OS 已改、disk 未改"漂移，
  //   重启后 initialize 读旧 config 又尝试改 OS 状态，形成二次不一致。
  // saveSettings 内部吞异常，以 boolean 返回成败；所以这里用返回值而非 try/catch。
  const prev = formData.value.appBehavior.autoStart;
  formData.value.appBehavior.autoStart = enabled;
  try {
    await invoke(enabled ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
  } catch (e) {
    toast.showConfig('error', TOAST_MESSAGES.config.saveFailed(String(e)));
    formData.value.appBehavior.autoStart = prev;
    return;
  }
  const saved = await saveSettings();
  if (!saved) {
    // 磁盘写入失败：回滚 OS 状态以保持一致（saveSettings 已 toast 过错误原因）
    try {
      await invoke(prev ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
    } catch (e) {
      // 回滚也失败 → OS 与磁盘配置已不一致，必须告知用户
      // Why: 静默吞异常会让用户后续重启时遇到"我明明关了为什么还自启"的迷惑
      toast.showConfig('error', {
        summary: '自启动状态不一致',
        detail: `操作系统与配置文件状态可能不同步：${String(e)}。建议重启应用后手动调整。`,
        life: 8000,
      });
    }
    formData.value.appBehavior.autoStart = prev;
  }
}

async function handleCloseToTrayChange(enabled: boolean) {
  formData.value.appBehavior.closeToTray = enabled;
  await invoke('set_close_to_tray', { enabled });
  saveSettings();
}

function handleAnalyticsToggle() {
  if (formData.value.analyticsEnabled) {
    analytics.enable();
  } else {
    analytics.disable();
  }
  saveSettings();
}

async function handleClearAppCache() {
  isClearingCache.value = true;
  try {
    await getCurrentWebview().clearAllBrowsingData();
    toast.showConfig('success', TOAST_MESSAGES.cache.clearSuccess);
  } catch (error) {
    toast.showConfig('error', TOAST_MESSAGES.cache.clearFailed(String(error)));
  } finally { isClearingCache.value = false; }
}

async function handleWebDAVTest() {
  const webdav = formData.value.webdav;
  const profile = webdav.profiles.find(p => p.id === webdav.activeId);
  if (!profile) return;

  if (!profile.url || !profile.username || !profile.password) {
    toast.showConfig('error', TOAST_MESSAGES.auth.failed('WebDAV', '请先补全服务器 URL、用户名和密码'));
    return;
  }

  cancelDebouncedSave();
  webdavTesting.value = true;
  try {
    const result = await configManager.testWebDAVConnection({
      url: profile.url,
      username: profile.username,
      password: profile.password,
      remotePath: profile.remotePath || '/PicNexus/',
    });

    const currentWebDAV = formData.value.webdav;
    formData.value.webdav = {
      ...currentWebDAV,
      profiles: currentWebDAV.profiles.map(p => p.id === profile.id
        ? {
            ...p,
            connectionStatus: result.success ? 'success' : 'failed',
            lastTestedAt: Date.now(),
            lastError: result.success ? undefined : result.message,
          }
        : p),
    };

    toast.showConfig(
      result.success ? 'success' : 'error',
      result.success
        ? TOAST_MESSAGES.auth.success('WebDAV')
        : TOAST_MESSAGES.auth.failed('WebDAV', result.message)
    );

    await saveSettings();
  } finally {
    webdavTesting.value = false;
  }
}

// ---- 生命周期 ----

onMounted(async () => {
  applyTargetTab();
  appVersion.value = await getVersion().catch(() => '未知版本');
  executablePath.value = await invoke<string>('get_executable_path').catch(() => '');

  await loadSettings();
  await applyEditorServer(formData.value.editorServer, { force: true });

  const { listen } = await import('@tauri-apps/api/event');
  const myLabel = getCurrentWebview().label;
  compressionSyncUnlisten.value = await listen<{ source?: string }>('config-updated', async (event) => {
    // Why: 跳过自身保存触发的 echo，避免在防抖窗口期间把用户连续拖动的滑块值
    //   被磁盘旧值覆盖（emit→listen 同窗口仍走 IPC，期间用户可能已输入新值）
    if (event.payload?.source === myLabel) return;
    const updated = await configStore.get<UserConfig>('config');
    if (updated?.imageCompression) formData.value.imageCompression = { ...updated.imageCompression };
  });

  cookieUnlisten.value = await configManager.setupCookieListener(async (sid, cookie) => {
    if (sid === 'weibo') {
      formData.value.weiboCookie = cookie;
    } else if (sid === 'nowcoder' || sid === 'zhihu' || sid === 'nami'
      || sid === 'bilibili' || sid === 'chaoxing') {
      formData.value[sid].cookie = cookie;
    }
    await saveSettings();
  });

  isSettingsReady.value = true;
});

onUnmounted(() => {
  cancelDebouncedSave();
  clearEditorTimer();
  saveSettings().catch(() => {});
  cookieUnlisten.value?.();
  compressionSyncUnlisten.value?.();
});
</script>

<template>
  <div class="settings-layout">
    <div class="settings-sidebar">
      <div class="sidebar-title">设置</div>
      <nav class="nav-list">
        <div v-for="(group, idx) in navGroups" :key="idx" class="nav-group">
          <button
            v-for="item in group.items" :key="item.id"
            class="nav-item" :class="{ active: activeTab === item.id }"
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
      <div v-if="activeTab === 'general'" class="settings-section">
        <GeneralSettingsPanel
          :current-theme="currentTheme"
          :auto-start="formData.appBehavior.autoStart"
          :minimize-to-tray-on-start="formData.appBehavior.minimizeToTrayOnStart"
          :close-to-tray="formData.appBehavior.closeToTray"
          :analytics-enabled="formData.analyticsEnabled"
          :is-clearing-cache="isClearingCache"
          :is-resetting-defaults="isResettingDefaults"
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
          @clear-history="historyManager.clearHistory()"
          @clear-cache="handleClearAppCache"
          @reset-defaults="handleResetDefaults"
          @save="debouncedSaveSettings"
        />
      </div>

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

      <div v-if="activeTab === 'hosting'" class="settings-section">
        <HostingSettingsPanel
          :private-form-data="{ r2: formData.r2, tencent: formData.tencent, aliyun: formData.aliyun, qiniu: formData.qiniu, upyun: formData.upyun }"
          :custom-s3-profiles="formData.custom_s3_profiles"
          :cookie-form-data="{ weibo: { cookie: formData.weiboCookie }, zhihu: formData.zhihu, nowcoder: formData.nowcoder, nami: formData.nami, bilibili: formData.bilibili, chaoxing: formData.chaoxing }"
          :token-form-data="{ smms: formData.smms, github: formData.github, imgur: formData.imgur }"
          :testing-connections="testingConnections"
          :jd-available="jdAvailable" :qiyu-available="qiyuAvailable"
          :is-checking-jd="isCheckingJd" :is-checking-qiyu="isCheckingQiyu"
          :link-prefix-enabled="formData.linkPrefixEnabled"
          :prefix-list="formData.linkPrefixList"
          :selected-prefix-index="formData.selectedPrefixIndex"
          :github-cdn-config="formData.github.cdnConfig"
          :target-card-id="targetCardId"
          :is-batch-testing="isBatchTesting"
          :batch-test-progress="batchTestProgress"
          :batch-test-completion-key="batchTestCompletionKey"
          :service-check-session="activeSession"
          :refreshing-service-ids="visibleRefreshingServiceIds"
          :service-names="serviceNames"
          :available-services="availableServices"
          :service-config-status="serviceConfigStatus"
          :public-service-risk-accepted="formData.publicServiceRiskAccepted"
          @update:available-services="(v) => { availableServices = v; debouncedSaveSettings(); }"
          @accept-public-service-risk="formData.publicServiceRiskAccepted = true"
          @card-navigated="targetCardId = null"
          @test-all="testAllConfiguredServices"
          @cancel-batch-test="cancelBatchTest"
          @scroll-to-service="(id) => { targetCardId = id; }"
          @save="debouncedSaveSettings"
          @test-private="handleServiceTest" @test-token="handleServiceTest" @test-cookie="handleServiceTest"
          @check-builtin="handleBuiltinCheck"
          @login-cookie="(id) => configManager.openCookieWebView(id as ServiceType)"
          @update:link-prefix-enabled="(v) => { formData.linkPrefixEnabled = v; debouncedSaveSettings(); }"
          @update:selected-prefix-index="(v) => { formData.selectedPrefixIndex = v; debouncedSaveSettings(); }"
          @update:github-cdn-config="(v) => { formData.github.cdnConfig = v; }"
          @add-prefix="addPrefix"
          @update-prefix="({ index, item }) => updatePrefix(index, item)"
          @remove-prefix="removePrefix"
          @reset-to-default="resetToDefaultPrefixes"
          @add-custom-s3="addCustomS3Profile" @delete-custom-s3="deleteCustomS3Profile" @update-custom-s3="updateCustomS3Profile"
        />
      </div>

      <div v-if="activeTab === 'backup'" class="settings-section">
        <BackupSyncPanel
          :webdav-config="formData.webdav"
          :webdav-testing="webdavTesting"
          @update:webdav-config="(v) => { formData.webdav = v; debouncedSaveSettings(); }"
          @save="debouncedSaveSettings"
          @test-web-d-a-v="handleWebDAVTest"
          @add-web-d-a-v-profile="addWebDAVProfile"
          @delete-web-d-a-v-profile="deleteWebDAVProfile"
          @switch-web-d-a-v-profile="switchWebDAVProfile"
        />
      </div>

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
.settings-layout {
  display: flex;
  height: 100%;
  background-color: var(--bg-app);
  overflow: hidden;
}

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
  padding: 0 var(--space-lg-xl);
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle-light);
}

.nav-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-md);
  display: flex;
  flex-direction: column;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  padding: var(--space-sm-md) var(--space-md);
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background-color var(--duration-fast), color var(--duration-fast);
  text-align: left;
  width: 100%;
}

.nav-item .nav-icon {
  font-size: var(--text-lg);
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
  font-weight: var(--weight-semibold);
}

.nav-item.active .nav-icon {
  color: var(--primary);
}

.sidebar-footer {
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--border-subtle-light);
  text-align: center;
}

.version-text {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  opacity: 0.6;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2xl) var(--space-4xl);
}

.settings-section {
  max-width: 800px;
  animation: k-fade-slide-up var(--duration-medium) ease-out;
}
</style>
