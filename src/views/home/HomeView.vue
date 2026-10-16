<script setup lang="ts">
// 首页·快传（HomeScreen.dc.html，交接说明 8.1）：拖入 / 粘贴 / 选择文件 / 从 URL 下载 → 上传到勾选的图床 → 自动复制链接。
// 上传本身由应用级的 useUploadController 负责（在任何页面拖入都能传），这里只负责展示与把操作交给它。
import { computed } from 'vue';
import { emit as tauriEmit } from '@tauri-apps/api/event';
import BgDecor from '@/components/biz/BgDecor.vue';
import type { HistoryItem } from '@/config/types';
import { useRecentUploads } from '@/composables/history/useRecentUploads';
import { useCopyLink, applyConfiguredUrlWithConfig } from '@/composables/useCopyLink';
import { useUploadController } from '@/composables/upload/useUploadController';
import { openUserExternalUrl } from '@/security/shellOpen';
import TitleRow from '@/shell/TitleRow.vue';
import { useUrlDialog } from '@/shell/useUrlDialog';
import { uiPlatform } from '@/utils/platform';
import { formatShortcut } from '@/utils/shortcutText';
import BatchCard from './BatchCard.vue';
import FastUploadHint from './FastUploadHint.vue';
import FocusCard from './FocusCard.vue';
import HomeDropBar from './HomeDropBar.vue';
import HomeFirstUse from './HomeFirstUse.vue';
import HomeNoHost from './HomeNoHost.vue';
import HomeOptionsRow from './HomeOptionsRow.vue';
import RecentList from './RecentList.vue';
import UrlDownloadDialog from './UrlDownloadDialog.vue';

const upload = useUploadController();
const { recent, total } = useRecentUploads();
const { copyLinks } = useCopyLink();

const hosts = computed(() => upload.hosts.value);
const config = computed(() => upload.config.value);
const format = computed(() => upload.linkOutput.value.defaultFormat);
const copyFrom = computed(() => upload.linkOutput.value.copyFromService);

const focus = computed(() => upload.sessions[0] ?? null);
const focusItems = computed(() => (focus.value ? upload.itemsOf(focus.value) : []));
const restSessions = computed(() => upload.sessions.slice(1));

/** 这次打开应用后传的那些已经在列表上面了，「更早」里去掉它们 */
const older = computed(() => {
  const inSession = new Set(upload.sessions.flatMap((s) => upload.itemsOf(s)).map((item) => item.historyId).filter(Boolean));
  return recent.value.filter((item) => !inSession.has(item.id)).slice(0, 6);
});

const noHost = computed(() => hosts.value.length === 0);
const firstUse = computed(() => !noHost.value && total.value === 0 && upload.sessions.length === 0);

const hotkey = computed(() => formatShortcut(config.value.globalShortcut?.uploadClipboard ?? 'CommandOrControl+Shift+C', uiPlatform()));
const selectedNames = computed(() => hosts.value.filter((h) => h.selected).map((h) => h.name));

const { open: urlDialogOpen } = useUrlDialog();
async function submitUrls(input: string) {
  if (await upload.downloadUrls(input)) urlDialogOpen.value = false;
}

function goHosts() {
  void tauriEmit('navigate-to', { view: 'settings', tab: 'hosting' });
}

function goTemplate() {
  void tauriEmit('navigate-to', { view: 'settings', tab: 'general' });
}

function goCompression() {
  void tauriEmit('navigate-to', { view: 'settings', tab: 'compression', section: 'imageCompression' });
}

function goGallery() {
  void tauriEmit('navigate-to', 'history');
}

function historyUrl(item: HistoryItem): string | undefined {
  return item.results.find((r) => r.serviceId === item.primaryService && r.status === 'success')?.result?.url ?? item.generatedLink;
}

async function copyHistory(item: HistoryItem) {
  const url = historyUrl(item);
  if (url) await copyLinks([{ url, fileName: item.localFileName, serviceId: item.primaryService }], { format: format.value });
}

async function openInBrowser(item: HistoryItem) {
  const url = historyUrl(item);
  if (url) await openUserExternalUrl(applyConfiguredUrlWithConfig(url, item.primaryService, config.value));
}
</script>

