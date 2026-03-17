<script setup lang="ts">
import { computed, watch } from 'vue';
import Button from 'primevue/button';
import ProgressBar from 'primevue/progressbar';
import ToggleSwitch from 'primevue/toggleswitch';
import Divider from 'primevue/divider';
import { open } from '@tauri-apps/plugin-shell';
import { useAutoUpdate } from '../../composables/useAutoUpdate';
import { useToast } from '../../composables/useToast';
import appIconUrl from '../../assets/icons/app-icon.png';

interface Props {
  appVersion: string;
  autoUpdateEnabled: boolean;
}

defineProps<Props>();

const emit = defineEmits<{
  'update:autoUpdateEnabled': [value: boolean];
  'reopenOnboarding': [];
  'save': [];
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

function openExternal(url: string) {
  open(url);
}
</script>

<template>
  <div class="about-update-panel">
    <div class="section-header">
      <h2>关于与更新</h2>
      <p class="section-desc">查看应用信息、检查更新和相关资源链接。</p>
    </div>

    <!-- 应用信息 -->
    <div class="form-group">
      <label class="group-label">应用信息</label>
      <div class="app-info-card">
        <img :src="appIconUrl" alt="PicNexus" class="app-info-icon" />
        <div class="app-info-content">
          <div class="app-name">PicNexus</div>
          <div class="app-version">版本 {{ appVersion }}</div>
          <div class="app-desc">多图床并行上传工具</div>
        </div>
      </div>
    </div>

    <Divider />

    <!-- 软件更新 -->
    <div class="form-group">
      <label class="group-label">软件更新</label>
      <div class="update-card">
        <!-- idle -->
        <div v-if="status === 'idle'" class="update-status">
          <div class="update-status-text">
            <i class="pi pi-sync update-icon" />
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
            <i class="pi pi-check-circle update-icon success" />
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
            <i class="pi pi-check-circle update-icon success" />
            <span>下载完成，正在重启应用...</span>
          </div>
        </div>

        <!-- error -->
        <div v-else-if="status === 'error'" class="update-status">
          <div class="update-status-text">
            <i class="pi pi-times-circle update-icon error" />
            <span>检查更新失败</span>
          </div>
          <Button
            label="重试"
            icon="pi pi-refresh"
            size="small"
            severity="secondary"
            @click="checkForUpdate"
          />
        </div>

        <!-- 分割线 + 自动更新开关 -->
        <div class="update-card-divider" />
        <div class="toggle-row">
          <div class="toggle-info">
            <span class="toggle-row-label">自动更新</span>
            <span class="toggle-row-desc">启动时自动检测是否有新版本</span>
          </div>
          <ToggleSwitch
            :modelValue="autoUpdateEnabled"
            @update:modelValue="(v: boolean) => { emit('update:autoUpdateEnabled', v); emit('save'); }"
          />
        </div>
      </div>
    </div>

    <Divider />

    <!-- 相关链接 -->
    <div class="form-group">
      <label class="group-label">相关链接</label>
      <div class="links-grid">
        <button class="link-card" @click="openExternal('https://github.com/joeyliu6/PicNexus')">
          <div class="link-card-icon">
            <i class="pi pi-github" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">GitHub 仓库</span>
            <span class="link-card-desc">查看源码和版本发布</span>
          </div>
        </button>
        <button class="link-card" @click="openExternal('https://github.com/joeyliu6/PicNexus/issues')">
          <div class="link-card-icon">
            <i class="pi pi-comment" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">问题反馈</span>
            <span class="link-card-desc">报告问题或提出建议</span>
          </div>
        </button>
        <button class="link-card" @click="openExternal('https://github.com/joeyliu6/PicNexus/releases')">
          <div class="link-card-icon">
            <i class="pi pi-list" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">更新日志</span>
            <span class="link-card-desc">查看历史版本变更</span>
          </div>
        </button>
        <button class="link-card" @click="emit('reopenOnboarding')">
          <div class="link-card-icon">
            <i class="pi pi-compass" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">重新引导</span>
            <span class="link-card-desc">重新查看新手引导</span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

/* 应用信息卡片 */
.app-info-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

.app-info-icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  flex-shrink: 0;
  object-fit: contain;
}

.app-info-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.app-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.app-version {
  font-size: 14px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.app-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 2px;
}

/* 更新卡片 */
.update-card {
  padding: 20px;
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
  min-height: 36px;
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
  font-size: 14px;
  color: var(--text-primary);
}

.update-status-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.update-icon {
  font-size: 18px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.update-icon.checking {
  color: var(--primary);
}

.update-icon.success {
  color: #22c55e;
}

.update-icon.available {
  color: var(--primary);
}

.update-icon.error {
  color: #ef4444;
}

.new-version-label {
  font-weight: 600;
  color: var(--primary);
}

.last-check {
  font-size: 12px;
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
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.update-notes-content {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  line-height: 1.5;
}

.update-progress {
  height: 6px;
  margin-top: 12px;
}

/* 卡片内分割线 */
.update-card-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 16px 0;
}

/* 自动更新 toggle（卡片内部） */
.update-card .toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 0;
}

.update-card .toggle-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.update-card .toggle-row-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.update-card .toggle-row-desc {
  font-size: 12px;
  color: var(--text-muted);
}

/* 链接网格 */
.links-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.link-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.link-card:hover {
  border-color: var(--primary);
  background: rgba(59, 130, 246, 0.03);
}

.link-card-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.link-card-icon i {
  font-size: 16px;
  color: var(--primary);
}

.link-card:hover .link-card-icon {
  background: rgba(59, 130, 246, 0.15);
}

.link-card-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.link-card-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.link-card-desc {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
