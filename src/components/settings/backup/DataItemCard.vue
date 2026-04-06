<script lang="ts">
import { ref as createRef } from 'vue';

let instanceCounter = 0;
const openMenuId = createRef<number | null>(null);
</script>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import Button from 'primevue/button';
import { useClickOutside } from '../../../composables/useClickOutside';
import type { ProfileSyncRecord } from '../../../config/types';

interface SyncStatusInfo {
  lastSync?: string | null;
  result?: 'success' | 'failed' | 'partial' | null;
  error?: string;
}

interface Props {
  type: 'config' | 'history';
  syncStatus: SyncStatusInfo;
  isCloudEnabled: boolean;
  cloudHint?: string;
  localLoading: { export: boolean; import: boolean };
  cloudLoading: { sync: boolean; forceUpload: boolean; forceDownload: boolean };
  providerName?: string;
  otherProfiles?: ProfileSyncRecord[];
}

const props = withDefaults(defineProps<Props>(), {
  otherProfiles: () => [],
});

const emit = defineEmits<{
  'export-local': [];
  'import-local': [];
  'sync-cloud': [];
  'force-upload': [];
  'force-download': [];
}>();

const instanceId = ++instanceCounter;
const moreMenuVisible = computed({
  get: () => openMenuId.value === instanceId,
  set: (val: boolean) => { openMenuId.value = val ? instanceId : null; }
});
const { target: moreMenuRef } = useClickOutside(() => { moreMenuVisible.value = false; });
const menuPlaceTop = ref(false);

async function toggleMoreMenu() {
  moreMenuVisible.value = !moreMenuVisible.value;
  if (moreMenuVisible.value) {
    const wrapperEl = moreMenuRef.value as HTMLElement | null;
    if (wrapperEl) {
      const rect = wrapperEl.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      menuPlaceTop.value = spaceBelow < 140;
    }
    await nextTick();
    const menuEl = moreMenuRef.value?.querySelector('.dropdown-menu') as HTMLElement | null;
    menuEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function handleForceAction(action: 'upload' | 'download') {
  moreMenuVisible.value = false;
  if (action === 'upload') {
    emit('force-upload');
  } else {
    emit('force-download');
  }
}

const STALE_DAYS_WARNING = 7;
const STALE_DAYS_DANGER = 30;

function getElapsedMs(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return isNaN(ms) ? -1 : ms;
}

function formatRelativeTime(dateStr: string): string {
  const ms = getElapsedMs(dateStr);
  if (ms < 0) return '未知时间';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

const daysSinceLastSync = computed(() => {
  if (!props.syncStatus.lastSync) return -1;
  const ms = getElapsedMs(props.syncStatus.lastSync);
  return ms < 0 ? -1 : Math.floor(ms / (1000 * 60 * 60 * 24));
});

const statusClass = computed(() => {
  if (!props.syncStatus.lastSync) return 'not-synced';
  if (props.syncStatus.result === 'failed') return 'failed';
  if (props.syncStatus.result === 'partial') return 'partial';
  if (daysSinceLastSync.value >= STALE_DAYS_DANGER) return 'stale-danger';
  if (daysSinceLastSync.value >= STALE_DAYS_WARNING) return 'stale-warning';
  return 'synced';
});

const statusText = computed(() => {
  const prefix = props.providerName ? `${props.providerName} · ` : '';
  if (!props.syncStatus.lastSync) return `${prefix}尚未同步`;
  if (props.syncStatus.result === 'failed') return `${prefix}同步失败`;
  if (props.syncStatus.result === 'partial') return `${prefix}部分同步`;
  const relTime = formatRelativeTime(props.syncStatus.lastSync);
  return `${prefix}${relTime}同步`;
});

const shortStatusText = computed(() => {
  if (!props.syncStatus.lastSync) return '未同步';
  if (props.syncStatus.result === 'failed') return '同步失败';
  if (props.syncStatus.result === 'partial') return '部分同步';
  return formatRelativeTime(props.syncStatus.lastSync);
});

const isHistoryType = computed(() => props.type === 'history');

const syncButtonTooltip = computed(() => {
  return isHistoryType.value
    ? '自动合并云端与本地记录，保留最新版本'
    : '自动合并云端与本地设置，冲突时保留本地';
});

function formatDate(dateStr: string, includeYear = true): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return includeYear ? `${date.getFullYear()}/${m}/${d} ${h}:${min}` : `${m}/${d} ${h}:${min}`;
}

const tooltipContent = computed(() => {
  const lines: string[] = [];
  lines.push(statusText.value);
  if (props.syncStatus.lastSync) {
    lines.push(formatDate(props.syncStatus.lastSync));
  }
  if (props.otherProfiles?.length) {
    const isConfig = props.type === 'config';
    for (const r of props.otherProfiles) {
      const lastSync = isConfig ? r.configLastSync : r.historyLastSync;
      if (!lastSync) continue;
      const result = isConfig ? r.configSyncResult : r.historySyncResult;
      const status = result === 'failed' ? ' (失败)' : '';
      lines.push(`${r.providerName}: ${formatDate(lastSync, false)}${status}`);
    }
  }
  return lines.join('\n');
});

const isAnyForceLoading = computed(() =>
  props.cloudLoading.forceUpload || props.cloudLoading.forceDownload
);
</script>

<template>
  <div class="data-card">
    <!-- 本地操作行 -->
    <div class="card-row">
      <span class="row-label">本地操作</span>
      <div class="row-actions">
        <Button
          @click="emit('export-local')"
          :loading="localLoading.export"
          label="导出"
          icon="pi pi-download"
          outlined
          size="small"
        />
        <Button
          @click="emit('import-local')"
          :loading="localLoading.import"
          label="导入"
          icon="pi pi-upload"
          outlined
          size="small"
        />
      </div>
    </div>

    <!-- 云端同步行：始终显示，未连接时禁用 -->
    <div class="card-row cloud-row" :class="{ 'is-disabled': !isCloudEnabled }">
      <div class="row-label-group">
        <span class="row-label">云端同步</span>
        <!-- 未配置时：直接显示 inline 提示文字，不藏在 tooltip 里 -->
        <span v-if="!isCloudEnabled" class="cloud-hint-text">
          <i class="pi pi-lock cloud-hint-icon" />
          {{ cloudHint || '未配置 WebDAV' }}
        </span>
        <span
          v-else
          v-tooltip.bottom="tooltipContent"
          class="status-badge"
          :class="statusClass"
        >
          <span class="status-dot"></span>
          {{ shortStatusText }}
        </span>
      </div>
      <div class="row-actions">
        <span v-tooltip.bottom="isCloudEnabled ? syncButtonTooltip : undefined">
          <Button
            @click="emit('sync-cloud')"
            :loading="cloudLoading.sync"
            :disabled="!isCloudEnabled"
            label="同步"
            icon="pi pi-sync"
            outlined
            size="small"
          />
        </span>
        <!-- 禁用态隐藏「更多」按钮，减少认知负担 -->
        <div v-if="isCloudEnabled" class="dropdown-wrapper" ref="moreMenuRef">
          <Button
            @click.stop="toggleMoreMenu"
            :disabled="isAnyForceLoading"
            label="更多"
            icon="pi pi-chevron-down"
            iconPos="right"
            outlined
            size="small"
          />
          <Transition :name="menuPlaceTop ? 'dropdown-up' : 'dropdown'">
            <div v-if="moreMenuVisible" class="dropdown-menu" :class="{ 'placement-top': menuPlaceTop }">
              <button
                v-tooltip.left="'以本地数据完全替换云端，云端现有数据将丢失'"
                class="dropdown-item danger"
                :disabled="cloudLoading.forceUpload"
                @click="handleForceAction('upload')"
              >
                <i class="pi pi-cloud-upload"></i>
                <span class="item-label">覆盖云端</span>
              </button>
              <button
                v-tooltip.left="'以云端数据完全替换本地，本地现有数据将丢失'"
                class="dropdown-item danger"
                :disabled="cloudLoading.forceDownload"
                @click="handleForceAction('download')"
              >
                <i class="pi pi-cloud-download"></i>
                <span class="item-label">覆盖本地</span>
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.data-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
}

.card-row + .card-row {
  border-top: 1px solid var(--border-subtle);
}

.card-row.cloud-row {
  background: var(--hover-overlay-subtle);
  border-radius: 0 0 12px 12px;
}

.row-label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
  flex-shrink: 0;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.row-label-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.status-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}