<template>
  <div class="home">
    <TitleRow />
    <BgDecor fade-from="52px" fade-to="104px" />
    <div class="home__scroll">
      <div class="home__column">
        <HomeNoHost v-if="noHost" @enable-jd="upload.enableNoConfigHost('jd')" @connect="goHosts" />

        <HomeFirstUse
          v-else-if="firstUse"
          :hosts="hosts"
          :format="format"
          :copy-from="copyFrom"
          :hotkey="hotkey"
          @pick="upload.pickAndUpload()"
          @url="urlDialogOpen = true"
          @toggle-host="upload.toggleHost($event)"
          @enable-host="upload.enableNoConfigHost($event)"
          @set-copy-from="upload.setCopyFrom($event)"
          @set-format="upload.setFormat($event)"
          @manage-hosts="goHosts"
        />

        <template v-else>
          <HomeDropBar :busy="upload.busy.value" @pick="upload.pickAndUpload()" @paste="upload.pasteClipboard()" @url="urlDialogOpen = true" />
          <HomeOptionsRow
            :hosts="hosts"
            :format="format"
            :copy-from="copyFrom"
            :compression="upload.compression.value"
            :active-preset="upload.activePreset.value"
            @toggle-host="upload.toggleHost($event)"
            @set-copy-from="upload.setCopyFrom($event)"
            @set-format="upload.setFormat($event)"
            @set-compression="upload.setCompression($event)"
            @manage-hosts="goHosts"
            @edit-template="goTemplate"
            @compression-settings="goCompression"
            @relogin="upload.loginHost($event)"
          />

          <template v-if="focus && focusItems.length">
            <BatchCard
              v-if="focusItems.length > 1"
              :session="focus"
              :items="focusItems"
              :hosts="hosts"
              :config="config"
              :format="format"
              @copy-item="upload.copyItem($event)"
              @set-format="upload.setFormat($event)"
              @retry-failed="upload.retryFailed(focus.id)"
              @relogin="(hostId) => focusItems[0] && upload.relogin(focusItems[0].id, hostId)"
              @open-in-gallery="goGallery"
            />
            <FocusCard
              v-else
              :item="focusItems[0]"
              :session="focus"
              :hosts="hosts"
              :config="config"
              :format="format"
              :copy-source="upload.copySourceOf(focusItems[0])"
              @set-format="upload.setFormat($event)"
              @copy-host="upload.copyItem(focusItems[0].id, $event)"
              @relogin="upload.relogin(focusItems[0].id, $event)"
              @retry-host="upload.retryHost(focusItems[0].id, $event)"
              @retry-item="upload.retryItem(focusItems[0].id)"
              @upload-again-with="upload.uploadAgainWith(focusItems[0].id, $event)"
              @open-in-gallery="goGallery"
            />
          </template>

          <RecentList
            v-if="restSessions.length || older.length"
            :sessions="restSessions"
            :items-of="upload.itemsOf"
            :older="older"
            :hosts="hosts"
            :config="config"
            :format="format"
            :busy="upload.busy.value"
            :copy-source-of="upload.copySourceOf"
            @copy-item="upload.copyItem($event)"
            @copy-session="upload.copySession($event)"
            @retry-item="upload.retryItem($event)"
            @retry-host="(itemId, hostId) => upload.retryHost(itemId, hostId)"
            @relogin="(itemId, hostId) => upload.relogin(itemId, hostId)"
            @retry-failed="upload.retryFailed()"
            @clear="upload.clearSessions()"
            @copy-history="copyHistory"
            @open-history="goGallery"
            @open-in-browser="openInBrowser"
          />
        </template>

        <FastUploadHint v-if="upload.showFastUploadHint.value && !firstUse" :hotkey="hotkey" @dismiss="upload.dismissFastUploadHint()" />
      </div>
    </div>

    <UrlDownloadDialog v-model:open="urlDialogOpen" :host-names="selectedNames" :downloading="upload.isDownloading.value" @submit="submitUrls" />
  </div>
</template>

<style scoped>
.home {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  isolation: isolate;
}

.home__scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.home__column {
  position: relative;
  display: flex;
  flex-direction: column;
  width: var(--pn-size-home-column);
  max-width: calc(100% - 2 * var(--pn-space-24));
  margin: 0 auto;
  padding: var(--pn-space-12) 0 var(--pn-space-32);
}
</style>
