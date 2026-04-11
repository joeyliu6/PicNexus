<script setup lang="ts">
import { computed, watch } from 'vue';
import Button from 'primevue/button';
import ProgressBar from 'primevue/progressbar';
import ToggleSwitch from 'primevue/toggleswitch';
import { useAutoUpdate } from '../../../composables/useAutoUpdate';
import { useToast } from '../../../composables/useToast';

const autoUpdateEnabled = defineModel<boolean>('autoUpdateEnabled', { required: true });

const emit = defineEmits<{
  save: [];
}>();

const toast = useToast();

const {
  status,
  updateInfo,
  downloadProgress,
  errorMessage,
  lastCheckTime,
  checkForUpdate,
  downloadAndInstall,
} = useAutoUpdate();

watch(status, (val) => {
  if (val === 'error' && errorMessage.value) {
    toast.error('检查更新失败', errorMessage.value);
  }
});

const lastCheckText = computed(() => {
  if (!lastCheckTime.value) return '';
  const diff = Date.now() - lastCheckTime.value;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  return `${Math.floor(diff / 3600_000)} 小时前`;
});

function onToggleAutoUpdate(v: boolean) {
  autoUpdateEnabled.value = v;
  emit('save');
}
</script>

<template>
  <div class="update-card" :class="{
    'update-card-success': status === 'up-to-date',
    'update-card-available': status === 'available',
  }">
    <!-- idle -->
    <div v-if="status === 'idle'" class="update-status">
      <div class="update-status-text">
        <span>点击右侧按钮检查是否有可用更新</span>
      </div>
      <Button
        label="检查更新"
        icon="pi pi-refresh"
        size="small"
        @click="checkForUpdate"
      />
    </div>

    <!-- checking -->
    <div v-else-if="status === 'checking'" class="update-status">
      <div class="update-status-text">
        <i class="pi pi-spin pi-spinner update-icon checking" />
        <span>正在检查更新...</span>
      </div>
    </div>

    <!-- up-to-date -->
    <div v-else-if="status === 'up-to-date'" class="update-status">
      <div class="update-status-text">
        <div class="update-status-info">
          <span>已是最新版本</span>
          <span v-if="lastCheckText" class="last-check">上次检查：{{ lastCheckText }}</span>
        </div>
      </div>
      <Button
        label="重新检查"
        icon="pi pi-refresh"
        size="small"
        text
        @click="checkForUpdate"
      />
    </div>

    <!-- available -->
    <div v-else-if="status === 'available'" class="update-status update-status-vertical">
      <div class="update-status-row">
        <div class="update-status-text">
          <i class="pi pi-arrow-circle-up update-icon available" />
          <span class="new-version-label">新版本 v{{ updateInfo?.version }} 可用</span>
        </div>
        <Button
          label="立即更新"
          icon="pi pi-download"
          size="small"
          @click="downloadAndInstall"
        />
      </div>
      <div v-if="updateInfo?.body" class="update-notes">
        <div class="update-notes-label">更新日志</div>
        <div class="update-notes-content">{{ updateInfo.body }}</div>
      </div>
    </div>

    <!-- downloading -->
    <div v-else-if="status === 'downloading'" class="update-status update-status-vertical">
      <div class="update-status-text">
        <i class="pi pi-spin pi-spinner update-icon checking" />
        <span>正在下载更新... {{ downloadProgress }}%</span>
      </div>
      <ProgressBar :value="downloadProgress" class="update-progress" />
    </div>

    <!-- ready -->
    <div v-else-if="status === 'ready'" class="update-status">
      <div class="update-status-text">
        <span>下载完成，正在重启应用...</span>
      </div>
    </div>

    <!-- error -->
    <div v-else-if="status === 'error'" class="update-status">
      <div class="update-status-text">
        <div class="update-status-info">
          <span>无法连接到更新服务器</span>
          <span class="last-check error-hint">
            <template v-if="lastCheckText">上次检查：{{ lastCheckText }} · </template>
            请检查网络连接后重试
          </span>
        </div>
      </div>
      <Button
        label="重试"
        icon="pi pi-refresh"
        size="small"
        outlined
        @click="checkForUpdate"
      />
    </div>

  </div>

  <div class="toggle-card">
    <div class="toggle-info">
      <span class="toggle-row-label">自动更新</span>
      <span class="toggle-row-desc">启动时自动检测是否有新版本</span>
    </div>
    <ToggleSwitch
      :modelValue="autoUpdateEnabled"
      @update:modelValue="onToggleAutoUpdate"
    />
  </div>
</template>

<style scoped>
.update-card {
  padding: 16px 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.update-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
}

.update-status-vertical {
  flex-direction: column;
  align-items: stretch;
}

.update-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.update-status-text {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--text-base);
  color: var(--text-primary);
}

.update-status-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.update-icon {
  font-size: var(--text-lg-xl);
  color: var(--text-muted);
  flex-shrink: 0;
}

.update-icon.checking {
  color: var(--primary);
}

.update-icon.available {
  color: var(--primary);
}

.error-hint {
  color: var(--error);
}

.update-card-success {
  background: var(--success-alpha-8);
  border-color: var(--success-border);
}

.update-card-available {
  background: var(--primary-alpha-8);
  border-color: var(--primary-border);
}

.new-version-label {
  font-weight: 600;
  color: var(--primary);
}

.last-check {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.update-notes {
  background: var(--bg-app);
  border-radius: 8px;
  padding: 12px;
  max-height: 120px;
  overflow-y: auto;
  margin-top: 12px;
}

.update-notes-label {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.update-notes-content {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  white-space: pre-wrap;
  line-height: 1.5;
}

.update-progress {
  height: 6px;
  margin-top: 12px;
}

/* 自动更新独立卡片 */
.toggle-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  margin-top: 12px;
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-card .toggle-row-label {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-primary);
}

.toggle-card .toggle-row-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
</style>
