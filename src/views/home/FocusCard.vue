<script setup lang="ts">
// 焦点卡（HomeScreen.dc.html H03–H06）：显示刚上传的那一张，花瓣逐个点亮。
// 第一个图床完成 → 链接出现、自动复制，卡片变「已复制 · Markdown」（这个标签同时是格式开关）。
// 部分失败：链接照常来自最先成功的图床，失败图床的花瓣变红，一行写原因 + 两个下一步。
// 全部失败：不显示链接，并明说剪贴板没有变。
import { computed, ref, watch } from 'vue';
import HostIcon from '@/components/biz/HostIcon.vue';
import LinkBlock from '@/components/biz/LinkBlock.vue';
import PetalGlyph from '@/components/biz/PetalGlyph.vue';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
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
import { useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import type { UploadHost } from '@/composables/upload/useUploadController';
import { hasLink, hostFailureText, hostViews, itemPhase, petalStates, type UploadSession } from '@/composables/upload/uploadSessions';
import { formatRelativeTime, formatSizeChange } from '@/utils/formatters';
import { FORMAT_NAMES, type LinkFormat } from '@/utils/linkFormatter';
import UploadToPanel from './UploadToPanel.vue';

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
  openInGallery: [];
}>();

const { markCopied, isCopied } = useCopyBadgeFeedback(1500);

const phase = computed(() => itemPhase(props.item));
const linkReady = computed(() => hasLink(props.item));
const failedAll = computed(() => phase.value === 'failed');
const hostRows = computed(() => hostViews(props.item));
const nameOf = (hostId: string) => props.hosts.find((h) => h.id === hostId)?.name ?? hostId;
const doneHosts = computed(() => hostRows.value.filter((h) => h.state === 'done'));
const failedHosts = computed(() => hostRows.value.filter((h) => h.state === 'failed'));
const finishedCount = computed(() => doneHosts.value.length);
const hostsTitle = computed(() => doneHosts.value.map((h) => nameOf(h.id)).join('、'));
/** CopyMulti.dc.html ②：4 个以上只露前 3 个，其余收进「+N」 */
const SHOWN_HOSTS = 3;
const shownHosts = computed(() => (doneHosts.value.length > SHOWN_HOSTS ? doneHosts.value.slice(0, SHOWN_HOSTS) : doneHosts.value));
const moreHosts = computed(() => (doneHosts.value.length > SHOWN_HOSTS ? doneHosts.value.slice(SHOWN_HOSTS) : []));
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
const thumbSrcs = computed(() => getThumbnailCandidates(props.item, props.config));
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
function copyHost(hostId: string) {
  emit('copyHost', hostId);
  markCopied(hostId);
}
</script>

<template>
  <section class="focus-card" :aria-label="failedAll ? '上传失败' : linkReady ? '刚刚上传' : '正在上传'">
    <button type="button" class="focus-card__thumb" title="在图库中查看" :disabled="!linkReady" @click="emit('openInGallery')">
      <ThumbnailImage v-if="linkReady" :srcs="thumbSrcs" :alt="item.fileName" image-class="focus-card__img" :confirmed-http-hosts="confirmedHttpHosts" />
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
          <PetalGlyph :states="petalStates(item)" :size="18" />
          <template v-if="failedAll">{{ failedAllTitle }}</template>
          <template v-else-if="!linkReady">{{ finishedCount }} / {{ hostRows.length }} 个图床</template>
        </span>
      </div>

      <div>
        <div class="focus-card__name">{{ item.fileName }}</div>
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
          <PnButton v-if="isCookieHost(host.id)" variant="secondary" size="sm" @click="emit('relogin', host.id)">重新登录</PnButton>
          <PnButton variant="ghost" size="sm" @click="emit('retryHost', host.id)">重试此图床</PnButton>
        </div>
      </template>
      <div v-else-if="linkReady && doneHosts.length" class="focus-card__chips">
        <span class="focus-card__muted focus-card__chips-label">按图床复制</span>
        <button
          v-for="host in shownHosts"
          :key="host.id"
          type="button"
          class="focus-card__chip"
          :title="isCopied(host.id) ? `已复制${nameOf(host.id)}链接` : `复制 ${nameOf(host.id)} 链接`"
          @click="copyHost(host.id)"
        >
          <HostIcon :host="host.id" :name="nameOf(host.id)" :size="14" class="focus-card__chip-icon" />
          {{ nameOf(host.id) }}
          <PnIcon v-if="isCopied(host.id) || (session.copied && host.id === copySource)" name="check" :size="12" :stroke="2.6" class="focus-card__success" />
          <PnIcon v-else name="copy" :size="12" :stroke="1.9" class="focus-card__muted" />
        </button>
        <!-- 「+N」是这一行最后一个，右对齐才不会伸出卡片 -->
        <PnPopover v-if="moreHosts.length" align="end" label="其他图床">
          <template #trigger>
            <button type="button" class="focus-card__chip focus-card__chip--more">
              +{{ moreHosts.length }}
              <PnIcon name="chevronDown" :size="11" :stroke="2.2" />
            </button>
          </template>
          <div class="focus-card__more">
            <span class="focus-card__more-title">其他 {{ moreHosts.length }} 个图床</span>
            <div v-for="host in moreHosts" :key="host.id" class="focus-card__more-row">
              <HostIcon :host="host.id" :name="nameOf(host.id)" :size="16" class="focus-card__chip-icon" />
              <span class="focus-card__more-name">{{ nameOf(host.id) }}</span>
              <span class="focus-card__muted">正常</span>
              <button type="button" class="focus-card__more-copy" :aria-label="`复制${nameOf(host.id)}的链接`" @click="copyHost(host.id)">
                <PnIcon :name="isCopied(host.id) ? 'check' : 'copy'" :size="12" :stroke="isCopied(host.id) ? 2.4 : 1.9" />
                {{ isCopied(host.id) ? '已复制' : '复制' }}
              </button>
            </div>
            <span class="focus-card__more-line" />
            <button type="button" class="focus-card__more-all" @click="emit('copyAllHosts'); markCopied('all')">
              <PnIcon :name="isCopied('all') ? 'check' : 'copy'" :size="12" :stroke="isCopied('all') ? 2.4 : 1.9" />
              <span class="focus-card__more-name">{{ isCopied('all') ? '已复制' : `复制全部 ${doneHosts.length} 条（每行一条）` }}</span>
              <span class="focus-card__muted">按图床顺序</span>
            </button>
          </div>
        </PnPopover>
      </div>
      <span v-else-if="!linkReady && autoCopy" class="focus-card__hint">首个图床完成后自动复制链接</span>
    </div>
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
  position: relative;
  flex: none;
  width: var(--pn-size-focus-thumb-w);
  height: var(--pn-size-focus-thumb-h);
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: var(--pn-radius-lg);
  background: var(--pn-subtle);
  box-shadow: 0 0 0 1px var(--pn-hairline);
  cursor: pointer;
}

