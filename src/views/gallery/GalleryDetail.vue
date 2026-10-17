<script setup lang="ts">
// 图库详情（GalleryScreen.dc.html G05–G07，宽 340，Esc 关闭）：从上到下只有三件事——
// 这张图长什么样 → 链接（一键复制）→ 存放在哪几个图床。
// 「复制时使用」那份失效、有可用备份时顶上一条琥珀提示 + 唯一主按钮「改用 X」：立即生效、不弹确认，通知带撤销。
// 「移除记录」只放在底部。
import { computed, ref, watch } from 'vue';
import LinkBlock from '@/components/biz/LinkBlock.vue';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import type { HistoryItem } from '@/config/types';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { useMirrorFallback } from '@/composables/history/useMirrorFallback';
import { getThumbnailCandidates } from '@/composables/image/useThumbCache';
import { useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import { applyConfiguredUrlWithConfig, formatLinkWithConfig, useCopyLink } from '@/composables/useCopyLink';
import { useUploadController } from '@/composables/upload/useUploadController';
import { openUserExternalUrl } from '@/security/shellOpen';
import { historyDB } from '@/services/database';
import type { ImageMeta } from '@/types/image-meta';
import { formatCalendarDate, formatFileSize } from '@/utils/formatters';
import { FORMAT_NAMES, type LinkFormat } from '@/utils/linkFormatter';
import { createLogger } from '@/utils/logger';
import GalleryDetailHosts from './GalleryDetailHosts.vue';
import { detailBanner, hostRows } from './detailHosts';
import { useGalleryActions } from './useGalleryActions';
import type { GalleryGridApi } from './useGalleryGrid';

const log = createLogger('GalleryDetail');

const props = defineProps<{
  itemId: string;
  grid: GalleryGridApi;
  format: LinkFormat;
}>();

const emit = defineEmits<{
  close: [];
  openLightbox: [meta: ImageMeta];
  removed: [ids: string[]];
}>();

const { historyManager } = props.grid;
const config = computed(() => props.grid.config.value);
const actions = useGalleryActions();
const upload = useUploadController();
const { copyLinks } = useCopyLink();
const { copiedKey, markCopied } = useCopyBadgeFeedback(1500);

const item = ref<HistoryItem | null>(null);
async function load(fresh = false): Promise<void> {
  try {
    item.value = fresh ? await historyDB.getById(props.itemId) : await historyManager.detailCache.getDetail(props.itemId);
  } catch (error) {
    log.warn('读取详情失败', error);
    item.value = null;
  }
}
watch(() => props.itemId, () => { void load(); }, { immediate: true });

const mirror = useMirrorFallback(item);
const justSwitched = ref<string | null>(null);
const name = (hostId: string) => getServiceDisplayName(hostId, config.value);
const rows = computed(() => hostRows(mirror.mirrors.value, item.value?.linkCheckStatus, justSwitched.value));
const banner = computed(() => detailBanner(rows.value, name));
const source = computed(() => rows.value.find((row) => row.isCopySource) ?? null);

const meta = computed(() => {
  const it = item.value;
  if (!it) return '';
  const parts: string[] = [];
  if (it.width && it.height) parts.push(`${it.width} × ${it.height}`);
  if (it.fileSize) parts.push(formatFileSize(it.fileSize));
  parts.push(formatCalendarDate(it.timestamp));
  return parts.join(' · ');
});

const thumbs = computed(() => (item.value ? getThumbnailCandidates(item.value, config.value) : []));
/** 预览按原比例放进 300 × 188（详情宽 340 减两侧 20），与设计稿一样整张露出、不裁切 */
const PREVIEW = { width: 300, height: 188 } as const;
const previewSize = computed(() => {
  const it = item.value;
  const ratio = it?.width && it.height ? it.width / it.height : (it?.aspectRatio ?? 1);
  return ratio > PREVIEW.width / PREVIEW.height
    ? { width: PREVIEW.width, height: Math.round(PREVIEW.width / ratio) }
    : { width: Math.round(PREVIEW.height * ratio), height: PREVIEW.height };
});
const favorited = computed(() => historyManager.favoriteSet.value.has(props.itemId));

const linkItem = computed(() => (item.value && source.value
  ? { url: source.value.url, fileName: item.value.localFileName, serviceId: source.value.id }
  : null));
const linkText = computed(() => (linkItem.value ? formatLinkWithConfig(linkItem.value, config.value, props.format) : ''));
/** 链接块按网址分色：用复制时实际写出来的那个（微博等会经代理改写） */
const shownUrl = computed(() => (linkItem.value ? applyConfiguredUrlWithConfig(linkItem.value.url, linkItem.value.serviceId, config.value) : ''));

async function copyLink(key: string, hostId?: string): Promise<void> {
  const it = item.value;
  const row = hostId ? rows.value.find((r) => r.id === hostId) : source.value;
  if (!it || !row) return;
  const result = await copyLinks([{ url: row.url, fileName: it.localFileName, serviceId: row.id }], { format: props.format, showSuccessToast: false });
  if (result.ok) markCopied(key);
}

/** 改用备份：立即生效，通知里「撤销」改回原来那一份（交接说明规则 3） */
async function useHost(hostId: string): Promise<void> {
  const previous = source.value?.id;
  // 没换成（已经是这一份，或写库失败、已报错）就不报「已改用备份」
  if (!(await mirror.switchPrimary(hostId))) return;
  justSwitched.value = hostId;
  if (previous) {
    void actions.announceSwitch(hostId, () => {
      justSwitched.value = null;
      void mirror.switchPrimary(previous);
    });
  }
}

async function openHost(hostId: string): Promise<void> {
  const row = rows.value.find((r) => r.id === hostId);
  if (row) await openUserExternalUrl(row.url);
}

/** 还没有这张图的图床（「补充备份到…」列出它们） */
const backupTargets = computed(() => {
  const present = new Set(rows.value.map((row) => row.id));
  return upload.hosts.value.filter((host) => !present.has(host.id));
});
const backingUp = ref(false);
async function backupTo(hostId: string): Promise<void> {
  backingUp.value = true;
  try {
    const outcome = await actions.backupTo([props.itemId], hostId, { quiet: true });
    if (outcome.succeeded.length) await load(true);
  } finally {
    backingUp.value = false;
  }
}

function openLightbox(): void {
  const found = props.grid.allLoadedMetas.value.find((m) => m.id === props.itemId);
  if (found) emit('openLightbox', found);
}

async function removeRecord(): Promise<void> {
  if (await actions.removeRecords([props.itemId], item.value?.localFileName)) emit('removed', [props.itemId]);
}
</script>

<template>
  <aside class="detail" aria-label="图片详情">
    <template v-if="item">
      <div class="detail__head">
        <button type="button" class="detail__preview" aria-label="查看大图" @click="openLightbox">
          <span class="detail__image" :style="{ width: `${previewSize.width}px`, height: `${previewSize.height}px` }">
            <ThumbnailImage v-if="thumbs.length" :srcs="thumbs" :alt="item.localFileName" :confirmed-http-hosts="grid.confirmedHttpHosts.value" />
          </span>
        </button>
        <div class="detail__title-row">
          <div class="detail__title">
            <span class="detail__name">{{ item.localFileName }}</span>
            <span class="detail__meta">{{ meta }}</span>
          </div>
          <button type="button" class="detail__star" :class="{ 'detail__star--on': favorited }" :aria-label="favorited ? '取消收藏' : '收藏'" @click="grid.toggleFavorite(itemId)">
            <PnIcon name="star" :size="16" :stroke="1.8" :filled="favorited" />
          </button>
        </div>
      </div>

      <section class="detail__section">
        <div class="detail__label-row">
          <span class="detail__label">链接</span>
          <span class="detail__muted">{{ FORMAT_NAMES[format] }}</span>
        </div>
        <div v-if="linkItem" class="detail__link-row">
          <LinkBlock compact :broken="source?.health === 'dead'" :text="linkText" :url="shownUrl" :filename="item.localFileName" class="detail__link" />
          <button type="button" class="detail__copy" :class="{ 'detail__copy--done': copiedKey === 'link' }" @click="copyLink('link')">
            {{ copiedKey === 'link' ? '已复制' : '复制' }}
          </button>
        </div>
      </section>

      <section class="detail__section detail__section--grow">
        <div class="detail__label-row detail__label-row--baseline">
          <span class="detail__label">存放在</span>
          <span class="detail__muted">{{ rows.length }} 个图床</span>
        </div>
        <div v-if="banner?.kind === 'broken'" class="detail__notice">
          <PnIcon name="warning" :size="16" :stroke="2.2" class="detail__notice-icon" />
          <div class="detail__notice-text">
            <span class="detail__notice-title">{{ banner.title }}</span>
            <span class="detail__notice-sub">{{ banner.sub }}</span>
          </div>
          <PnButton variant="primary" size="sm" @click="useHost(banner.useId)">改用{{ banner.useName }}</PnButton>
        </div>
        <div v-else-if="banner?.kind === 'dead'" class="detail__notice detail__notice--top">
          <PnIcon name="warning" :size="16" :stroke="2.2" class="detail__notice-icon" />
          <div class="detail__notice-text">
            <span class="detail__notice-title">所有链接均已失效</span>
            <span class="detail__notice-sub">如本地仍有原图，可重新上传；文档中的引用可通过「文档修复」定位。</span>
          </div>
        </div>
        <GalleryDetailHosts
          :rows="rows"
          :name="name"
          :copied-id="copiedKey && copiedKey !== 'link' ? copiedKey : null"
          :checking="mirror.checkingServices.value"
          @copy="(hostId) => copyLink(hostId, hostId)"
          @use="useHost"
          @check="mirror.checkMirror"
          @open="openHost"
          @remove="mirror.removeMirror"
        />
        <PnMenu v-if="backupTargets.length" align="start" :width="200">
          <template #trigger>
            <button type="button" class="detail__ghost" aria-haspopup="menu" :disabled="backingUp">
              {{ backingUp ? '正在补充备份…' : '补充备份到…' }}
              <PnIcon name="chevronDown" :size="12" :stroke="1.8" class="detail__muted" />
            </button>
          </template>
          <PnMenuItem v-for="host in backupTargets" :key="host.id" @select="backupTo(host.id)">{{ host.name }}</PnMenuItem>
        </PnMenu>
      </section>

      <div class="detail__foot">
        <button type="button" class="detail__remove" @click="removeRecord">移除记录</button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.detail {
  display: flex;
  flex: none;
  flex-direction: column;
  width: var(--pn-size-gallery-detail);
  box-sizing: border-box;
  overflow: hidden auto;
  box-shadow: inset 1px 0 0 var(--pn-border);
}

.detail__head {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-dialog-gap);
  padding: var(--pn-space-16) var(--pn-space-20) 0;
}