.status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.status-badge.synced { background: var(--success-soft); color: var(--success); }
.status-badge.not-synced { background: var(--hover-overlay-subtle); color: var(--text-muted); }
.status-badge.failed { background: var(--error-soft); color: var(--error); }
.status-badge.partial { background: var(--warning-soft); color: var(--warning); }
.status-badge.stale-warning { background: var(--warning-soft); color: var(--warning); }
.status-badge.stale-danger { background: var(--warning-soft); color: var(--warning); }

.cloud-row.is-disabled {
  opacity: 0.6;
  pointer-events: none;
}

/* 未配置时的 inline 提示文字 */
.cloud-hint-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 400;
}

.cloud-hint-icon {
  font-size: 11px;
  color: var(--text-muted);
}

/* 更多菜单 */
.dropdown-wrapper {
  position: relative;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 200px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-shadow: var(--shadow-float);
  z-index: var(--z-overlay);
  overflow: hidden;
}

.dropdown-menu.placement-top {
  top: auto;
  bottom: calc(100% + 4px);
}

.dropdown-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: background-color var(--duration-fast);
}

.dropdown-item:hover:not(:disabled) {
  background: var(--hover-overlay-subtle);
}

.dropdown-item:not(:last-child) {
  border-bottom: 1px solid var(--border-subtle);
}

.dropdown-item .item-label { flex: 1; }
.dropdown-item.danger { color: var(--error); }
.dropdown-item.danger:hover:not(:disabled) { background: var(--error-soft); }
.dropdown-item:disabled { opacity: 0.5; cursor: not-allowed; }

.dropdown-enter-active,
.dropdown-leave-active {
  transition: all var(--duration-fast) ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.dropdown-up-enter-active,
.dropdown-up-leave-active {
  transition: all var(--duration-fast) ease;
}

.dropdown-up-enter-from,
.dropdown-up-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

@media (max-width: 480px) {
  .card-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .row-label-group {
    flex-wrap: wrap;
  }
}
</style>
