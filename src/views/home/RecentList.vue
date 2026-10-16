<script setup lang="ts">
// 「最近上传」（HomeScreen.dc.html）：这次打开应用后的上传（焦点卡之外的），再往下是「更早」的图库记录。
// 「清空」只清这个列表，不影响图库记录；上传中不可清空。
import { computed } from 'vue';
import PetalGlyph from '@/components/biz/PetalGlyph.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import type { HistoryItem, UserConfig } from '@/config/types';
import type { QueueItem } from '@/core/UploadQueue';
import { getThumbnailCandidates } from '@/composables/image/useThumbCache';
import { useConfirmedHttpHosts } from '@/composables/image/useConfirmedHttpHosts';
import { formatLinkWithConfig } from '@/composables/useCopyLink';
import type { UploadHost } from '@/composables/upload/useUploadController';
import { firstFailure, hostViews, itemPhase, petalStates, sessionCounts, type UploadSession } from '@/composables/upload/uploadSessions';
import { formatRelativeTime, formatShortDateTime } from '@/utils/formatters';
import type { LinkFormat } from '@/utils/linkFormatter';
import { cleanMigrateError } from '@/utils/uploadFailureMessage';
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
}>();

const emit = defineEmits<{
  copyItem: [itemId: string];
  copySession: [sessionId: string];
  retryItem: [itemId: string];
  retryHost: [itemId: string, hostId: string];
  relogin: [itemId: string, hostId: string];
  retryFailed: [];
  clear: [];
  copyHistory: [item: HistoryItem];
  openHistory: [item: HistoryItem];
  openInBrowser: [item: HistoryItem];
}>();

const nameOf = (hostId: string) => props.hosts.find((h) => h.id === hostId)?.name ?? hostId;
const confirmedHttpHosts = useConfirmedHttpHosts(() => props.config);
const isCookieHost = (hostId: string) => props.hosts.find((h) => h.id === hostId)?.cookieLogin ?? false;

const rows = computed(() => props.sessions.map((session) => {
  const items = props.itemsOf(session);
  return { session, items, batch: items.length > 1 };
}).filter((row) => row.items.length > 0));

const hasFailures = computed(() => rows.value.some((row) => row.items.some((item) => ['failed', 'partial'].includes(itemPhase(item)))));

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

function doneTitle(item: QueueItem): string {
  return hostViews(item).filter((h) => h.state === 'done').map((h) => nameOf(h.id)).join(' · ');
}

function failedHostOf(item: QueueItem) {
  return hostViews(item).find((h) => h.state === 'failed');
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
        v-if="rows.length"
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
            <PnButton variant="ghost" size="sm" :disabled="sessionCounts(row.items).done === 0" @click="emit('copySession', row.session.id)">复制全部</PnButton>
          </template>
        </RecentRow>
        <RecentRow
          v-else
          :name="row.items[0].fileName"
          :time="formatRelativeTime(row.session.startedAt)"
          :thumb-srcs="itemPhase(row.items[0]) === 'failed' ? [] : getThumbnailCandidates(row.items[0], config)"
          :confirmed-http-hosts="confirmedHttpHosts"
        >
          <template #second>
            <span v-if="itemPhase(row.items[0]) === 'failed'" class="recent__danger">
              上传失败 · {{ firstFailure(row.items[0]) ? cleanMigrateError(firstFailure(row.items[0])!.id, firstFailure(row.items[0])!.error ?? '') : '上传失败' }}
            </span>
            <span v-else class="recent__mono">{{ linkText(row.items[0]) }}</span>
          </template>
          <template #action>
            <span v-if="itemPhase(row.items[0]) === 'uploading'" class="recent__status" :title="doneTitle(row.items[0])">
              <PetalGlyph :states="petalStates(row.items[0])" :size="16" />
              {{ uploadingLabel(row.items[0]) }}
            </span>
            <button
              v-else-if="itemPhase(row.items[0]) === 'partial'"
              type="button"
              class="recent__failed-host"
              :title="failedHostOf(row.items[0]) ? `${nameOf(failedHostOf(row.items[0])!.id)}：${cleanMigrateError(failedHostOf(row.items[0])!.id, failedHostOf(row.items[0])!.error ?? '')}` : undefined"
              @click="onPartialFailure(row.items[0])"
            >
              <PetalGlyph :states="petalStates(row.items[0])" :size="16" />
              {{ failedHostOf(row.items[0]) ? nameOf(failedHostOf(row.items[0])!.id) : '' }}失败
            </button>
            <PnButton v-else-if="itemPhase(row.items[0]) === 'failed'" variant="ghost" size="sm" @click="emit('retryItem', row.items[0].id)">重试</PnButton>
            <span v-else :title="doneTitle(row.items[0])" class="recent__status">
              <PetalGlyph :states="petalStates(row.items[0])" :size="16" />
            </span>
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
      >
        <template #second><span class="recent__mono">{{ historyLink(item) }}</span></template>
        <template #action>
          <PnButton variant="secondary" size="sm" @click="emit('copyHistory', item)">
            <PnIcon name="copy" :size="13" :stroke="1.9" />
            复制
          </PnButton>
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

.recent__ghost:hover { background: var(--pn-selected); }
.recent__ghost--off { color: var(--pn-disabled); cursor: default; }
.recent__ghost--off:hover { background: transparent; }

.recent__rows { display: flex; flex-direction: column; gap: var(--pn-space-2); }

.recent__mono { font-family: var(--pn-font-mono); font-size: var(--pn-text-mono); }
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
