<script setup lang="ts">
// 设置视图 - 逻辑已拆分至 composables/settings/
// 本组件仅负责：tab 导航、事件编排、面板 props 传递。图床在独立的图床页（src/views/hosts），这里不再有图床的任何字段。

import { computed, ref, watch, inject, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue';
import { useRouter } from 'vue-router';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { UI_COPY } from '@/constants/uiCopy';
import { useThemeManager } from '@/composables/useTheme';
import { useConfigManager } from '@/composables/useConfig';
import { useHistoryManager } from '@/composables/history/useHistory';
import { useOnboarding } from '@/composables/useOnboarding';
import { useSettingsForm } from '@/composables/settings/useSettingsForm';
import { applyEditorConfig } from '@/composables/settings/editorSync';
import { useSettingsReset } from '@/composables/settings/useSettingsReset';
import { useSettingsActions } from '@/composables/settings/useSettingsActions';
import { useAutoUpdate } from '@/composables/useAutoUpdate';

import GeneralSettingsPanel from '@/components/settings/GeneralSettingsPanel.vue';
import AdvancedSettingsPanel from '@/components/settings/AdvancedSettingsPanel.vue';
import BackupSyncPanel from '@/components/settings/BackupSyncPanel.vue';
import AboutUpdatePanel from '@/components/settings/AboutUpdatePanel.vue';

import { readFreshConfig } from '@/store/instances';
import type { ImageCompressionConfig, EditorServerConfig } from '@/config/types';

const { currentTheme } = useThemeManager();
const configManager = useConfigManager();
const historyManager = useHistoryManager();
const { reopen: reopenOnboarding } = useOnboarding();
const { hasAvailableUpdate } = useAutoUpdate();

// ---- Composables ----

const {
  formData, isSettingsReady,
  loadSettings, reloadFieldSecrets, saveSettings, debouncedSaveSettings, debouncedSaveSettingsWithStatus,
  cancelDebouncedSave, errorToString, clearTimers: clearFormTimers,
  resetToDefaultSettings,
  addWebDAVProfile, deleteWebDAVProfile, switchWebDAVProfile,
} = useSettingsForm();

/**
 * 编辑器服务按设置页刚改的选项立即下发（图床凭证由 editorSync 从配置里取）；
 * 开启时可能补了一个 authToken，收回表单里，随表单一起保存，免得每次换一个
 */
async function applyEditorServer(cfg: EditorServerConfig, options: { force?: boolean } = {}): Promise<boolean> {
  const { ok, editorServer } = await applyEditorConfig(cfg, options);
  if (editorServer.authToken !== formData.value.editorServer.authToken) formData.value.editorServer = editorServer;
  return ok;
}

const { isResettingDefaults, handleResetDefaults } = useSettingsReset({
  formData,
  cancelDebouncedSave,
  resetToDefaultSettings,
  loadSettings,
  errorToString,
  applyEditorServer,
});

const {
  isClearingCache, webdavTesting,
  handleThemeChange, handleAutoStartChange, handleCloseToTrayChange,
  handleAnalyticsToggle, handleClearAppCache, handleWebDAVTest,
} = useSettingsActions({ formData, saveSettings, cancelDebouncedSave });

// 编辑器服务的图床下拉要列出多份图床（只读，取自配置）
const customS3Profiles = computed(() => configManager.config.value.custom_s3_profiles ?? []);
const webdavProfiles = computed(() => configManager.config.value.webdav_profiles ?? []);

// ---- 导航 ----

type SettingsTab = 'general' | 'advanced' | 'backup' | 'about';

const router = useRouter();
const activeTab = ref<SettingsTab>('general');
const settingsTargetTab = inject<import('vue').Ref<string | null>>('settingsTargetTab');

const applyTargetTab = () => {
  if (!settingsTargetTab?.value) return;
  const val = settingsTargetTab.value;
  settingsTargetTab.value = null;
  if (val === 'compression' || val === 'editor') { activeTab.value = 'advanced'; return; }
  const validTabs: SettingsTab[] = ['general', 'advanced', 'backup', 'about'];
  if (validTabs.includes(val as SettingsTab)) activeTab.value = val as SettingsTab;
};

onActivated(applyTargetTab);
onDeactivated(() => { clearFormTimers(); });
if (settingsTargetTab) { watch(settingsTargetTab, (val) => { if (val) applyTargetTab(); }); }

// ---- UI 状态 ----

const compressionSyncUnlisten = ref<UnlistenFn | null>(null);
const appVersion = ref('');
const executablePath = ref('');

const navGroups = [{
  items: [
    { id: 'general' as SettingsTab, label: UI_COPY.navigation.settings.general, icon: 'pi pi-cog' },
    { id: 'advanced' as SettingsTab, label: UI_COPY.navigation.settings.advanced, icon: 'pi pi-sliders-h' },
    { id: 'backup' as SettingsTab, label: UI_COPY.navigation.settings.backup, icon: 'pi pi-database' },
    { id: 'about' as SettingsTab, label: UI_COPY.navigation.settings.about, icon: 'pi pi-info-circle' },
  ]
}];

// ---- 生命周期 ----

onMounted(async () => {
  applyTargetTab();
  appVersion.value = await getVersion().catch(() => '未知版本');
  executablePath.value = await invoke<string>('get_executable_path').catch(() => '');

  await loadSettings();

  const { listen } = await import('@tauri-apps/api/event');
  const myLabel = getCurrentWebview().label;
  compressionSyncUnlisten.value = await listen<{ source?: string }>('config-updated', async (event) => {
    // Why: 跳过自身保存触发的 echo，避免在防抖窗口期间把用户连续拖动的滑块值
    //   被磁盘旧值覆盖（emit→listen 同窗口仍走 IPC，期间用户可能已输入新值）
    if (event.payload?.source === myLabel) return;
    // 走 readFreshConfig：事件来自别的 webview（托盘也写配置），本窗口缓存此刻是陈旧的。
    const updated = await readFreshConfig();
    if (updated?.imageCompression) formData.value.imageCompression = { ...updated.imageCompression };
  });

  isSettingsReady.value = true;
});

onUnmounted(() => {
  cancelDebouncedSave();
  saveSettings().catch(() => {});
  compressionSyncUnlisten.value?.();
});
</script>

<template>
  <div class="settings-layout">
    <div class="settings-sidebar">
      <div class="sidebar-title">{{ UI_COPY.navigation.settings.title }}</div>
      <nav class="nav-list">
        <div v-for="(group, idx) in navGroups" :key="idx" class="nav-group">
          <button
            v-for="item in group.items" :key="item.id"
            class="nav-item" :class="{
              active: activeTab === item.id,
              'has-update-badge': item.id === 'about' && hasAvailableUpdate,
            }"
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
          :image-compression="formData.imageCompression" :editor-server="formData.editorServer"
          :executable-path="executablePath"
          :custom-s3-profiles="customS3Profiles" :webdav-profiles="webdavProfiles"
          @update:image-compression="(v: ImageCompressionConfig) => { formData.imageCompression = v; debouncedSaveSettingsWithStatus(); }"
          @update:editor-server="async (v: EditorServerConfig) => { formData.editorServer = v; await applyEditorServer(v); debouncedSaveSettingsWithStatus(); }"
          @navigate-hosting="router.push('/hosts')"
          @save="debouncedSaveSettingsWithStatus"
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
          @switch-web-d-a-v-profile="switchWebDAVProfile" @secrets-rekeyed="reloadFieldSecrets"
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
  position: relative;
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

.nav-item.has-update-badge::after {
  content: '';
  position: absolute;
  top: var(--space-sm);
  right: var(--space-sm-md);
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--primary);
  box-shadow: 0 0 0 2px var(--bg-sidebar-settings);
  pointer-events: none;
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
