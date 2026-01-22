<script setup lang="ts">
// 自动同步配置组件

import { computed, onMounted, onUnmounted, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import { useAutoSync } from '../../../composables/useAutoSync';
import type { AutoSyncConfig, WebDAVProfile } from '../../../config/types';

// ==================== Props ====================

interface Props {
  modelValue: AutoSyncConfig;
  activeProfile: WebDAVProfile | null;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
  'update:modelValue': [config: AutoSyncConfig];
  'save': [];
  'sync-settings': [];
  'sync-history': [];
}>();

// ==================== Composables ====================

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
  () => props.activeProfile,
  { syncSettings: true, syncHistory: true }
);

// ==================== State ====================

const syncNowDropdownRef = ref<HTMLElement | null>(null);
const syncNowMenuVisible = ref(false);

const localConfig = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

// ==================== Lifecycle ====================

onMounted(() => {
  // 如果已启用自动同步且有活动的 WebDAV 配置，恢复自动同步
  if (props.modelValue.enabled && props.activeProfile) {
    startAutoSync();
  }

  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  stopAutoSync();
  document.removeEventListener('click', handleClickOutside);
});

// ==================== Methods ====================

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node;
  if (syncNowMenuVisible.value && syncNowDropdownRef.value && !syncNowDropdownRef.value.contains(target)) {
    syncNowMenuVisible.value = false;
  }
}

function toggleSyncNowMenu() {
  syncNowMenuVisible.value = !syncNowMenuVisible.value;
}

function handleAutoSyncToggle(enabled: boolean) {
  localConfig.value = { ...localConfig.value, enabled };
  if (enabled) {
    startAutoSync();
  } else {
    stopAutoSync();
  }
  emit('save');
}

function handleAutoSyncIntervalChange(hours: number) {
  const validHours = Math.max(1, Math.min(720, hours));
  localConfig.value = { ...localConfig.value, intervalHours: validHours };
  updateAutoSyncInterval(validHours);
  emit('save');
}

async function handleSyncNowAll() {
  syncNowMenuVisible.value = false;
  await syncNowAuto();
}

function handleSyncSettings() {
  syncNowMenuVisible.value = false;
  emit('sync-settings');
}

function handleSyncHistory() {
  syncNowMenuVisible.value = false;
  emit('sync-history');
}
</script>

<template>
  <div class="sub-section">
    <h3>自动同步</h3>
    <p class="helper-text">定时自动备份配置和历史记录到云端。</p>

    <!-- 未配置 WebDAV 提示 -->
    <div v-if="!activeProfile" class="auto-sync-warning">
      <i class="pi pi-info-circle"></i>
      <span>请先配置 WebDAV 连接后才能使用自动同步</span>
    </div>

    <!-- 自动同步表单 -->
    <div v-else class="auto-sync-form">
      <!-- 启用开关行 -->
      <div class="auto-sync-toggle">
        <span class="toggle-label-text">启用自动同步</span>
        <ToggleSwitch
          :modelValue="modelValue.enabled"
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
          <span v-if="isSyncing" class="status-value syncing">
            <i class="pi pi-spin pi-spinner"></i> 同步中...
          </span>
          <span v-else-if="remainingTimeFormatted" class="status-value">{{ remainingTimeFormatted }}</span>
        </span>
      </div>

      <!-- 同步间隔设置 -->
      <div v-if="modelValue.enabled" class="auto-sync-interval-row">
        <label>同步间隔（小时）</label>
        <div class="interval-input">
          <InputText
            type="number"
            :modelValue="String(modelValue.intervalHours)"
            @update:modelValue="(val) => handleAutoSyncIntervalChange(Number(val))"
            :min="1"
            :max="720"
          />
          <span class="interval-hint">1 ~ 720 小时</span>
        </div>
      </div>

      <!-- 立即同步下拉菜单 -->
      <div v-if="modelValue.enabled" class="auto-sync-actions">
        <div class="upload-dropdown-wrapper" ref="syncNowDropdownRef">
          <Button
            @click.stop="toggleSyncNowMenu"
            :loading="isSyncing"
            icon="pi pi-sync"
            label="立即同步"
            size="small"
            outlined
          />
          <Transition name="dropdown">
            <div v-if="syncNowMenuVisible" class="upload-menu">
              <button class="upload-menu-item" @click="handleSyncNowAll">
                <i class="pi pi-cloud-upload"></i>
                <div class="menu-item-content">
                  <span class="menu-item-title">同步全部</span>
                  <span class="menu-item-desc">上传配置和上传记录 (推荐)</span>
                </div>
              </button>
              <button class="upload-menu-item" @click="handleSyncSettings">
                <i class="pi pi-cog"></i>
                <div class="menu-item-content">
                  <span class="menu-item-title">仅同步配置</span>
                  <span class="menu-item-desc">只上传应用配置文件</span>
                </div>
              </button>
              <button class="upload-menu-item" @click="handleSyncHistory">
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
</template>

<style scoped>
@import '../../../styles/settings-shared.css';

/* 自动同步特有样式 */
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

/* 下拉菜单样式 (复用) */
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

.helper-text {
  margin: -3px 0 0 0;
}
</style>
