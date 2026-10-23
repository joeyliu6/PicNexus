<script setup lang="ts">
// 焦点卡（HomeScreen.dc.html H03–H06）：显示刚上传的那一张，花瓣逐个点亮。
// 第一个图床完成 → 链接出现、自动复制，卡片变「已复制 · Markdown」（这个标签同时是格式开关）。
// 部分失败：链接照常来自最先成功的图床，失败图床的花瓣变红，一行写原因 + 两个下一步。
// 全部失败：不显示链接，并明说剪贴板没有变。
// 图框跟着图片的比例与原图大小变（最大 288 × 162），不留两边的空；显示原图（加载不出来退到缩略图），点开看大图。
import { computed, ref, watch } from 'vue';
import ImageViewer from '@/components/biz/ImageViewer.vue';
import LinkBlock from '@/components/biz/LinkBlock.vue';
import PetalGlyph from '@/components/biz/PetalGlyph.vue';
import PreviewFrame from '@/components/biz/PreviewFrame.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import PnPopover from '@/components/pn/PnPopover.vue';
import type { UserConfig } from '@/config/types';
import type { QueueItem } from '@/core/UploadQueue';
import { getThumbnailCandidates } from '@/composables/image/useThumbCache';
import { useConfirmedHttpHosts } from '@/composables/image/useConfirmedHttpHosts';
import { getImageMetadata } from '@/composables/image/useImageMetadata';
import { formatLinkWithConfig } from '@/composables/useCopyLink';
import type { UploadHost } from '@/composables/upload/useUploadController';
import { hasLink, hostFailureText, hostViews, itemPhase, petalStates, type UploadSession } from '@/composables/upload/uploadSessions';
import { formatRelativeTime, formatSizeChange } from '@/utils/formatters';
import { FORMAT_NAMES, type LinkFormat } from '@/utils/linkFormatter';
import FocusHostChips from './FocusHostChips.vue';
import UploadToPanel from './UploadToPanel.vue';
import { vOverflowTitle } from '@/utils/overflowTitle';

const props = defineProps<{
  item: QueueItem;
  session: UploadSession;
  hosts: readonly UploadHost[];
  config: UserConfig;
  format: LinkFormat;
  copySource: string | undefined;
  /** 自动复制开着才写「首个图床完成后自动复制链接」 */
  autoCopy: boolean;
}>();

const emit = defineEmits<{
  setFormat: [format: LinkFormat];
  /** 还没复制时点标签：直接复制 */
  copy: [];
  copyHost: [hostId: string];
  /** 「+N」里的「复制全部」：每个图床一条 */
  copyAllHosts: [];
  relogin: [hostId: string];
  retryHost: [hostId: string];
  retryItem: [];
  uploadAgainWith: [hostIds: string[]];
}>();


const phase = computed(() => itemPhase(props.item));
const linkReady = computed(() => hasLink(props.item));
const failedAll = computed(() => phase.value === 'failed');
const hostRows = computed(() => hostViews(props.item));
const nameOf = (hostId: string) => props.hosts.find((h) => h.id === hostId)?.name ?? hostId;
const doneHosts = computed(() => hostRows.value.filter((h) => h.state === 'done'));
const failedHosts = computed(() => hostRows.value.filter((h) => h.state === 'failed'));
const finishedCount = computed(() => doneHosts.value.length);
const hostsTitle = computed(() => doneHosts.value.map((h) => nameOf(h.id)).join('、'));
/** 只勾了一个图床时不说「均」 */
const failedAllTitle = computed(() => (hostRows.value.length === 1 ? `${nameOf(hostRows.value[0].id)}上传失败` : `${hostRows.value.length} 个图床均上传失败`));
/** 「已复制 · X」写实际复制时的格式，不是现在的默认格式 */
const copiedFormat = computed<LinkFormat>(() => {
  const copied = props.session.copied?.format;
  return copied && copied in FORMAT_NAMES ? (copied as LinkFormat) : props.format;
});

const copiedLink = computed(() => {
  if (!props.copySource) return null;
  const url = props.item.serviceProgress[props.copySource]?.link;
  if (!url) return null;
  return {
    url,
    text: formatLinkWithConfig({ url, fileName: props.item.fileName, serviceId: props.copySource }, props.config, props.format),
  };
});

