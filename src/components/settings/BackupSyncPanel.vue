<script setup lang="ts">
// src/components/settings/BackupSyncPanel.vue
// 备份与同步面板组件

import { ref, computed, onMounted, onUnmounted } from 'vue';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Button from 'primevue/button';
import Divider from 'primevue/divider';
import ToggleSwitch from 'primevue/toggleswitch';
import ProgressBar from 'primevue/progressbar';
import { useBackupSync } from '../../composables/useBackupSync';
import { useAutoSync } from '../../composables/useAutoSync';
import type { WebDAVProfile, WebDAVConfig, AutoSyncConfig } from '../../config/types';

// ==================== Props ====================

interface Props {
  /** WebDAV 配置 */
  webdavConfig: WebDAVConfig;

  /** 自动同步配置 */
  autoSyncConfig: AutoSyncConfig;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  /** WebDAV 配置变更 */
  'update:webdavConfig': [config: WebDAVConfig];

  /** 自动同步配置变更 */
  'update:autoSyncConfig': [config: AutoSyncConfig];

  /** 保存设置 */
  'save': [];

  /** 测试 WebDAV 连接 */
  'testWebDAV': [];

  /** 添加 WebDAV 配置 */
  'addWebDAVProfile': [];

  /** 删除 WebDAV 配置 */
  'deleteWebDAVProfile': [id: string];

  /** 切换 WebDAV 配置 */
  'switchWebDAVProfile': [id: string];
}>();

// ==================== Composables ====================

const {
  syncStatus,
  exportSettingsLoading,
  importSettingsLoading,
  uploadSettingsLoading,
  downloadSettingsLoading,
  exportHistoryLoading,
  importHistoryLoading,
  importHistoryProgress,
  uploadHistoryLoading,
  downloadHistoryLoading,
  uploadHistoryMenuVisible,
  downloadSettingsMenuVisible,
  downloadHistoryMenuVisible,
  configSectionExpanded,
  historySectionExpanded,
  loadSyncStatus,
  exportSettingsLocal,
  importSettingsLocal,
  exportHistoryLocal,
  importHistoryLocal,
  uploadSettingsCloud,
  downloadSettingsOverwrite,
  downloadSettingsMerge,
  uploadHistoryForce,
  uploadHistoryMerge,
  uploadHistoryIncremental,
  downloadHistoryOverwrite,
  downloadHistoryMerge,
  toggleUploadHistoryMenu,
  toggleDownloadSettingsMenu,
  toggleDownloadHistoryMenu,
  closeAllMenus
} = useBackupSync();

// ==================== 计算属性 ====================

const activeWebDAVProfile = computed(() => {
  return props.webdavConfig.profiles.find(p => p.id === props.webdavConfig.activeId) || null;
});

const {
  isEnabled: isAutoSyncEnabled,
  isSyncing: isAutoSyncing,
  lastAutoSync,
  lastResult: autoSyncLastResult,
  remainingTimeFormatted,
  start: startAutoSync,
  stop: stopAutoSync,
  updateInterval: updateAutoSyncInterval,
  syncNow: syncNowAuto
} = useAutoSync(
  () => activeWebDAVProfile.value,
  { syncSettings: true, syncHistory: true }
);

// ==================== 状态 ====================

const uploadHistoryDropdownRef = ref<HTMLElement | null>(null);
const downloadSettingsDropdownRef = ref<HTMLElement | null>(null);
const downloadHistoryDropdownRef = ref<HTMLElement | null>(null);
const syncNowDropdownRef = ref<HTMLElement | null>(null);
const syncNowMenuVisible = ref(false);
const testingWebDAV = ref(false);

const localAutoSyncConfig = computed({
  get: () => props.autoSyncConfig,
  set: (val) => emit('update:autoSyncConfig', val)
});

// ==================== 生命周期 ====================

onMounted(async () => {
  await loadSyncStatus();

  // 如果已启用自动同步且有活动的 WebDAV 配置，恢复自动同步
  if (props.autoSyncConfig.enabled && activeWebDAVProfile.value) {
    startAutoSync();
  }

  // 添加点击外部关闭菜单监听
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  // 停止自动同步定时器
  stopAutoSync();
  document.removeEventListener('click', handleClickOutside);
});

// ==================== WebDAV 配置更新方法 ====================

