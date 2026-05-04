<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import Button from 'primevue/button';
import ToggleSwitch from 'primevue/toggleswitch';
import { open } from '@tauri-apps/plugin-shell';
import { useAutoUpdate } from '../../../composables/useAutoUpdate';
import { useToast } from '../../../composables/useToast';

const RELEASES_URL = 'https://github.com/joeyliu6/PicNexus/releases/latest';

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
  pendingUpdateAvailable,
  checkForUpdate,
  downloadAndInstall,
  retryRelaunch,
  retryDownload,
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

// 检查返回（成功或失败）后完成态显示 1.5s 再回落到常态
const COMPLETED_DISPLAY_MS = 1500;
const downloadPercentText = computed(() => {
  const percent = Number(downloadProgress.value);
  if (!Number.isFinite(percent)) return '0%';
  return `${Math.min(Math.max(Math.round(percent), 0), 100)}%`;
});

const postCheckResult = ref<'success' | 'error' | null>(null);
let completedTimer: ReturnType<typeof setTimeout> | null = null;

// Why: checking → up-to-date/error 的瞬间触发"完成"高亮（成功绿勾 / 失败红叉），1.5s 后回到常态
watch(status, (val, prev) => {
  if (prev === 'checking' && val === 'up-to-date') {
    postCheckResult.value = 'success';
    armCompletedTimer();
  } else if (prev === 'checking' && val === 'error') {
    postCheckResult.value = 'error';
    armCompletedTimer();
  } else if (val === 'checking') {
    postCheckResult.value = null;
    if (completedTimer) clearTimeout(completedTimer);
    completedTimer = null;
  }
});

function armCompletedTimer() {
  if (completedTimer) clearTimeout(completedTimer);
  completedTimer = setTimeout(() => {
    postCheckResult.value = null;
  }, COMPLETED_DISPLAY_MS);
}

onUnmounted(() => {
  if (completedTimer) clearTimeout(completedTimer);
});

const isChecking = computed(() => status.value === 'checking');

// 1.5s 过渡期内继续沿用 refresh 分支，避免失败瞬间跳到 error 分支
const showRefreshBranch = computed(() =>
  status.value === 'up-to-date' || status.value === 'checking' || postCheckResult.value !== null,
);

type RefreshState = 'done-success' | 'done-error' | 'checking' | 'idle';

const refreshState = computed<RefreshState>(() => {
  if (postCheckResult.value === 'success') return 'done-success';
  if (postCheckResult.value === 'error') return 'done-error';
  if (isChecking.value) return 'checking';
  return 'idle';
});

const refreshIconClass = computed(() => {
  switch (refreshState.value) {
    case 'done-success': return 'pi pi-check';
    case 'done-error': return 'pi pi-times';
    case 'checking': return 'pi pi-sync is-spinning';
    default: return 'pi pi-refresh';
  }
});

const refreshLabel = computed(() => {
  switch (refreshState.value) {
    case 'done-success': return '检查完成';
    case 'done-error': return '检查失败';
    case 'checking': return '正在检查';
    default: return '重新检查';
  }
});

// Why: 错误来源区分 — 有 pendingUpdate 说明是下载阶段失败，否则是检查阶段失败。
// 原实现统一硬编码 "无法连接到更新服务器" 误导用户：签名失败 / 404 / 权限拒绝都被吞成"网络问题"。
const errorTitle = computed(() => pendingUpdateAvailable.value ? '下载更新失败' : '检查更新失败');

function onToggleAutoUpdate(v: boolean) {
  autoUpdateEnabled.value = v;
  emit('save');
}

async function openManualDownload() {
  try {
    await open(RELEASES_URL);
  } catch {
    toast.error('打开下载页失败', `请手动访问：${RELEASES_URL}`);
  }
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

    <!-- up-to-date / checking / 刚完成：同一分支内切换 shimmer + 按钮四态 -->
    <div v-else-if="showRefreshBranch" class="update-status">
      <div class="update-status-text">
        <div class="update-status-info">
          <template v-if="isChecking || postCheckResult === 'error'">
            <span class="update-skeleton update-skeleton-title" aria-hidden="true"></span>
            <span class="update-skeleton update-skeleton-sub" aria-hidden="true"></span>
          </template>
          <template v-else>
            <span>已是最新版本</span>
            <span v-if="lastCheckText" class="last-check">上次检查：{{ lastCheckText }}</span>
          </template>
        </div>
      </div>
      <button
        class="update-refresh"
        :class="{
          'is-checking': refreshState === 'checking',
          'is-success': refreshState === 'done-success',
          'is-error': refreshState === 'done-error',
        }"
        :disabled="refreshState !== 'idle'"
        @click="checkForUpdate"
      >
        <Transition name="icon-swap" mode="out-in">
          <span :key="refreshState" class="update-refresh-content">
            <i :class="refreshIconClass"></i>
            <span class="update-refresh-label">{{ refreshLabel }}</span>
          </span>
        </Transition>
      </button>
    </div>

    <!-- available -->
    <div v-else-if="status === 'available'" class="update-status">
      <div class="update-status-text">
        <span class="update-version-icon" aria-hidden="true">
          <i class="pi pi-arrow-up" />
        </span>
        <div class="update-status-info">
          <span class="new-version-label">发现新版本</span>
          <span class="version-chip">v{{ updateInfo?.version }}</span>
        </div>
      </div>
      <Button
        label="立即更新"
        icon="pi pi-download"
        size="small"
        @click="downloadAndInstall"
      />
    </div>

    <!-- downloading -->
    <div v-else-if="status === 'downloading'" class="update-status update-status-downloading">
      <div class="update-status-text">
        <span class="download-spinner-ring" aria-hidden="true"></span>
        <span>正在下载更新...</span>
      </div>
      <span class="download-progress-percent" aria-live="polite">{{ downloadPercentText }}</span>
    </div>

    <!-- install-pending: 更新已安装，等待用户重启 -->
    <div v-else-if="status === 'install-pending'" class="update-status">
      <div class="update-status-text">
        <div class="update-status-info">
          <span>更新已安装，重启后生效</span>
          <span v-if="errorMessage" class="last-check error-hint">{{ errorMessage }}</span>
        </div>
      </div>
      <Button
        label="重启完成更新"
        icon="pi pi-replay"
        size="small"
        @click="retryRelaunch"
      />
    </div>

    <!-- error -->
    <div v-else-if="status === 'error' && !postCheckResult" class="update-status">
      <div class="update-status-text">
        <div class="update-status-info">
          <span>{{ errorTitle }}</span>
          <span class="last-check error-hint">
            <template v-if="lastCheckText">上次检查：{{ lastCheckText }} · </template>
            {{ errorMessage || '请检查网络连接后重试' }}
          </span>
        </div>
      </div>
      <div class="error-actions">
        <Button
          v-if="pendingUpdateAvailable"
          label="重新下载"
          icon="pi pi-download"
          size="small"
          @click="retryDownload"
        />
        <Button
          :label="pendingUpdateAvailable ? '重新检查' : '重试'"
          icon="pi pi-refresh"
          size="small"
          outlined
          @click="checkForUpdate"
        />
        <Button
          v-if="!pendingUpdateAvailable"
          label="手动下载"
          icon="pi pi-external-link"
          size="small"
          outlined
          @click="openManualDownload"
        />
      </div>
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
  padding: var(--space-lg) var(--space-lg-xl);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 0;
}