.detail__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--pn-size-detail-preview);
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: var(--pn-radius-lg);
  background: var(--pn-subtle);
  cursor: zoom-in;
}

.detail__image {
  display: flex;
  overflow: hidden;
  box-shadow: 0 0 0 1px var(--pn-hairline);
}

.detail__title-row { display: flex; align-items: flex-start; gap: var(--pn-space-8); }

.detail__title {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-2);
  min-width: 0;
}

.detail__name {
  font-size: var(--pn-text-headline);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-headline);
  letter-spacing: var(--pn-tracking-headline);
  word-break: break-all;
}

.detail__meta,
.detail__muted { color: var(--pn-text3); font-size: var(--pn-text-footnote); }

.detail__star {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-button-md);
  height: var(--pn-size-button-md);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
}

.detail__star:hover { background: var(--pn-row-hover); }
.detail__star--on { color: var(--pn-warning-fill); }

.detail__section {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-8);
  padding: var(--pn-space-16) var(--pn-space-20) 0;
}

.detail__section--grow { flex: 1; padding-top: var(--pn-space-batch-bottom); }

.detail__label-row { display: flex; align-items: center; justify-content: space-between; gap: var(--pn-space-8); padding: 0 var(--pn-space-2); }
.detail__label-row--baseline { align-items: baseline; justify-content: flex-start; }

