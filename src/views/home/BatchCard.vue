<script setup lang="ts">
// 批量卡（HomeScreen.dc.html H08 / H09）：每张一块缩略图（完成 / 进度环 / 等待中变灰），同时传 3 张；
// 整批结束前不动剪贴板，结束后一次复制全部成功的链接（每行一个、按拖入顺序）。
// 某个图床整批失败只报一行；「重试这 N 张」只重传失败的；点任意一块 = 复制那一张。
import { computed, ref } from 'vue';
import CopyButton from '@/components/biz/CopyButton.vue';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import type { UserConfig } from '@/config/types';
import type { QueueItem } from '@/core/UploadQueue';
import { getThumbnailCandidates } from '@/composables/image/useThumbCache';
import { useConfirmedHttpHosts } from '@/composables/image/useConfirmedHttpHosts';
import { useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import type { CopyLinkResult } from '@/composables/useCopyLink';
import type { UploadHost } from '@/composables/upload/useUploadController';
import { firstFailure, hostFailureText, hostMisses, hostViews, itemPhase, sessionCounts, type UploadSession } from '@/composables/upload/uploadSessions';
import { formatRelativeTime } from '@/utils/formatters';
import { FORMAT_NAMES, type LinkFormat } from '@/utils/linkFormatter';

const props = defineProps<{
  session: UploadSession;
  items: readonly QueueItem[];
  hosts: readonly UploadHost[];
  config: UserConfig;
  format: LinkFormat;
  /** 自动复制开着才写「全部完成后统一复制 N 个链接」 */
  autoCopy: boolean;
  /** 点一块缩略图 = 复制那一张；结果用来在原地显示「已复制」 */
  copyItem: (itemId: string) => Promise<CopyLinkResult | null>;
}>();

const emit = defineEmits<{
  setFormat: [format: LinkFormat];
  retryFailed: [];
  relogin: [hostId: string];
  /** 某个图床没传上（不是登录问题）：给整批补传这个图床 */
  retryHost: [hostId: string];
  openInGallery: [];
}>();

const { copiedKey, markCopied } = useCopyBadgeFeedback(1500);
async function copyTile(itemId: string): Promise<void> {
  const result = await props.copyItem(itemId);
  if (result?.ok) markCopied(itemId);
}

const counts = computed(() => sessionCounts(props.items));
const running = computed(() => !props.session.finished || counts.value.uploading + counts.value.waiting > 0);
const nameOf = (hostId: string) => props.hosts.find((h) => h.id === hostId)?.name ?? hostId;
const confirmedHttpHosts = useConfirmedHttpHosts(() => props.config);

const failedItems = computed(() => props.items.filter((item) => itemPhase(item) === 'failed'));
const failedReason = computed(() => {
  const failure = failedItems.value[0] ? firstFailure(failedItems.value[0]) : undefined;
  return failure ? hostFailureText(failure.id, failure.error, props.hosts).reason : '';
});
const failedNames = computed(() => failedItems.value.slice(0, 3).map((item) => item.fileName).join('、') + (failedItems.value.length > 3 ? ' 等' : ''));

/**
 * 某个图床没传上：每个图床只报一行，写清几张没传上（交接说明 4.9「某个图床整批失败只报一行」）。
 * 进行中只在登录已过期时说「本批不会上传到 X」——别的失败可能下一张就好了，不预言。
 */
const batchHostFailures = computed(() => hostMisses(props.items).flatMap(({ hostId, items, error }) => {
  const loginExpired = hostFailureText(hostId, error, props.hosts).reason === '登录已过期';
  const others = (props.items[0]?.enabledServices ?? []).filter((id) => id !== hostId).map(nameOf).join('与');
  const reason = loginExpired ? `${nameOf(hostId)}登录已过期` : `${nameOf(hostId)}上传失败`;
  if (running.value) {
    return loginExpired ? [{ hostId, text: `${reason}，本批不会上传到${nameOf(hostId)}；${others}正常上传。`, action: '重新登录', relogin: true }] : [];
  }
  return [{
    hostId,
    text: `${reason}，${items.length} 张未上传到${nameOf(hostId)}；${others}均已完成。`,
    action: loginExpired ? '重新登录后补传' : '补传',
    relogin: loginExpired,
  }];
}));

/** 一张都没传上时同样说清剪贴板没变（交接说明 8.1「全部失败」） */
const nothingCopied = computed(() => !running.value && counts.value.done === 0);
/** 「已复制 N 个链接 · X」写实际复制时的格式 */
const copiedFormat = computed<LinkFormat>(() => {
  const copied = props.session.copied?.format;
  return copied && copied in FORMAT_NAMES ? (copied as LinkFormat) : props.format;
});

const tiles = computed(() => props.items.map((item) => {
  const phase = itemPhase(item);
  const hosts = hostViews(item);
  const waiting = phase === 'uploading' && hosts.every((h) => h.state === 'waiting');
  const progress = Math.max(0, ...hosts.map((h) => h.progress));
  const failure = phase === 'failed' ? firstFailure(item) : undefined;
  const label = phase === 'failed'
    ? `上传失败：${failure ? hostFailureText(failure.id, failure.error, props.hosts).reason : '上传失败'}`
    : phase === 'uploading' ? (waiting ? '等待中' : '上传中') : '已完成';
  return { item, phase, waiting, progress, title: `${item.fileName} · ${label}`, srcs: phase === 'failed' || phase === 'uploading' && !item.primaryUrl ? [] : getThumbnailCandidates(item, props.config) };
}));

const firstName = computed(() => props.items[0]?.fileName ?? '');
const formatOptions = (['url', 'markdown', 'html', 'bbcode', 'custom'] as const).map((value) => ({ value, label: FORMAT_NAMES[value] }));
const formatModel = computed({ get: () => copiedFormat.value, set: (value: LinkFormat) => emit('setFormat', value) });
const listMode = ref(false);
const RING = 37.7;
</script>

<template>
  <section class="batch-card" :aria-label="`一次上传 ${counts.total} 张`">
    <div v-if="running" class="batch-card__head">
      <div class="batch-card__line">
        <span class="batch-card__title">正在上传 {{ counts.total }} 张</span>
        <span class="batch-card__muted2">已完成 {{ counts.done }} 张</span>
        <div class="batch-card__spacer" />
        <span v-if="autoCopy" class="batch-card__note">全部完成后统一复制 {{ counts.total }} 个链接</span>
      </div>
      <div role="progressbar" aria-label="上传进度" :aria-valuenow="counts.done" aria-valuemin="0" :aria-valuemax="counts.total" class="batch-card__bar">
        <span :style="{ width: `${counts.total ? (counts.done / counts.total) * 100 : 0}%` }" />
      </div>
    </div>
    <div v-else class="batch-card__head batch-card__head--done">
      <div class="batch-card__line batch-card__line--center">
        <span v-if="session.copied" class="batch-card__pill">
          <PnIcon name="check" :size="13" :stroke="2.4" />
          已复制 {{ session.copied.count }} 个链接 · {{ FORMAT_NAMES[copiedFormat] }}，每行一个
        </span>
        <div class="batch-card__spacer" />
        <span class="batch-card__note">{{ formatRelativeTime(session.startedAt) }}</span>
      </div>
      <div class="batch-card__line">
        <span class="batch-card__title">{{ firstName }} 等 {{ counts.total }} 张</span>
        <span class="batch-card__muted2">
          {{ counts.done }} 张已完成<template v-if="counts.failed"> · <span class="batch-card__danger">{{ counts.failed }} 张失败</span></template>
        </span>
      </div>
    </div>

    <div v-if="!listMode" class="batch-card__tiles">
      <button
        v-for="tile in tiles"
        :key="tile.item.id"
        type="button"
        class="batch-card__tile"
        :class="{ 'batch-card__tile--waiting': tile.waiting }"
        :title="tile.title"
        :disabled="tile.phase === 'uploading' || tile.phase === 'failed'"
        @click="copyTile(tile.item.id)"
      >
        <ThumbnailImage v-if="tile.srcs.length" :srcs="tile.srcs" :alt="tile.item.fileName" :confirmed-http-hosts="confirmedHttpHosts" />
        <span v-if="tile.phase === 'uploading' && !tile.waiting" class="batch-card__veil">
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6" fill="none" class="batch-card__ring-track" stroke-width="2" />
            <circle cx="8" cy="8" r="6" fill="none" class="batch-card__ring" stroke-width="2" stroke-linecap="round" transform="rotate(-90 8 8)" :stroke-dasharray="`${(Math.max(tile.progress, 8) / 100) * RING} ${RING}`" />
          </svg>
        </span>
        <span v-if="tile.phase === 'failed'" class="batch-card__veil batch-card__veil--failed">
          <PnIcon name="close" :size="18" :stroke="2" />
        </span>
        <span v-if="copiedKey === tile.item.id" class="batch-card__veil batch-card__veil--copied" role="status" aria-label="已复制">
          <PnIcon name="check" :size="18" :stroke="2.4" />
        </span>
      </button>
    </div>
    <ul v-else class="batch-card__list">
      <li v-for="tile in tiles" :key="tile.item.id" class="batch-card__list-row">
        <span class="batch-card__list-name">{{ tile.item.fileName }}</span>
        <span :class="tile.phase === 'failed' ? 'batch-card__danger' : 'batch-card__note'">{{ tile.title.split(' · ')[1] }}</span>
        <CopyButton v-if="tile.phase === 'done' || tile.phase === 'partial'" :copied="copiedKey === tile.item.id" @click="copyTile(tile.item.id)" />
      </li>
    </ul>

    <div class="batch-card__lines">
      <div v-if="!running && counts.failed" class="batch-card__notice">
        <PnIcon name="failCircle" :size="14" :stroke="1.8" class="batch-card__danger" />
        <span><span class="batch-card__danger batch-card__strong">{{ counts.failed }} 张上传失败</span>：{{ failedNames }}<template v-if="failedReason"> · {{ failedReason }}</template><template v-if="nothingCopied">。<span class="batch-card__note">剪贴板内容未改变。</span></template></span>
        <div class="batch-card__spacer" />
        <PnButton variant="secondary" size="sm" @click="emit('retryFailed')">重试 {{ counts.failed }} 张</PnButton>
      </div>
      <div v-for="line in batchHostFailures" :key="line.hostId" class="batch-card__notice">
        <PnIcon name="warning" :size="14" :stroke="1.8" class="batch-card__warn" />
        <span>{{ line.text }}</span>
        <button type="button" class="batch-card__link" @click="line.relogin ? emit('relogin', line.hostId) : emit('retryHost', line.hostId)">{{ line.action }}</button>
      </div>
    </div>

    <div v-if="!running" class="batch-card__foot">
      <PnMenu align="start" :width="200">
        <template #trigger>
          <button type="button" class="batch-card__ghost">
            换个格式复制
            <PnIcon name="chevronDown" :size="13" :stroke="1.8" class="batch-card__note" />
          </button>
        </template>
        <PnMenuRadioGroup v-model="formatModel" :options="formatOptions" />
      </PnMenu>
      <button type="button" class="batch-card__ghost" @click="listMode = !listMode">{{ listMode ? '收起为缩略图' : '展开为列表' }}</button>
      <button type="button" class="batch-card__ghost" @click="emit('openInGallery')">在图库中查看</button>
    </div>
  </section>
</template>

<style scoped>
.batch-card {
  margin-top: var(--pn-space-20);
  padding: var(--pn-space-20) var(--pn-space-20) var(--pn-space-batch-bottom);
  border-radius: var(--pn-radius-2xl);
  background: var(--pn-elevated);
  box-shadow: var(--pn-e2);
}

.batch-card__head { display: flex; flex-direction: column; }
.batch-card__head--done { gap: var(--pn-space-sidebar-x); }
.batch-card__line { display: flex; align-items: baseline; gap: var(--pn-space-12); }
.batch-card__line--center { align-items: center; }
.batch-card__spacer { flex: 1; }

.batch-card__title {
  font-size: var(--pn-text-headline);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-headline);
  letter-spacing: var(--pn-tracking-headline);
}