const baseName = computed(() => props.item.fileName.replace(/\.[^.]+$/, ''));
/** 原图在前（复制的那份，再是其他完成的图床），缩略图垫后 */
const imageSrcs = computed(() => {
  const links = [props.copySource, ...doneHosts.value.map((h) => h.id)]
    .map((hostId) => (hostId ? props.item.serviceProgress[hostId]?.link : undefined))
    .filter((link): link is string => !!link);
  return [...new Set([...links, ...getThumbnailCandidates(props.item, props.config)])];
});
const viewerOpen = ref(false);
const confirmedHttpHosts = useConfirmedHttpHosts(() => props.config);
const reasonOf = (hostId: string, error?: string) => hostFailureText(hostId, error, props.hosts).reason;
/** 整张失败：原因 + 处理办法（「网络超时。请检查网络后重试。」） */
const allFailedText = computed(() => {
  const first = failedHosts.value[0];
  return first ? hostFailureText(first.id, first.error, props.hosts) : { reason: '上传失败', advice: '请稍后重试' };
});
const isCookieHost = (hostId: string) => props.hosts.find((h) => h.id === hostId)?.cookieLogin ?? false;

// 尺寸与大小：本地原图的元数据（上传前已读过，走缓存）
const meta = ref<{ width: number; height: number; size: number } | null>(null);
watch(() => props.item.filePath, async (filePath) => {
  meta.value = null;
  try {
    const m = await getImageMetadata(filePath);
    meta.value = { width: m.width, height: m.height, size: m.file_size ?? 0 };
  } catch {
    meta.value = null;
  }
}, { immediate: true });

/** 图框按图片比例与原图大小（CSS 里算，见 .focus-card__thumb） */
const frameStyle = computed(() => (meta.value?.width && meta.value.height
  ? { '--focus-w': meta.value.width, '--focus-h': meta.value.height, '--focus-cap-w': `${meta.value.width}px`, '--focus-cap-h': `${meta.value.height}px` }
  : {}));

const metaLine = computed(() => {
  const parts = [formatRelativeTime(props.session.startedAt)];
  if (meta.value?.width && meta.value.height) parts.push(`${meta.value.width} × ${meta.value.height}`);
  // 压缩过的写「1.2 MB → 410 KB」（H03 / H05）
  if (meta.value?.size) parts.push(formatSizeChange(meta.value.size, props.item.compressedSize));
  return parts.join(' · ');
});

const formatOptions = (['url', 'markdown', 'html', 'bbcode', 'custom'] as const).map((value) => ({ value, label: FORMAT_NAMES[value] }));
// 勾的是剪贴板里实际的格式；选别的格式就按它重新复制
const formatModel = computed({ get: () => copiedFormat.value, set: (value: LinkFormat) => emit('setFormat', value) });

const changeHostsOpen = ref(false);
</script>