.focus-card__thumb:disabled { cursor: default; }
.focus-card__thumb :deep(.focus-card__img) { object-fit: contain; }

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

button.focus-card__pill { padding-right: var(--pn-space-8); cursor: pointer; }
.focus-card__pill--copied { background: var(--pn-success-soft); color: var(--pn-success); }
.focus-card__pill--neutral { background: var(--pn-subtle); color: var(--pn-text1); }
.focus-card__pill--uploading { background: var(--pn-brand-soft); color: var(--pn-brand-text); }
.focus-card__pill--failed { background: var(--pn-danger-soft); color: var(--pn-danger); }
.focus-card__pill-caret { opacity: 0.7; }

.focus-card__spin { animation: pn-button-spin var(--pn-dur-spin) linear infinite; }

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

.focus-card__bone {
  width: 64%;
  height: var(--pn-size-skeleton-line);
  border-radius: var(--pn-radius-xs);
  background: var(--pn-skeleton);
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

.focus-card__chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pn-space-6); }
.focus-card__chips-label { margin-right: var(--pn-space-4); font-size: var(--pn-text-footnote); }

.focus-card__chip {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  height: var(--pn-size-chip);
  padding: 0 var(--pn-space-sidebar-x) 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-size-chip);
  background: var(--pn-subtle);
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
  cursor: pointer;
}

.focus-card__chip:hover { background: var(--pn-ghost-press); }
.focus-card__chip-icon { color: var(--pn-text2); }

.focus-card__hint { font-size: var(--pn-text-footnote); color: var(--pn-text2); }

/* 「+N」展开的完整列表（CopyMulti.dc.html ②：宽 330、行高 36） */
.focus-card__chip--more { gap: var(--pn-space-4); background: var(--pn-selected); font-weight: var(--pn-weight-medium); }

.focus-card__more {
  display: flex;
  flex-direction: column;
  width: var(--pn-size-copy-more);
}

.focus-card__more-title {
  padding: var(--pn-space-6) var(--pn-space-8) var(--pn-space-4);
  color: var(--pn-text3);
  font-size: var(--pn-text-caption);
  font-weight: var(--pn-weight-medium);
}

.focus-card__more-row {
  display: flex;
  align-items: center;
  gap: var(--pn-space-copy-more-gap);
  height: var(--pn-size-copy-more-row);
  padding: 0 var(--pn-space-8);
  border-radius: var(--pn-radius-button-sm);
}

.focus-card__more-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.focus-card__more-copy {
  display: flex;
  align-items: center;
  gap: var(--pn-space-4);
  height: var(--pn-size-copy-more-button);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: var(--pn-subtle);
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
}

.focus-card__more-line { height: 1px; margin: var(--pn-space-6) var(--pn-space-8); background: var(--pn-border); }

.focus-card__more-all {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  height: var(--pn-size-button-lg);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  text-align: left;
}

.focus-card__more-all:hover { background: var(--pn-menu-sel); }

@keyframes pn-button-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .focus-card__spin { animation: none; }
}
</style>