/**
 * 更新当前活动配置的字段（避免直接修改 props）
 */
function updateActiveProfileField(field: keyof WebDAVProfile, value: string) {
  if (!activeWebDAVProfile.value) return;

  const updatedProfiles = props.webdavConfig.profiles.map(p => {
    if (p.id === props.webdavConfig.activeId) {
      return { ...p, [field]: value };
    }
    return p;
  });

  emit('update:webdavConfig', {
    ...props.webdavConfig,
    profiles: updatedProfiles
  });
}

// ==================== 方法 ====================

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node;

  const menus = [
    { visible: uploadHistoryMenuVisible, ref: uploadHistoryDropdownRef },
    { visible: downloadSettingsMenuVisible, ref: downloadSettingsDropdownRef },
    { visible: downloadHistoryMenuVisible, ref: downloadHistoryDropdownRef },
    { visible: syncNowMenuVisible, ref: syncNowDropdownRef },
  ];

  for (const { visible, ref } of menus) {
    if (visible.value && ref.value && !ref.value.contains(target)) {
      visible.value = false;
    }
  }
}

function toggleSyncNowMenu() {
  const willOpen = !syncNowMenuVisible.value;
  closeAllMenus();
  syncNowMenuVisible.value = willOpen;
}

function handleAutoSyncToggle(enabled: boolean) {
  localAutoSyncConfig.value = { ...localAutoSyncConfig.value, enabled };
  if (enabled) {
    startAutoSync();
  } else {
    stopAutoSync();
  }
  emit('save');
}

function handleAutoSyncIntervalChange(hours: number) {
  const validHours = Math.max(1, Math.min(720, hours));
  localAutoSyncConfig.value = { ...localAutoSyncConfig.value, intervalHours: validHours };
  updateAutoSyncInterval(validHours);
  emit('save');
}

async function syncNowAll() {
  syncNowMenuVisible.value = false;
  await syncNowAuto();
}

async function syncNowSettingsOnly() {
  syncNowMenuVisible.value = false;
  await uploadSettingsCloud(activeWebDAVProfile.value);
}

async function syncNowHistoryOnly() {
  syncNowMenuVisible.value = false;
  await uploadHistoryMerge(activeWebDAVProfile.value);
}

function handleSave() {
  emit('save');
}

function handleTestWebDAV() {
  emit('testWebDAV');
}

function handleAddProfile() {
  emit('addWebDAVProfile');
}

function handleDeleteProfile(id: string) {
  emit('deleteWebDAVProfile', id);
}

function handleSwitchProfile(id: string) {
  emit('switchWebDAVProfile', id);
}
</script>