<template>
  <section class="focus-card" :aria-label="failedAll ? '上传失败' : linkReady ? '刚刚上传' : '正在上传'">
    <button type="button" class="focus-card__thumb" :style="frameStyle" title="查看大图" :disabled="!linkReady" @click="viewerOpen = true">
      <PreviewFrame
        v-if="linkReady" :srcs="imageSrcs" :name="item.fileName" :ratio="meta ? meta.width / meta.height : undefined"
        :natural-width="meta?.width" :confirmed-http-hosts="confirmedHttpHosts"
      />
      <span v-else class="focus-card__placeholder"><PnIcon name="gallery" :size="28" :stroke="1.4" /></span>
      <span v-if="!linkReady && !failedAll" class="focus-card__progress"><span :style="{ width: `${Math.max(...hostRows.map((h) => h.progress), 4)}%` }" /></span>
    </button>

    <div class="focus-card__body">
      <div class="focus-card__row">
        <!-- 「已复制 · Markdown」既说剪贴板里是什么，也是格式开关；还没复制时点它就是复制 -->
        <PnMenu v-if="linkReady && session.copied" align="start" :width="200">
          <template #trigger>
            <button type="button" class="focus-card__pill focus-card__pill--copied" title="切换格式并复制">
              <PnIcon name="check" :size="13" :stroke="2.4" />
              已复制 · {{ FORMAT_NAMES[copiedFormat] }}
              <PnIcon name="chevronDown" :size="11" :stroke="2.2" class="focus-card__pill-caret" />
            </button>
          </template>
          <PnMenuRadioGroup v-model="formatModel" :options="formatOptions" />
        </PnMenu>
        <button v-else-if="linkReady" type="button" class="focus-card__pill focus-card__pill--neutral" title="复制链接" @click="emit('copy')">
          <PnIcon name="copy" :size="13" :stroke="1.9" />
          复制 · {{ FORMAT_NAMES[format] }}
        </button>
        <span v-else-if="failedAll" class="focus-card__pill focus-card__pill--failed">
          <PnIcon name="close" :size="13" :stroke="2" />
          上传失败
        </span>
        <span v-else class="focus-card__pill focus-card__pill--uploading">
          <svg class="focus-card__spin" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2.4" />
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="14 37.7" stroke-linecap="round" />
          </svg>
          上传中
        </span>
        <div class="focus-card__spacer" />
        <span class="focus-card__hosts" :title="linkReady ? `存在 ${finishedCount} 个图床：${hostsTitle}` : undefined">
          <PetalGlyph :states="petalStates(item)" :size="18" :bloom-key="session.copied" />
          <template v-if="failedAll">{{ failedAllTitle }}</template>
          <template v-else-if="!linkReady">{{ finishedCount }} / {{ hostRows.length }} 个图床</template>
        </span>
      </div>

      <div>
        <div v-overflow-title class="focus-card__name">{{ item.fileName }}</div>
        <div class="focus-card__meta">{{ metaLine }}</div>
      </div>

      <LinkBlock v-if="copiedLink" :text="copiedLink.text" :url="copiedLink.url" :filename="baseName" />
      <div v-else-if="failedAll" class="focus-card__failed-box">
        {{ allFailedText.reason }}。{{ allFailedText.advice }}。<span class="focus-card__muted">剪贴板内容未改变。</span>
      </div>
      <div v-else class="focus-card__skeleton" aria-hidden="true">
        <span class="focus-card__bone focus-card__bone--long" />
        <span class="focus-card__bone" />
      </div>

      <template v-if="failedAll">
        <div class="focus-card__actions">
          <PnButton variant="primary" @click="emit('retryItem')">重试</PnButton>
          <PnPopover v-model:open="changeHostsOpen" align="start" label="换个图床">
            <template #trigger>
              <PnButton variant="secondary">换个图床</PnButton>
            </template>
            <UploadToPanel :hosts="hosts" one-off @upload-one-off="changeHostsOpen = false; emit('uploadAgainWith', $event)" />
          </PnPopover>
        </div>
      </template>
      <template v-else-if="failedHosts.length && linkReady">
        <div v-for="host in failedHosts" :key="host.id" class="focus-card__failure">
          <PnIcon name="failCircle" :size="14" :stroke="1.8" class="focus-card__danger" />
          <span class="focus-card__failure-text"><span class="focus-card__danger focus-card__strong">{{ nameOf(host.id) }}上传失败</span>：{{ reasonOf(host.id, host.error) }}</span>
          <div class="focus-card__spacer" />
          <PnButton v-if="isCookieHost(host.id)" variant="secondary" size="sm" @click="emit('relogin', host.id)">重新登录…</PnButton>
          <PnButton variant="ghost" size="sm" @click="emit('retryHost', host.id)">重试此图床</PnButton>
        </div>
      </template>
      <FocusHostChips
        v-else-if="linkReady && doneHosts.length"
        :host-ids="doneHosts.map((h) => h.id)"
        :name-of="nameOf"
        :auto-copied-id="session.copied ? copySource : undefined"
        @copy-host="emit('copyHost', $event)"
        @copy-all="emit('copyAllHosts')"
      />
      <span v-else-if="!linkReady && autoCopy" class="focus-card__hint">首个图床完成后自动复制链接</span>
    </div>
    <ImageViewer
      v-model:open="viewerOpen" :srcs="imageSrcs" :name="item.fileName" :width="meta?.width" :height="meta?.height"
      :meta="metaLine" :confirmed-http-hosts="confirmedHttpHosts"
    />
  </section>
</template>

<style scoped>
.focus-card {
  display: flex;
  gap: var(--pn-space-24);
  margin-top: var(--pn-space-20);
  padding: var(--pn-space-20);
  border-radius: var(--pn-radius-2xl);
  background: var(--pn-elevated);
  box-shadow: var(--pn-e2);
}