.batch-card__muted2 { color: var(--pn-text2); }
.batch-card__note { font-size: var(--pn-text-footnote); color: var(--pn-text3); }
.batch-card__danger { color: var(--pn-danger); }
.batch-card__warn { flex: none; color: var(--pn-warning); }
.batch-card__strong { font-weight: var(--pn-weight-medium); }

.batch-card__bar {
  height: var(--pn-size-progress);
  margin-top: var(--pn-space-12);
  overflow: hidden;
  border-radius: var(--pn-space-2);
  background: var(--pn-track);
}

.batch-card__bar > span {
  display: block;
  height: 100%;
  border-radius: var(--pn-space-2);
  background: var(--pn-progress-fill);
  transition: width var(--pn-dur-standard) var(--pn-ease-in);
}

.batch-card__pill {
  display: flex;
  align-items: center;
  gap: var(--pn-space-copy-gap);
  height: var(--pn-size-pill);
  padding: 0 var(--pn-space-sidebar-x) 0 var(--pn-space-8);
  border-radius: var(--pn-size-pill);
  background: var(--pn-success-soft);
  color: var(--pn-success);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
}

.batch-card__tiles {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: var(--pn-space-8);
  margin-top: var(--pn-space-16);
}

.batch-card__tile {
  position: relative;
  height: var(--pn-size-batch-tile);
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-subtle);
  cursor: pointer;
}

