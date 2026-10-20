<script setup lang="ts">
// 「最近上传」（HomeScreen.dc.html）：这次打开应用后的上传（含焦点卡里那一次），再往下是「更早」的图库记录。
// 点缩略图看大图（原图在前、缩略图垫后）；点第二行的链接直接复制，原地变「已复制」。
// 每行平时只写状态（花瓣）；悬停或键盘聚焦时右侧换成「复制 ⋯」。失败、部分失败、上传中的行一直露着自己的下一步。
// 「清空」只清这个列表，不影响图库记录；上传中不可清空。单条复制在按钮上原地显示「已复制」，不弹通知。
import { computed, ref } from 'vue';
import CopyButton from '@/components/biz/CopyButton.vue';
import ImageViewer from '@/components/biz/ImageViewer.vue';
import PetalGlyph from '@/components/biz/PetalGlyph.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import type { HistoryItem, UserConfig } from '@/config/types';
import type { QueueItem } from '@/core/UploadQueue';
import { getThumbnailCandidates } from '@/composables/image/useThumbCache';
import { useConfirmedHttpHosts } from '@/composables/image/useConfirmedHttpHosts';
import { getImageMetadata } from '@/composables/image/useImageMetadata';
import { useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import { formatLinkWithConfig, type CopyLinkResult } from '@/composables/useCopyLink';
import type { UploadHost } from '@/composables/upload/useUploadController';
import { firstFailure, hostFailureText, hostViews, itemPhase, petalStates, sessionCounts, type UploadSession } from '@/composables/upload/uploadSessions';
import { formatFileSize, formatRelativeTime, formatShortDateTime } from '@/utils/formatters';
import type { LinkFormat } from '@/utils/linkFormatter';
import type { PetalState } from '@/utils/petals';
import RecentRow from './RecentRow.vue';

const props = defineProps<{
  sessions: readonly UploadSession[];
  itemsOf: (session: UploadSession) => QueueItem[];
  older: readonly HistoryItem[];
  hosts: readonly UploadHost[];
  config: UserConfig;
  format: LinkFormat;
  busy: boolean;
  copySourceOf: (item: QueueItem) => string | undefined;
  copyItem: (itemId: string) => Promise<CopyLinkResult | null>;
  copySession: (sessionId: string) => Promise<CopyLinkResult | null>;
  copyHistory: (item: HistoryItem) => Promise<boolean>;
}>();

const emit = defineEmits<{
  retryItem: [itemId: string];
  retryHost: [itemId: string, hostId: string];
  relogin: [itemId: string, hostId: string];
  retryFailed: [];
  clear: [];
  openHistory: [item: HistoryItem];
  openInBrowser: [item: HistoryItem];
}>();

const nameOf = (hostId: string) => props.hosts.find((h) => h.id === hostId)?.name ?? hostId;
const confirmedHttpHosts = useConfirmedHttpHosts(() => props.config);
const isCookieHost = (hostId: string) => props.hosts.find((h) => h.id === hostId)?.cookieLogin ?? false;
const { copiedKey, markCopied } = useCopyBadgeFeedback(1500);

const rows = computed(() => props.sessions.map((session) => {
  const items = props.itemsOf(session);
  return { session, items, batch: items.length > 1 };
}).filter((row) => row.items.length > 0));

/** 「重试失败的」只管整张失败的；只缺某个图床的那几行各有自己的按钮 */
const hasFailures = computed(() => rows.value.some((row) => row.items.some((item) => itemPhase(item) === 'failed')));

function linkText(item: QueueItem): string {
  const source = props.copySourceOf(item);
  const url = source ? item.serviceProgress[source]?.link : undefined;
  return url ? formatLinkWithConfig({ url, fileName: item.fileName, serviceId: source }, props.config, props.format) : '';
}

function historyLink(item: HistoryItem): string {
  const primary = item.results.find((r) => r.serviceId === item.primaryService && r.status === 'success')?.result;
  const url = primary?.url ?? item.generatedLink;
  return url ? formatLinkWithConfig({ url, fileName: item.localFileName, serviceId: item.primaryService }, props.config, props.format) : '';
}

function doneNames(item: QueueItem): string {
  return hostViews(item).filter((h) => h.state === 'done').map((h) => nameOf(h.id)).join(' · ');
}

/** 花瓣的读屏文字：「2 份都已完成」/「上传中 1/2」 */
function petalLabel(item: QueueItem): string {
  const hosts = hostViews(item);
  const done = hosts.filter((h) => h.state === 'done').length;
  if (itemPhase(item) === 'uploading') return `上传中 ${done}/${hosts.length}`;
  return done === hosts.length ? `${done} 份都已完成` : `${done}/${hosts.length} 份已完成`;
}

function historyPetals(item: HistoryItem): PetalState[] {
  return item.results.filter((r) => r.status === 'success').map(() => 'ok');
}

function failedHostOf(item: QueueItem) {
  return hostViews(item).find((h) => h.state === 'failed');
}

/** 失败的说法：原因 + 处理办法（交接说明第 9 节；「网络超时，请检查网络后重试」） */
function failureLine(hostId: string, error: string | undefined): string {
  const { reason, advice } = hostFailureText(hostId, error, props.hosts);
  return `${reason}，${advice}`;
}

function uploadingLabel(item: QueueItem): string {
  const hosts = hostViews(item);
  return `上传中 ${hosts.filter((h) => h.state === 'done').length}/${hosts.length}`;
}

function onPartialFailure(item: QueueItem) {
  const host = failedHostOf(item);
  if (!host) return;
  if (isCookieHost(host.id)) emit('relogin', item.id, host.id);
  else emit('retryHost', item.id, host.id);
}

async function copy(key: string, run: () => Promise<CopyLinkResult | boolean | null>): Promise<void> {
  const result = await run();
  if (result === true || (result && typeof result === 'object' && result.ok)) markCopied(key);
}

// ---- 看大图 ----
const viewer = ref<{ srcs: string[]; name: string; width?: number; height?: number; meta?: string } | null>(null);
const viewerOpen = computed({ get: () => !!viewer.value, set: (open: boolean) => { if (!open) viewer.value = null; } });
const dims = (width?: number, height?: number, size?: number) => [width && height ? `${width} × ${height}` : '', size ? formatFileSize(size) : ''].filter(Boolean).join(' · ');

async function viewItem(item: QueueItem): Promise<void> {
  const source = props.copySourceOf(item);
  const links = [source, ...hostViews(item).filter((h) => h.state === 'done').map((h) => h.id)]
    .map((hostId) => (hostId ? item.serviceProgress[hostId]?.link : undefined))
    .filter((link): link is string => !!link);
  const meta = await getImageMetadata(item.filePath).catch(() => null);
  viewer.value = {
    srcs: [...new Set([...links, ...getThumbnailCandidates(item, props.config)])],
    name: item.fileName,
    width: meta?.width,
    height: meta?.height,
    meta: dims(meta?.width, meta?.height, meta?.file_size),
  };
}

function viewHistory(item: HistoryItem): void {
  const links = [item.primaryService, ...item.results.map((r) => r.serviceId)]
    .map((hostId) => item.results.find((r) => r.serviceId === hostId && r.status === 'success')?.result?.url)
    .filter((link): link is string => !!link);
  viewer.value = {
    srcs: [...new Set([...links, ...getThumbnailCandidates(item, props.config)])],
    name: item.localFileName,
    width: item.width,
    height: item.height,
    meta: dims(item.width, item.height, item.fileSize),
  };
}

function truncated(name: string): string {
  return name.length > 28 ? `${name.slice(0, 20)}…${name.slice(-8)}` : name;
}
</script>

<template>
  <section class="recent" aria-label="最近上传">
    <div class="recent__head">
      <h2 class="recent__title">最近上传</h2>
      <div class="recent__spacer" />
      <button v-if="hasFailures" type="button" class="recent__ghost" @click="emit('retryFailed')">重试失败的</button>
      <button
        v-if="rows.length || older.length"
        type="button"
        class="recent__ghost"
        :class="{ 'recent__ghost--off': busy }"
        :title="busy ? '上传完成后可清空' : '仅清空此列表，不影响图库记录'"
        :aria-disabled="busy"
        @click="!busy && emit('clear')"
      >
        清空
      </button>
    </div>

    <div class="recent__rows">
      <template v-for="row in rows" :key="row.session.id">
        <RecentRow
          v-if="row.batch"
          stacked
          :name="`${row.items[0].fileName} 等 ${row.items.length} 张`"
          :time="formatRelativeTime(row.session.startedAt)"
          :thumb-srcs="getThumbnailCandidates(row.items[0], config)"
          :confirmed-http-hosts="confirmedHttpHosts"
        >
          <template #second>
            {{ sessionCounts(row.items).done }} 张已完成<template v-if="sessionCounts(row.items).failed"> · <span class="recent__danger">{{ sessionCounts(row.items).failed }} 张失败</span></template>
          </template>
          <template #action>
            <CopyButton
              v-if="sessionCounts(row.items).done > 0"
              label="复制全部"
              :copied="copiedKey === `session:${row.session.id}`"
              @click="copy(`session:${row.session.id}`, () => copySession(row.session.id))"
            />
          </template>
        </RecentRow>
        <RecentRow
          v-else
          :name="row.items[0].fileName"
          :time="formatRelativeTime(row.session.startedAt)"
          :thumb-srcs="itemPhase(row.items[0]) === 'failed' ? [] : getThumbnailCandidates(row.items[0], config)"
          :confirmed-http-hosts="confirmedHttpHosts"
          :viewable="itemPhase(row.items[0]) !== 'uploading'"
          @view="viewItem(row.items[0])"
        >
          <template #second>
            <span v-if="itemPhase(row.items[0]) === 'failed'" class="recent__danger">
              上传失败 · {{ firstFailure(row.items[0]) ? failureLine(firstFailure(row.items[0])!.id, firstFailure(row.items[0])!.error) : '请稍后重试' }}
            </span>
            <button
              v-else-if="itemPhase(row.items[0]) !== 'uploading' && linkText(row.items[0])"
              type="button"
              class="recent__mono recent__link"
              :class="{ 'recent__link--done': copiedKey === `item:${row.items[0].id}` }"
              title="点击复制"
              @click="copy(`item:${row.items[0].id}`, () => copyItem(row.items[0].id))"
            >
              {{ copiedKey === `item:${row.items[0].id}` ? '已复制' : linkText(row.items[0]) }}
            </button>
            <span v-else class="recent__mono">{{ linkText(row.items[0]) }}</span>
          </template>
          <template #action>
            <span v-if="itemPhase(row.items[0]) === 'uploading'" class="recent__status">
              <PetalGlyph :states="petalStates(row.items[0])" :size="16" :label="petalLabel(row.items[0])" />
              {{ uploadingLabel(row.items[0]) }}
            </span>
            <button
              v-else-if="itemPhase(row.items[0]) === 'partial'"
              type="button"
              class="recent__failed-host"
              :title="failedHostOf(row.items[0]) ? `${nameOf(failedHostOf(row.items[0])!.id)}：${failureLine(failedHostOf(row.items[0])!.id, failedHostOf(row.items[0])!.error)}` : undefined"
              @click="onPartialFailure(row.items[0])"
            >
              <PetalGlyph :states="petalStates(row.items[0])" :size="16" :label="petalLabel(row.items[0])" />
              {{ failedHostOf(row.items[0]) ? nameOf(failedHostOf(row.items[0])!.id) : '' }}失败
            </button>
            <PnButton v-else-if="itemPhase(row.items[0]) === 'failed'" variant="ghost" size="sm" @click="emit('retryItem', row.items[0].id)">重试</PnButton>
            <span v-else :title="doneNames(row.items[0])" class="recent__status">
              <PetalGlyph :states="petalStates(row.items[0])" :size="16" :label="petalLabel(row.items[0])" />
            </span>
          </template>
          <template v-if="itemPhase(row.items[0]) === 'done'" #hover>
            <CopyButton :copied="copiedKey === `item:${row.items[0].id}`" @click="copy(`item:${row.items[0].id}`, () => copyItem(row.items[0].id))" />
          </template>
        </RecentRow>
      </template>

      <div v-if="rows.length && older.length" class="recent__divider">
        <span>更早</span>
        <span class="recent__divider-line" />
      </div>
      <RecentRow
        v-for="item in older"
        :key="item.id"
        :name="truncated(item.localFileName)"
        :full-name="item.localFileName"
        :time="formatShortDateTime(item.timestamp)"
        :thumb-srcs="getThumbnailCandidates(item, config)"
        :confirmed-http-hosts="confirmedHttpHosts"
        viewable
        @view="viewHistory(item)"
      >
        <template #second>
          <button
            v-if="historyLink(item)"
            type="button"
            class="recent__mono recent__link"
            :class="{ 'recent__link--done': copiedKey === `history:${item.id}` }"
            title="点击复制"
            @click="copy(`history:${item.id}`, () => copyHistory(item))"
          >
            {{ copiedKey === `history:${item.id}` ? '已复制' : historyLink(item) }}
          </button>
        </template>
        <template #action>
          <span class="recent__status">
            <PetalGlyph :states="historyPetals(item)" :size="16" :label="`${historyPetals(item).length} 份`" />
          </span>
        </template>
        <template #hover>
          <CopyButton :copied="copiedKey === `history:${item.id}`" @click="copy(`history:${item.id}`, () => copyHistory(item))" />
          <PnMenu align="end" :width="200">
            <template #trigger>
              <button type="button" class="recent__more" aria-label="更多操作">
                <PnIcon name="more" :size="15" :stroke="2" />
              </button>
            </template>
            <PnMenuItem @select="emit('openHistory', item)">在图库中查看</PnMenuItem>
            <PnMenuItem @select="emit('openInBrowser', item)">在浏览器打开</PnMenuItem>
          </PnMenu>
        </template>
      </RecentRow>
    </div>

    <ImageViewer
      v-model:open="viewerOpen" :srcs="viewer?.srcs ?? []" :name="viewer?.name ?? ''" :width="viewer?.width" :height="viewer?.height"
      :meta="viewer?.meta" :confirmed-http-hosts="confirmedHttpHosts"
    />
  </section>
</template>

<style scoped>
.recent { margin-top: var(--pn-space-recent-top); }

.recent__head {
  display: flex;
  align-items: center;
  padding: 0 var(--pn-space-12) var(--pn-space-6);
}

.recent__title { margin: 0; font-size: var(--pn-text-body); font-weight: var(--pn-weight-semibold); }
.recent__spacer { flex: 1; }

.recent__ghost {
  height: var(--pn-size-seg-item);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  font-size: var(--pn-text-footnote);
  cursor: pointer;
}

.recent__ghost:last-child { margin-right: calc(-1 * var(--pn-space-8)); }
.recent__ghost:hover { background: var(--pn-selected); }
.recent__ghost--off { color: var(--pn-disabled); cursor: default; }
.recent__ghost--off:hover { background: transparent; }

.recent__rows { display: flex; flex-direction: column; gap: var(--pn-space-2); }

.recent__mono { font-family: var(--pn-font-mono); font-size: var(--pn-text-mono); }

/* 第二行的链接：点击复制（悬停变品牌色，复制后原地写「已复制」） */
.recent__link {
  display: block;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: copy;
}

.recent__link:hover { color: var(--pn-brand-text); }

.recent__link--done,
.recent__link--done:hover { color: var(--pn-success); font-family: var(--pn-font-ui); }
.recent__danger { color: var(--pn-danger); }

.recent__status {
  display: flex;
  align-items: center;
  gap: var(--pn-space-recent-status-gap);
  font-size: var(--pn-text-footnote);
  color: var(--pn-text2);
}

.recent__failed-host {
  display: flex;
  align-items: center;
  gap: var(--pn-space-recent-status-gap);
  height: var(--pn-size-seg-item);
  padding: 0 var(--pn-space-6);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-danger);
  font: inherit;
  font-size: var(--pn-text-footnote);
  cursor: pointer;
}

.recent__failed-host:hover { background: var(--pn-danger-soft); }

.recent__more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-seg-item);
  height: var(--pn-size-button-sm);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-text2);
  cursor: pointer;
}

.recent__more:hover,
.recent__more[data-state='open'] { background: var(--pn-selected); }

.recent__divider {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
  padding: var(--pn-space-toast-left) var(--pn-space-12) var(--pn-space-4);
  font-size: var(--pn-text-footnote);
  color: var(--pn-text3);
}

.recent__divider-line { flex: 1; height: 1px; background: var(--pn-border); }
</style>