.detail__label {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-semibold);
}

.detail__link-row { display: flex; align-items: stretch; gap: var(--pn-space-6); }
.detail__link { flex: 1; min-width: 0; }

.detail__copy {
  flex: none;
  width: var(--pn-size-detail-copy);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-md);
  background: var(--pn-secondary-bg);
  box-shadow: var(--pn-secondary-ring);
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
}

.detail__copy--done {
  background: var(--pn-success-soft);
  box-shadow: none;
  color: var(--pn-success);
  font-weight: var(--pn-weight-medium);
}

.detail__notice {
  display: flex;
  align-items: center;
  gap: var(--pn-space-button-sm-x);
  padding: var(--pn-space-12);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-warning-soft);
}

.detail__notice--top { align-items: flex-start; }
.detail__notice-icon { flex: none; color: var(--pn-warning); }
.detail__notice--top .detail__notice-icon { margin-top: var(--pn-space-2); }

.detail__notice-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.detail__notice-title { font-weight: var(--pn-weight-medium); }
.detail__notice-sub { color: var(--pn-text2); font-size: var(--pn-text-footnote); }

.detail__ghost {
  display: flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--pn-space-copy-gap);
  height: var(--pn-size-button-sm);
  margin-left: calc(-1 * var(--pn-space-6));
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  font-size: var(--pn-text-footnote);
}

.detail__ghost:hover:not(:disabled),
.detail__ghost[data-state='open'] { background: var(--pn-row-hover); }

.detail__foot {
  display: flex;
  align-items: center;
  margin-top: var(--pn-space-16);
  padding: var(--pn-space-12) var(--pn-space-20) var(--pn-space-16);
  box-shadow: inset 0 1px 0 var(--pn-border);
}

.detail__remove {
  height: var(--pn-size-button-sm);
  margin-left: calc(-1 * var(--pn-space-8));
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-danger);
  font: inherit;
}

.detail__remove:hover { background: var(--pn-danger-soft); }
</style>