<template>
  <div class="backup-sync-panel">
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
                @click="uploadSettingsCloud(activeWebDAVProfile)"
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
                    <button class="upload-menu-item" @click="downloadSettingsMerge(activeWebDAVProfile)">
                      <i class="pi pi-sync"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">保留当前 WebDAV 配置</span>
                        <span class="menu-item-desc">其他配置采用云端 (推荐)</span>
                      </div>
                    </button>
                    <button class="upload-menu-item danger" @click="downloadSettingsOverwrite(activeWebDAVProfile)">
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
                :label="importHistoryLoading && importHistoryProgress > 0 ? `${importHistoryProgress}%` : '导入'"
                outlined
                size="small"
              />
            </div>
            <!-- 导入进度条 -->
            <ProgressBar
              v-if="importHistoryLoading && importHistoryProgress > 0"
              :value="importHistoryProgress"
              :showValue="false"
              class="import-progress-bar"
            />
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
                    <button class="upload-menu-item" @click="uploadHistoryMerge(activeWebDAVProfile)">
                      <i class="pi pi-sync"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">智能合并</span>
                        <span class="menu-item-desc">对比并合并双端差异 (推荐)</span>
                      </div>
                    </button>
                    <button class="upload-menu-item" @click="uploadHistoryIncremental(activeWebDAVProfile)">
                      <i class="pi pi-plus"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">仅上传新增</span>
                        <span class="menu-item-desc">只上传云端没有的记录</span>
                      </div>
                    </button>
                    <button class="upload-menu-item danger" @click="uploadHistoryForce(activeWebDAVProfile)">
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
                    <button class="upload-menu-item" @click="downloadHistoryMerge(activeWebDAVProfile)">
                      <i class="pi pi-sync"></i>
                      <div class="menu-item-content">
                        <span class="menu-item-title">智能合并</span>
                        <span class="menu-item-desc">与本地记录合并 (推荐)</span>
                      </div>
                    </button>
                    <button class="upload-menu-item danger" @click="downloadHistoryOverwrite(activeWebDAVProfile)">
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

    <!-- WebDAV 配置区域 -->
    <div class="sub-section">
      <h3>WebDAV 配置</h3>

      <!-- 配置切换卡片 -->
      <div class="webdav-profile-tabs">
        <button
          v-for="profile in webdavConfig.profiles"
          :key="profile.id"
          class="profile-tab"
          :class="{ active: webdavConfig.activeId === profile.id }"
          @click="handleSwitchProfile(profile.id)"
        >
          <span class="profile-indicator"></span>
          <span>{{ profile.name }}</span>
        </button>
        <button class="profile-tab add-btn" @click="handleAddProfile">
          <i class="pi pi-plus"></i>
        </button>
      </div>

      <!-- 当前配置表单 -->
      <div v-if="activeWebDAVProfile" class="webdav-form">
        <div class="form-grid">
          <div class="form-item">
            <label>配置名称</label>
            <InputText
              :modelValue="activeWebDAVProfile.name"
              @update:modelValue="(v) => updateActiveProfileField('name', v as string)"
              @blur="handleSave"
              placeholder="如：坚果云、群晖 NAS"
            />
          </div>
          <div class="form-item">
            <label>服务器 URL</label>
            <InputText
              :modelValue="activeWebDAVProfile.url"
              @update:modelValue="(v) => updateActiveProfileField('url', v as string)"
              @blur="handleSave"
              placeholder="https://dav.example.com"
            />
          </div>
          <div class="form-item">
            <label>用户名</label>
            <InputText
              :modelValue="activeWebDAVProfile.username"
              @update:modelValue="(v) => updateActiveProfileField('username', v as string)"
              @blur="handleSave"
            />
          </div>
          <div class="form-item">
            <label>密码</label>
            <Password
              :modelValue="activeWebDAVProfile.password"
              @update:modelValue="(v) => updateActiveProfileField('password', v as string)"
              @blur="handleSave"
              :feedback="false"
              toggleMask
            />
          </div>
          <div class="form-item span-full">
            <label>远程路径</label>
            <InputText
              :modelValue="activeWebDAVProfile.remotePath"
              @update:modelValue="(v) => updateActiveProfileField('remotePath', v as string)"
              @blur="handleSave"
              placeholder="/PicNexus/"
            />
          </div>
        </div>
        <div class="webdav-actions-row">
          <Button label="测试连接" icon="pi pi-check" @click="handleTestWebDAV" :loading="testingWebDAV" outlined size="small" />
          <Button label="删除此配置" icon="pi pi-trash" @click="handleDeleteProfile(activeWebDAVProfile.id)" severity="danger" text size="small" />
        </div>
      </div>

      <!-- 无配置提示 -->
      <div v-else class="empty-webdav">
        <p>尚未配置 WebDAV 连接</p>
        <Button label="添加配置" icon="pi pi-plus" @click="handleAddProfile" outlined />
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
              :modelValue="String(autoSyncConfig.intervalHours)"
              @update:modelValue="(val) => handleAutoSyncIntervalChange(Number(val))"
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
</template>

<style scoped>
@import '../../styles/settings-shared.css';

/* 备份组 */
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

.import-progress-bar {
  margin-top: 8px;
  height: 4px;
  border-radius: 2px;
}

/* 下拉菜单 */
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

.upload-menu-item.danger {
  color: var(--error);
}

.upload-menu-item.danger i {
  color: var(--error);
}

.upload-menu-item.danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

/* 同步状态 */
.sync-status-line {
  margin-top: 12px;
  font-size: 12px;
  font-family: var(--font-mono);
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

/* WebDAV 配置 */
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

/* 自动同步 */
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

.auto-sync-status-line .status-separator {
  color: var(--border-subtle);
}

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

/* Password 组件样式 */
:deep(.p-password) {
  position: relative;
  display: flex;
  width: 100%;
}

:deep(.p-password-input) {
  width: 100%;
}

/* 覆盖 helper-text 间距 */
.helper-text {
  margin: -3px 0 0 0;
}
</style>
