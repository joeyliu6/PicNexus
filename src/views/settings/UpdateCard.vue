<script setup lang="ts">
// 更新卡片（S07 / S16–S21）：检查中、已是最新、发现新版本、下载中、正在安装、已安装重启完成、失败。
// 发现新版本时直接列出这版改了什么；下载期间照常使用、离开这一页也会继续；重启前等正在进行的上传传完。
// 失败写中文原因 +「手动下载」「重试」两个下一步（英文原文只进日志与悬停提示）。
import { computed } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import { useAutoUpdate } from '@/composables/useAutoUpdate';
import { useToast } from '@/composables/useToast';
import { openTrustedExternalUrl } from '@/security/shellOpen';
import { formatRelativeTime } from '@/utils/formatters';
import { formatUpdateFailure } from '@/utils/updateFailureMessage';
import { downloadSize, releaseNotes, updateFailureTitle } from './updateText';
import { useCloudSync } from './useCloudSync';

const RELEASES_URL = 'https://github.com/joeyliu6/PicNexus/releases/latest';

const update = useAutoUpdate();
// 每页最多一个主按钮：页顶刷新横幅的「刷新」在时，这里的按钮退成次要按钮
const cloud = useCloudSync();
const bannerShown = computed(() => cloud.needsReload.value !== null);
const toast = useToast();

type Tone = 'plain' | 'brand' | 'success' | 'danger';
interface View {
  title: string;
  sub: string;
  tone: Tone;
  spin?: boolean;
  bar?: boolean;
  notes?: string[];
  buttons: { label: string; primary?: boolean; run: () => void }[];
}

async function manualDownload(): Promise<void> {
  try {
    await openTrustedExternalUrl(RELEASES_URL);
  } catch {
    toast.error('未能打开下载页', `请在浏览器中访问 ${RELEASES_URL}`);
  }
}

const version = computed(() => update.updateInfo.value?.version ?? '');
const check = { label: '检查更新', run: () => { void update.checkForUpdate(); } };

const view = computed<View>(() => {
  switch (update.status.value) {
    case 'checking':
      return { title: '正在检查更新…', sub: '', tone: 'plain', spin: true, buttons: [] };
    case 'up-to-date':
      return {
        title: '已是最新版本',
        sub: update.lastCheckTime.value ? `上次检查：${formatRelativeTime(update.lastCheckTime.value)}` : '',
        tone: 'plain',
        buttons: [check],
      };
    case 'available':
      return {
        title: `发现新版本 ${version.value}`,
        sub: '安装过程中应用将自动重启',
        tone: 'brand',
        notes: releaseNotes(update.updateInfo.value?.body ?? ''),
        buttons: [{ label: '立即更新', primary: true, run: () => { void update.downloadAndInstall(); } }],
      };
    case 'downloading': {
      const total = update.totalBytes.value;
      const size = total > 0 ? ` · ${downloadSize(update.downloadedBytes.value, total)}` : '';
      return {
        title: `正在下载 ${version.value}${size}`,
        sub: '下载期间可继续使用',
        tone: 'plain',
        bar: true,
        buttons: [{ label: '取消', run: update.cancelDownload }],
      };
    }
    case 'installing':
      return {
        title: '正在安装…',
        sub: update.waitingForUploads.value ? '正在等待上传完成，完成后开始安装' : '安装完成后应用将自动重启',
        tone: 'plain',
        spin: true,
        buttons: [],
      };
    case 'install-pending':
      return {
        title: `${version.value} 已安装`,
        sub: update.waitingForUploads.value ? '正在等待上传完成，完成后重启' : '重启后生效；进行中的上传会先完成',
        tone: 'success',
        buttons: update.waitingForUploads.value ? [] : [{ label: '重启完成更新', primary: true, run: () => { void update.retryRelaunch(); } }],
      };
    case 'error': {
      const phase = update.pendingUpdateAvailable.value ? 'download' : 'check';
      const failure = formatUpdateFailure(phase, update.errorMessage.value);
      return {
        title: updateFailureTitle(failure.title),
        sub: failure.hint,
        tone: 'danger',
        buttons: [
          { label: '手动下载', run: () => { void manualDownload(); } },
          { label: '重试', primary: true, run: () => { void (phase === 'download' ? update.retryDownload() : update.checkForUpdate()); } },
        ],
      };
    }
    default:
      return { title: '尚未检查更新', sub: '', tone: 'plain', buttons: [check] };
  }
});
</script>

<template>
  <div class="update" :class="`update--${view.tone}`" data-setting-row="update" role="status">
    <div class="update__row">
      <svg v-if="view.spin" class="update__spin" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" fill="none" class="update__spin-track" stroke-width="2" />
        <circle cx="8" cy="8" r="6" fill="none" class="update__spin-arc" stroke-width="2" stroke-dasharray="12 37.7" stroke-linecap="round" />
      </svg>
      <div class="update__text">
        <span class="update__title" :title="view.tone === 'danger' ? update.errorMessage.value : undefined">{{ view.title }}</span>
        <span v-if="view.sub" class="update__sub">{{ view.sub }}</span>
      </div>
      <PnButton
        v-for="button in view.buttons"
        :key="button.label"
        :variant="button.primary && !bannerShown ? 'primary' : 'secondary'"
        size="md"
        @click="button.run"
      >
        {{ button.label }}
      </PnButton>
    </div>
    <div v-if="view.bar" class="update__bar" role="progressbar" :aria-valuenow="update.downloadProgress.value" aria-valuemin="0" aria-valuemax="100">
      <div class="update__fill" :style="{ width: `${update.downloadProgress.value}%` }" />
    </div>
    <ul v-if="view.notes?.length" class="update__notes">
      <li v-for="note in view.notes" :key="note">· {{ note }}</li>
    </ul>
  </div>
</template>

<style scoped>
.update {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-sidebar-x);
  padding: var(--pn-space-16);
  border-radius: var(--pn-radius-settings-card) var(--pn-radius-settings-card) 0 0;
  background: var(--pn-subtle);
  box-shadow: 0 0 0 1px var(--pn-border);
}

.update--brand { background: var(--pn-brand-soft); }
.update--success { background: var(--pn-success-soft); }
.update--danger { background: var(--pn-danger-soft); }

.update__row {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
}

.update__spin { flex: none; animation: k-spin var(--pn-dur-spin) linear infinite; }
.update__spin-track { stroke: var(--pn-track); }
.update__spin-arc { stroke: var(--pn-brand); transform: rotate(-90deg); transform-origin: center; }

.update__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.update__title { font-weight: var(--pn-weight-semibold); }
.update--danger .update__title { color: var(--pn-danger); }

.update__sub {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.update__bar {
  height: var(--pn-size-backup-strength-bar);
  overflow: hidden;
  border-radius: var(--pn-radius-backup-strength-bar);
  background: var(--pn-track);
}

.update__fill {
  height: 100%;
  border-radius: var(--pn-radius-backup-strength-bar);
  background: var(--pn-brand);
  transition: width var(--pn-dur-standard) var(--pn-ease-in);
}

.update__notes {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-update-notes);
  margin: 0;
  padding: 0;
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  list-style: none;
}
</style>
