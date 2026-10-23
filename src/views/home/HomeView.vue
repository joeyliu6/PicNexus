<script setup lang="ts">
// 首页·快传（HomeScreen.dc.html，交接说明 8.1）：拖入 / 粘贴 / 选择文件 / 从 URL 下载 → 上传到勾选的图床 → 自动复制链接。
// 上传本身由应用级的 useUploadController 负责（在任何页面拖入都能传），这里只负责展示与把操作交给它。
import { computed, watch } from 'vue';
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
const recentUploads = useRecentUploads();
const { recent, total } = recentUploads;
const { copyLinks } = useCopyLink();

const hosts = computed(() => upload.hosts.value);
const config = computed(() => upload.config.value);
const format = computed(() => upload.linkOutput.value.defaultFormat);
const copyFrom = computed(() => upload.linkOutput.value.copyFromService);

// 新的一次上传在读元数据、压缩时还没有图：这期间焦点卡留给上一次，不让它先掉进列表再弹回来
const shown = computed(() => upload.sessions.filter((s) => upload.itemsOf(s).length > 0));
const focus = computed(() => shown.value[0] ?? null);
const focusItems = computed(() => (focus.value ? upload.itemsOf(focus.value) : []));

/** 这次打开应用后传的那些已经在列表上面了，「更早」里去掉它们；「清空」之前的也不再列出 */
const inSession = computed(() => new Set(upload.sessions.flatMap((s) => upload.itemsOf(s)).map((item) => item.historyId).filter(Boolean)));
// 一批传了 10 张：最新的几条全是它们，往前多读这么多，「更早」才不会被挤空
watch(() => inSession.value.size, (count) => { void recentUploads.reserve(count); });
const older = computed(() => recent.value.filter((item) => !inSession.value.has(item.id) && item.timestamp > upload.recentClearedAt.value).slice(0, 6));

// 图床状态、配置与图库总数读到之前不判断该用哪种布局（启动时不闪「没有图床」）
const ready = computed(() => upload.ready.value && total.value !== null);
const noHost = computed(() => hosts.value.length === 0);
const firstUse = computed(() => !noHost.value && total.value === 0 && upload.sessions.length === 0);

/** 关掉全局快捷键时不再提它（交接说明 T07 沿用到首页） */
const hotkey = computed(() => (config.value.globalShortcut?.enabled === false
  ? ''
  : formatShortcut(config.value.globalShortcut?.uploadClipboard ?? 'CommandOrControl+Shift+C', uiPlatform())));
const autoCopy = computed(() => upload.linkOutput.value.autoCopy !== false);
const selectedNames = computed(() => hosts.value.filter((h) => h.selected).map((h) => h.name));

const { open: urlDialogOpen } = useUrlDialog();
async function submitUrls(input: string) {
  if (await upload.downloadUrls(input)) urlDialogOpen.value = false;
}

function goHosts() {
  void tauriEmit('navigate-to', { view: 'settings', tab: 'hosting' });
}

function goTemplate() {
  void tauriEmit('navigate-to', { view: 'settings', section: 'customTemplate' });
}

function goCompression() {
  void tauriEmit('navigate-to', { view: 'settings', section: 'compression' });
}

function goGallery() {
  void tauriEmit('navigate-to', 'history');
}

function historyUrl(item: HistoryItem): string | undefined {
  return item.results.find((r) => r.serviceId === item.primaryService && r.status === 'success')?.result?.url ?? item.generatedLink;
}

/** 单条复制：按钮原地显示「已复制」，不弹通知（Patterns.dc.html） */
async function copyHistory(item: HistoryItem): Promise<boolean> {
  const url = historyUrl(item);
  if (!url) return false;
  const result = await copyLinks([{ url, fileName: item.localFileName, serviceId: item.primaryService }], { format: format.value, showSuccessToast: false });
  return result.ok;
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
        <HomeNoHost v-if="ready && noHost" @enable-jd="upload.enableNoConfigHost('jd')" @connect="goHosts" />

        <HomeFirstUse
          v-else-if="ready && firstUse"
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

        <template v-else-if="ready">
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
              :auto-copy="autoCopy"
              :copy-item="(itemId: string) => upload.copyItem(itemId)"
              @set-format="upload.setFormat($event)"
              @retry-failed="upload.retryFailed(focus.id)"
              @relogin="(hostId) => upload.reloginSession(focus!.id, hostId)"
              @retry-host="(hostId) => upload.retryHostForSession(focus!.id, hostId)"
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
              :auto-copy="autoCopy"
              @set-format="upload.setFormat($event)"
              @copy="upload.copySession(focus!.id)"
              @copy-all-hosts="upload.copyAllHosts(focusItems[0].id)"
              @copy-host="upload.copyItem(focusItems[0].id, $event)"
              @relogin="upload.relogin(focusItems[0].id, $event)"
              @retry-host="upload.retryHost(focusItems[0].id, $event)"
              @retry-item="upload.retryItem(focusItems[0].id)"
              @upload-again-with="upload.uploadAgainWith(focusItems[0].id, $event)"
            />
          </template>

          <!-- 列表也列出焦点卡里那一次：刚传的图马上能在列表里找到、复制 -->
          <RecentList
            v-if="shown.length || older.length"
            :sessions="shown"
            :items-of="upload.itemsOf"
            :older="older"
            :hosts="hosts"
            :config="config"
            :format="format"
            :busy="upload.busy.value"
            :copy-source-of="upload.copySourceOf"
            :copy-item="(itemId: string) => upload.copyItem(itemId)"
            :copy-session="(sessionId: string) => upload.copySession(sessionId)"
            :copy-history="copyHistory"
            @retry-item="upload.retryItem($event)"
            @retry-host="(itemId, hostId) => upload.retryHost(itemId, hostId)"
            @relogin="(itemId, hostId) => upload.relogin(itemId, hostId)"
            @retry-failed="upload.retryFailed()"
            @clear="upload.clearSessions()"
            @open-history="goGallery"
            @open-in-browser="openInBrowser"
          />
        </template>

        <!-- 渐进提示同浮层的进出：200ms 从上方 4px 淡入，140ms 淡出 -->
        <Transition name="fast-hint" appear>
          <FastUploadHint v-if="upload.showFastUploadHint.value && !firstUse" :hotkey="hotkey" @dismiss="upload.dismissFastUploadHint()" />
        </Transition>
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

/* 渐进提示的进出（规格同菜单 / 弹出层，pn-base.css）；「减少动态效果」时不挪，只淡入淡出 */
.fast-hint-enter-active { transition: opacity var(--pn-dur-standard) var(--pn-ease-in), transform var(--pn-dur-standard) var(--pn-ease-in); }
.fast-hint-leave-active { transition: opacity calc(var(--pn-dur-standard) * 0.7) var(--pn-ease-out); }
.fast-hint-enter-from { opacity: 0; transform: translateY(calc(-1 * var(--pn-space-4))); }
.fast-hint-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .fast-hint-enter-active { transition: opacity var(--pn-dur-fade-standard) var(--pn-ease-in); }
  .fast-hint-leave-active { transition: opacity calc(var(--pn-dur-fade-standard) * 0.7) var(--pn-ease-out); }
  .fast-hint-enter-from { transform: none; }
}
</style>