.batch-card__tile:disabled { cursor: default; }

.batch-card__tile--waiting {
  opacity: var(--pn-opacity-tile-waiting);
  filter: grayscale(1);
}

.batch-card__veil {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--pn-tile-uploading-veil);
}

.batch-card__veil--failed {
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-tile-failed-veil);
  box-shadow: inset 0 0 0 var(--pn-ring-width) var(--pn-tile-failed-ring);
  color: var(--pn-on-fill);
}

.batch-card__veil--copied {
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-tile-copied-veil);
  color: var(--pn-on-fill);
}

.batch-card__ring-track { stroke: var(--pn-track); }
.batch-card__ring { stroke: var(--pn-brand); }

.batch-card__list {
  display: flex;
  flex-direction: column;
  margin: var(--pn-space-16) 0 0;
  padding: 0;
  list-style: none;
}

.batch-card__list-row {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
  min-height: var(--pn-size-button-lg);
  box-shadow: inset 0 -1px 0 var(--pn-hairline);
}

.batch-card__list-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.batch-card__lines {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-8);
  margin-top: var(--pn-space-16);
  font-size: var(--pn-text-footnote);
  color: var(--pn-text2);
}

.batch-card__lines:empty { display: none; }

.batch-card__notice { display: flex; align-items: center; gap: var(--pn-space-8); }

.batch-card__link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pn-brand-text);
  font: inherit;
  font-weight: var(--pn-weight-medium);
  cursor: pointer;
}

.batch-card__foot {
  display: flex;
  align-items: center;
  gap: var(--pn-space-4);
  margin: var(--pn-space-sidebar-x) 0 0 calc(-1 * var(--pn-space-8));
}

.batch-card__ghost {
  display: flex;
  align-items: center;
  gap: var(--pn-space-copy-gap);
  height: var(--pn-size-button-sm);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  cursor: pointer;
}

.batch-card__ghost:hover,
.batch-card__ghost[data-state='open'] { background: var(--pn-selected); }
</style>