.update-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-height: var(--space-4xl); /* 48px，覆盖两行文字内容高度，防止状态切换时跳动 */
}

.update-status-text {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  font-size: var(--text-base);
  color: var(--text-primary);
}

.update-status-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.update-icon {
  font-size: var(--text-lg-xl);
  color: var(--text-muted);
  flex-shrink: 0;
}

.update-icon.checking {
  color: var(--primary);
}

.download-spinner-ring {
  width: 18px;
  height: 18px;
  display: inline-flex;
  flex-shrink: 0;
  box-sizing: border-box;
  border: 2px solid var(--primary-alpha-15);
  border-top-color: var(--primary);
  border-radius: var(--radius-full);
  transform-origin: center center;
  animation: k-spin var(--duration-spinner) linear infinite;
}

.download-progress-percent {
  min-width: 4ch;
  flex-shrink: 0;
  color: var(--primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-align: right;
}

/* checking 态骨架条：与图床健康 pill shimmer 同一配方 */
.update-skeleton {
  display: block;
  border-radius: var(--radius-full);
  background: linear-gradient(
    90deg,
    var(--border-subtle-light) 25%,
    var(--bg-card) 50%,
    var(--border-subtle-light) 75%
  );
  background-size: 200% 100%;
  animation: k-shimmer var(--duration-shimmer) ease-in-out infinite;
}

.update-skeleton-title {
  width: 6em;
  height: var(--text-base);
}

.update-skeleton-sub {
  width: 8em;
  height: var(--text-xs);
}

/* 自定义 refresh 按钮：与图床 health-refresh 对齐 */
.update-refresh {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  background: none;
  border: none;
  color: var(--primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  padding: var(--space-xs-sm) var(--space-md);
  margin-right: calc(-1 * var(--space-md));
  border-radius: var(--radius-md);
  transition: background-color var(--duration-fast) ease, color var(--duration-fast) ease;
  white-space: nowrap;
}

.update-refresh:hover:not(:disabled) {
  background: var(--hover-overlay-subtle);
}

.update-refresh:disabled {
  cursor: default;
}

.update-refresh-content {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
}

.update-refresh .pi {
  font-size: var(--text-sm);
  line-height: 1;
}

.update-refresh .pi.is-spinning {
  animation: k-spin var(--duration-breathe) linear infinite;
}

.update-refresh-label {
  transition: color var(--duration-fast) ease;
}

.update-refresh.is-success {
  color: var(--success);
}

.update-refresh.is-error {
  color: var(--error);
}

.icon-swap-enter-active,
.icon-swap-leave-active {
  transition: opacity var(--duration-fast) ease;
}

.icon-swap-enter-from,
.icon-swap-leave-to {
  opacity: 0;
}

.error-hint {
  color: var(--error);
  overflow-wrap: anywhere;
}

.error-actions {
  display: flex;
  gap: var(--space-sm);
  flex-shrink: 0;
}

/* 已移除成功状态的绿色背景，保持原来的白底 */

.update-card-available {
  background: var(--primary-alpha-8);
  border-color: var(--primary-border);
}

.update-version-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--primary-alpha-10);
  color: var(--primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.update-version-icon .pi {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
}

.new-version-label {
  font-weight: var(--weight-semibold);
  color: var(--primary);
}

.version-chip {
  width: fit-content;
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--radius-full);
  background: var(--primary-alpha-10);
  color: var(--primary);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  line-height: 1.35;
}

.last-check {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* 自动更新独立卡片 */
.toggle-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-lg) var(--space-lg-xl);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  margin-top: var(--space-md);
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  min-height: var(--space-4xl); /* 与 .update-status 对齐，保持卡片等高 */
  justify-content: center;
}

.toggle-card .toggle-row-label {
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
}

.toggle-card .toggle-row-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
</style>