.focus-card__thumb {
  --focus-w: 16;
  --focus-h: 9;

  position: relative;
  flex: none;
  align-self: flex-start;

  /* 最大 288 × 162、不超过原图、按比例；太窄太小的不小于 96（空处铺模糊衬底） */
  width: max(var(--pn-size-focus-thumb-min), min(var(--pn-size-focus-thumb-w), var(--focus-cap-w, 100vw), calc(var(--pn-size-focus-thumb-h) * var(--focus-w) / var(--focus-h))));
  height: max(var(--pn-size-focus-thumb-min), min(var(--pn-size-focus-thumb-h), var(--focus-cap-h, 100vh), calc(var(--pn-size-focus-thumb-w) * var(--focus-h) / var(--focus-w))));
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: var(--pn-radius-lg);
  background: var(--pn-subtle);
  box-shadow: 0 0 0 1px var(--pn-hairline);
}

.focus-card__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--pn-text3);
}

.focus-card__progress {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: var(--pn-size-countdown);
  background: var(--pn-track);
}

.focus-card__progress > span {
  display: block;
  height: 100%;
  background: var(--pn-brand);
  transition: width var(--pn-dur-standard) var(--pn-ease-in);
}

.focus-card__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-sidebar-x);
  min-width: 0;
}

.focus-card__row { display: flex; align-items: center; gap: var(--pn-space-sidebar-x); }
.focus-card__spacer { flex: 1; }

.focus-card__pill {
  display: flex;
  align-items: center;
  gap: var(--pn-space-copy-gap);
  height: var(--pn-size-pill);
  padding: 0 var(--pn-space-sidebar-x) 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-size-pill);
  font: inherit;
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
}

button.focus-card__pill {
  padding-right: var(--pn-space-8);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in), color var(--pn-dur-instant) var(--pn-ease-in);
}

.focus-card__pill--copied { background: var(--pn-success-soft); color: var(--pn-success); }

.focus-card__pill--copied:hover,
.focus-card__pill--copied[data-state='open'] { background: var(--pn-pill-success-hover); }
.focus-card__pill--copied:active { background: var(--pn-pill-success-press); }
.focus-card__pill--neutral { background: var(--pn-subtle); color: var(--pn-text1); }
.focus-card__pill--neutral:hover { background: var(--pn-ghost-press); }
.focus-card__pill--neutral:active { background: var(--pn-subtle-press); }
.focus-card__pill--uploading { background: var(--pn-brand-soft); color: var(--pn-brand-text); }
.focus-card__pill--failed { background: var(--pn-danger-soft); color: var(--pn-danger); }
.focus-card__pill-caret { opacity: 0.7; }

.focus-card__spin { animation: pn-spin var(--pn-dur-spin) linear infinite; }

.focus-card__hosts {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  font-size: var(--pn-text-footnote);
  color: var(--pn-text2);
}

.focus-card__name {
  overflow: hidden;
  font-size: var(--pn-text-headline);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-headline);
  letter-spacing: var(--pn-tracking-headline);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.focus-card__meta {
  margin-top: var(--pn-space-2);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
  color: var(--pn-text3);
}

.focus-card__failed-box {
  padding: var(--pn-space-12) var(--pn-space-toast-left);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-danger-soft);
  color: var(--pn-text1);
}

.focus-card__skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-8);
  padding: var(--pn-space-12) var(--pn-space-toast-left);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-subtle);
}

/* 等链接的骨架条：同骨架屏 1.4 秒明暗起伏（LoadingRules.dc.html），「减少动态效果」时停住 */
.focus-card__bone {
  width: 64%;
  height: var(--pn-size-skeleton-line);
  border-radius: var(--pn-radius-xs);
  background: var(--pn-skeleton);
  animation: pn-skeleton-pulse var(--pn-dur-skeleton) ease-in-out infinite;
}

.focus-card__bone--long { width: 92%; }

.focus-card__actions { display: flex; align-items: center; gap: var(--pn-space-8); }

.focus-card__failure {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  font-size: var(--pn-text-footnote);
}

.focus-card__failure-text { color: var(--pn-text2); }
.focus-card__danger { color: var(--pn-danger); }
.focus-card__strong { font-weight: var(--pn-weight-medium); }
.focus-card__muted { color: var(--pn-text3); }
.focus-card__success { color: var(--pn-success); }

.focus-card__hint { font-size: var(--pn-text-footnote); color: var(--pn-text2); }




@media (prefers-reduced-motion: reduce) {
  .focus-card__spin { animation: none; }
}
</style>
