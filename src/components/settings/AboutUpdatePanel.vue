<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import ProgressBar from 'primevue/progressbar';
import ToggleSwitch from 'primevue/toggleswitch';
import Divider from 'primevue/divider';
import { open } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { useAutoUpdate } from '../../composables/useAutoUpdate';
import { useToast } from '../../composables/useToast';
import appIconUrl from '../../assets/icons/app-icon.png';

interface Props {
  appVersion: string;
  autoUpdateEnabled: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:autoUpdateEnabled': [value: boolean];
  'reopenOnboarding': [];
  'save': [];
}>();

const toast = useToast();

const showWechatQR = ref(false);
const qrUrls = [
  'https://img30.360buyimg.com/imgzone/jfs/t20270426/407340/25/5886/9398/69bfb02cF39ca7cbf/093610210288c390.jpg',
  'https://p.cldisk.com/star4/a0480a62c14623325bc09b36c9bbf224/origin.jpg',
  'https://i0.hdslb.com/bfs/mallup/mall/3y/3y/3y3y2z01013wzwyz102yyz032z2y2x2z.jpg',
];
const qrUrlIndex = ref(0);

function onQrError() {
  if (qrUrlIndex.value < qrUrls.length - 1) {
    qrUrlIndex.value++;
  }
}

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

const versionCopied = ref(false);
async function copyVersion() {
  try {
    await navigator.clipboard.writeText(props.appVersion);
    versionCopied.value = true;
    setTimeout(() => { versionCopied.value = false; }, 2000);
  } catch {
    // 剪贴板权限被拒绝时静默失败
  }
}

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

async function openLogDir() {
  try {
    await invoke('open_log_dir');
  } catch (e) {
    toast.error('打开失败', '无法打开日志目录');
  }
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
          <div class="app-name-row">
            <span class="app-name">PicNexus</span>
            <span class="app-tagline">多图床上传工具</span>
          </div>
          <div class="app-version">
            版本 {{ appVersion }}
            <button class="copy-version-btn" title="复制版本号" @click="copyVersion">
              <i :class="versionCopied ? 'pi pi-check' : 'pi pi-copy'" />
            </button>
          </div>
          <div class="app-keywords">16+ 图床 · 自定义压缩 · 云端同步 · 编辑器集成 · 剪贴板上传</div>
        </div>
      </div>
    </div>

    <Divider />

    <!-- 软件更新 -->
    <div class="form-group">
      <label class="group-label">软件更新</label>
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
          @update:modelValue="(v: boolean) => { emit('update:autoUpdateEnabled', v); emit('save'); }"
        />
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
        <button class="link-card" @click="openLogDir">
          <div class="link-card-icon">
            <i class="pi pi-file" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">日志目录</span>
            <span class="link-card-desc">查看运行日志，排查问题</span>
          </div>
        </button>
        <button class="link-card" @click="showWechatQR = true">
          <div class="link-card-icon">
            <i class="pi pi-qrcode" />
          </div>
          <div class="link-card-content">
            <span class="link-card-title">公众号</span>
            <span class="link-card-desc">查看开发日志与进度</span>
          </div>
        </button>
      </div>
    </div>
  </div>

  <Dialog
    v-model:visible="showWechatQR"
    modal
    :style="{ width: '336px' }"
    :draggable="false"
    :closable="true"
    :pt="{ root: { class: 'wechat-qr-dialog' } }"
  >
    <template #header>
      <div class="wechat-dialog-header">
        <div class="wechat-header-icon-wrap">
          <i class="pi pi-qrcode" />
        </div>
        <span class="wechat-header-title">公众号</span>
      </div>
    </template>

    <div class="wechat-dialog-body">
      <div class="wechat-qr-frame">
        <img
          class="wechat-qr-img"
          :src="qrUrls[qrUrlIndex]"
          alt="公众号二维码"
          @error="onQrError"
        />
      </div>
      <div class="wechat-badge">
        <i class="pi pi-comments" />
        微信公众号
      </div>
      <p class="wechat-dialog-desc">扫码关注，查看 PicNexus 开发日志与进度。</p>
    </div>
  </Dialog>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

/* 应用信息卡片 */
.app-info-card {
  display: flex;
  align-items: flex-start;
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

.app-name-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.app-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.app-tagline {
  font-size: 13px;
  color: var(--text-muted);
}

.app-version {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.copy-version-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-muted);
  transition: color 0.15s, background 0.15s;
}

.copy-version-btn:hover {
  color: var(--primary);
  background: var(--primary-alpha-10);
}

.copy-version-btn i {
  font-size: 12px;
}

.app-keywords {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 8px;
  line-height: 1.6;
}

/* 更新卡片 */
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
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.toggle-card .toggle-row-desc {
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
  background: var(--primary-alpha-8);
}

.link-card-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--primary-alpha-10);
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
  background: var(--primary-alpha-15);
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

/* 公众号二维码弹窗 */
:global(.wechat-qr-dialog) {
  border-radius: 16px !important;
  overflow: hidden;
}

:global(.wechat-qr-dialog .p-dialog-header) {
  border-bottom: none !important;
  padding-bottom: 12px !important;
}

:global(.wechat-qr-dialog .p-dialog-content) {
  padding-top: 8px !important;
}

.wechat-dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.wechat-header-icon-wrap {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--primary-alpha-10);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wechat-header-icon-wrap i {
  font-size: 14px;
  color: var(--primary);
}

.wechat-header-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.wechat-dialog-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 8px 0 8px;
}

.wechat-qr-frame {
  padding: 16px;
  background: var(--wechat-qr-bg);
  border-radius: 12px;
  box-shadow: 0 2px 12px var(--wechat-qr-shadow);
  border: 1px solid var(--wechat-qr-border);
}

.wechat-qr-img {
  width: 180px;
  height: 180px;
  display: block;
  border-radius: 4px;
  object-fit: cover;
}

.wechat-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  border-radius: 20px;
  background: var(--wechat-green);
  color: var(--wechat-green-text);
  font-size: 12px;
  font-weight: 500;
}

.wechat-badge i {
  font-size: 12px;
}

.wechat-dialog-desc {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.7;
  margin: 0;
}
</style>
