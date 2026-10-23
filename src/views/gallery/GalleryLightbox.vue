<script setup lang="ts">
// 灯箱（GalleryScreen.dc.html G08）：双击或空格打开，从缩略图位置连续放大；Esc 缩回原位。
// ← → 切换、滚轮缩放、拖动平移交给 PhotoSwipe（usePhotoSwipeBridge），这里只画顶栏、翻页按钮、底栏。
// 当前图床没加载出来：顶栏提示 +「换个图床」（检测确认失效才说「已失效」，否则只说加载失败），各备份带状态，Enter 切到选中的那份（只换这次看的，不改「复制时使用」）。
// 灯箱不随主题：自绘部分标 data-theme="dark" 取深色令牌。
// 顶栏、底栏是实心深色底：长图、放大的图平移时从它们下面经过，不盖住按钮。
// 底栏不放「信息」按钮：文件名、尺寸、大小、图床已写在底栏，跳去详情会先把大图缩回去。
import 'photoswipe/style.css';
import './galleryLightbox.css';
import { computed, ref, watch } from 'vue';
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui';
import HostIcon from '@/components/biz/HostIcon.vue';
import PetalGlyph from '@/components/biz/PetalGlyph.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import type { HistoryItem } from '@/config/types';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { useMirrorFallback } from '@/composables/history/useMirrorFallback';
import { usePhotoSwipeBridge } from '@/composables/history/usePhotoSwipeBridge';
import { useThumbCache } from '@/composables/image/useThumbCache';
import { useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import { useCopyLink } from '@/composables/useCopyLink';
import { safeImageUrl } from '@/security/networkPolicy';
import { openUserExternalUrl } from '@/security/shellOpen';
import { formatCount, formatFileSize, formatTimestampFull } from '@/utils/formatters';
import { getPrimaryImageUrl } from '@/utils/imageUrl';
import type { LinkFormat } from '@/utils/linkFormatter';
import type { PetalState } from '@/utils/petals';
import { hostRows, lightboxFailure } from './detailHosts';
import { useGalleryActions } from './useGalleryActions';
import type { GalleryGridApi } from './useGalleryGrid';
import type { GalleryLightboxApi } from './useGalleryLightbox';
import { vOverflowTitle } from '@/utils/overflowTitle';

const props = defineProps<{
  grid: GalleryGridApi;
  /** 翻页从哪来（网格按天、列表按行），见 useGalleryLightbox */
  nav: GalleryLightboxApi;
  format: LinkFormat;
}>();

const emit = defineEmits<{
  removed: [ids: string[]];
}>();

const lightbox = props.nav;
const config = computed(() => props.grid.config.value);
const hosts = computed(() => props.grid.confirmedHttpHosts.value);
const thumbCache = useThumbCache();
const actions = useGalleryActions();
const { copyLinks } = useCopyLink();
const { copiedKey, markCopied } = useCopyBadgeFeedback(1500);

const item = ref<HistoryItem | null>(null);
watch(lightbox.lightboxItem, (next) => { item.value = next; }, { immediate: true });

const mirror = useMirrorFallback(item);
const name = (hostId: string) => getServiceDisplayName(hostId, config.value);
const rows = computed(() => hostRows(mirror.mirrors.value, item.value?.linkCheckStatus, null));

/** 这次看的是哪个图床的那份（null = 复制时使用的那份）；换一张图就复原 */
const viewHost = ref<string | null>(null);
const loadFailed = ref(false);
watch(() => item.value?.id, () => {
  viewHost.value = null;
  loadFailed.value = false;
});
const shownHost = computed(() => viewHost.value ?? item.value?.primaryService ?? null);
const failure = computed(() => (loadFailed.value && shownHost.value ? lightboxFailure(rows.value, shownHost.value, name) : null));

const rawImageSrc = computed(() => {
  const it = item.value;
  if (!it) return '';
  if (viewHost.value) return rows.value.find((row) => row.id === viewHost.value)?.url ?? '';
  return getPrimaryImageUrl(it, config.value);
});
// 与缩略图同一道闸：明文 HTTP / 内网地址没确认过就不请求（调用方清单见 networkPolicy 的 getConfirmedHttpHosts）
const imageSrc = computed(() => safeImageUrl(rawImageSrc.value, hosts.value) ?? '');
const mediumSrc = computed(() => (item.value && !viewHost.value ? safeImageUrl(thumbCache.getMediumImageUrl(item.value), hosts.value) ?? '' : ''));

/** 「换个图床」菜单开着：Esc 只关菜单、方向键在菜单里走，不归灯箱 */
const menuOpen = ref(false);

/** 菜单一打开就停在第一份能看的上（G08：直接按 Enter 就能换过去） */
function focusFirstHost(event: Event): void {
  event.preventDefault();
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('.lightbox__menu .lightbox__menu-row:not([data-disabled])')?.focus();
  });
}

const { pswpEl, isLoading, setSwitchDirection } = usePhotoSwipeBridge({
  visible: lightbox.lightboxVisible,
  imageSrc,
  mediumSrc,
  itemId: computed(() => item.value?.id),
  imageWidth: computed(() => item.value?.width || 0),
  imageHeight: computed(() => item.value?.height || 0),
  hasPrev: lightbox.lightboxHasPrev,
  hasNext: lightbox.lightboxHasNext,
  onClose: () => { lightbox.lightboxVisible.value = false; },
  onNavigate: (direction) => { void lightbox.handleLightboxNavigate(direction); },
  onLoadError: () => { loadFailed.value = true; },
  onLoadSuccess: () => { loadFailed.value = false; },
  blockKeys: () => menuOpen.value,
});

function navigate(direction: 'prev' | 'next'): void {
  setSwitchDirection(direction);
  void lightbox.handleLightboxNavigate(direction);
}

/** 「3 / 21」：这张在当前结果里排第几（网格按天累加，列表就是第几行） */
const position = lightbox.position;

const metaLine = computed(() => {
  const it = item.value;
  if (!it) return '';
  const parts = [formatTimestampFull(new Date(it.timestamp)).slice(0, 16)];
  if (it.width && it.height) parts.push(`${it.width} × ${it.height}`);
  if (it.fileSize) parts.push(formatFileSize(it.fileSize));
  return parts.join(' · ');
});
// 与格子一样只数份数（G08 两片都是品牌蓝）；哪份有问题由顶栏提示和「换个图床」菜单说
const petals = computed(() => rows.value.map((): PetalState => 'ok'));
const hostLine = computed(() => rows.value.map((row) => name(row.id)).join(' · '));
const favorited = computed(() => !!item.value && props.grid.historyManager.favoriteSet.value.has(item.value.id));

/** 换个图床菜单里各份的状态（灯箱里正常的也写「正常」，让人知道能切过去） */
const menuStatus = (health: string) => ({ dead: '图片已不存在', limited: '可能受限', unchecked: '尚未检测', ok: '正常' })[health] ?? '';

async function copyLink(): Promise<void> {
  const it = item.value;
  const row = rows.value.find((r) => r.isCopySource);
  if (!it || !row) return;
  const result = await copyLinks([{ url: row.url, fileName: it.localFileName, serviceId: row.id }], { format: props.format, showSuccessToast: false });
  if (result.ok) markCopied('link');
}

async function openInBrowser(): Promise<void> {
  if (rawImageSrc.value) await openUserExternalUrl(rawImageSrc.value);
}

async function removeRecord(): Promise<void> {
  const it = item.value;
  if (!it) return;
  if (await actions.removeRecords([it.id], it.localFileName)) {
    lightbox.lightboxVisible.value = false;
    emit('removed', [it.id]);
  }
}

</script>

<template>
  <Teleport v-if="pswpEl" :to="pswpEl">
    <div class="lightbox-chrome" data-theme="dark" role="dialog" aria-label="大图查看">
      <div class="lightbox__top">
        <button type="button" class="lightbox__button lightbox__button--icon" aria-label="关闭" title="关闭  Esc" @click="lightbox.lightboxVisible.value = false">
          <PnIcon name="close" :size="13" :stroke="2" />
        </button>
        <span v-if="position" class="lightbox__muted">{{ formatCount(position) }} / {{ formatCount(grid.totalCount.value) }}</span>
        <div class="lightbox__spacer" />
        <div v-if="failure" class="lightbox__banner">
          <PnIcon name="warning" :size="14" :stroke="2.2" class="lightbox__warn" />
          <span>{{ failure.banner }}</span>
          <DropdownMenuRoot v-model:open="menuOpen" :modal="false">
            <DropdownMenuTrigger as-child>
              <button type="button" class="lightbox__chip" aria-haspopup="menu">
                换个图床
                <PnIcon name="chevronDown" :size="12" :stroke="1.8" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="lightbox__menu" align="center" :side-offset="12" :collision-padding="8" @open-auto-focus="focusFirstHost">
              <DropdownMenuItem
                v-for="row in rows"
                :key="row.id"
                class="lightbox__menu-row"
                :disabled="row.id === shownHost"
                @select="viewHost = row.id"
              >
                <span class="lightbox__plate"><HostIcon :host="row.id" :size="13" :name="name(row.id)" /></span>
                <span class="lightbox__menu-text">
                  <span>{{ name(row.id) }}</span>
                  <span class="lightbox__menu-status" :class="{ 'lightbox__warn': row.warn }">{{ menuStatus(row.health) }}</span>
                </span>
                <span class="lightbox__menu-hint">Enter</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuRoot>
        </div>
        <div class="lightbox__spacer" />
        <span class="lightbox__balance" aria-hidden="true" />
      </div>

      <button v-if="lightbox.lightboxHasPrev.value" type="button" class="lightbox__nav lightbox__nav--prev" aria-label="上一张" @click="navigate('prev')">
        <PnIcon name="chevronLeft" :size="16" :stroke="2" />
      </button>
      <button v-if="lightbox.lightboxHasNext.value" type="button" class="lightbox__nav lightbox__nav--next" aria-label="下一张" @click="navigate('next')">
        <PnIcon name="chevronRight" :size="16" :stroke="2" />
      </button>

      <div v-if="failure" class="lightbox__failed">
        <PnIcon name="imageGone" :size="40" :stroke="1.3" />
        <span>{{ failure.body }}</span>
      </div>
      <div v-else-if="isLoading" class="lightbox__spinner" role="status" aria-label="图片加载中" />

      <div v-if="item" class="lightbox__bottom">
        <div class="lightbox__info">
          <span v-overflow-title class="lightbox__name">{{ item.localFileName }}</span>
          <span class="lightbox__muted">{{ metaLine }}</span>
        </div>
        <span class="lightbox__hosts">
          <PetalGlyph :states="petals" :size="15" />
          <span v-overflow-title class="lightbox__hosts-text">{{ hostLine }}</span>
        </span>
        <div class="lightbox__spacer" />
        <button type="button" class="lightbox__button" :class="{ 'lightbox__button--done': copiedKey === 'link' }" @click="copyLink">{{ copiedKey === 'link' ? '已复制' : '复制链接' }}</button>
        <button type="button" class="lightbox__button" @click="openInBrowser">在浏览器打开</button>
        <button type="button" class="lightbox__button lightbox__button--icon" :aria-label="favorited ? '取消收藏' : '收藏'" @click="grid.toggleFavorite(item.id)">
          <PnIcon name="star" :size="15" :stroke="1.8" :filled="favorited" :class="{ 'lightbox__star--on': favorited }" />
        </button>
        <button type="button" class="lightbox__button lightbox__button--danger" @click="removeRecord">移除记录</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lightbox-chrome {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: var(--pn-text1);
}

.lightbox-chrome > * { pointer-events: auto; }

.lightbox__top {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: var(--pn-space-button-sm-x);
  height: var(--pn-size-lightbox-top);
  padding: 0 var(--pn-space-12) 0 var(--pn-space-16);
  background: var(--pn-lightbox-bg);
}

.lightbox__spacer { flex: 1; }
.lightbox__balance { width: var(--pn-size-button-lg); }
.lightbox__muted { color: var(--pn-text3); font-size: var(--pn-text-footnote); }
.lightbox__warn { color: var(--pn-warning); }

.lightbox__button {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--pn-size-button-lg);
  padding: 0 var(--pn-space-12);
  border: 0;
  border-radius: var(--pn-radius-md);
  flex: none;
  background: var(--pn-lightbox-button);
  color: var(--pn-text1);
  font: inherit;
  white-space: nowrap;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in), color var(--pn-dur-fast) var(--pn-ease-in);
}

.lightbox__button:hover { background: var(--pn-lightbox-button-hover); }
.lightbox__button:active { background: var(--pn-lightbox-button-press); }
.lightbox__button--icon { width: var(--pn-size-button-lg); padding: 0; }
.lightbox__button--danger { color: var(--pn-danger); }
.lightbox__button--done { color: var(--pn-success); }
.lightbox__star--on { color: var(--pn-warning-fill); }

.lightbox__banner {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  height: var(--pn-size-lightbox-banner);
  padding: 0 var(--pn-space-6) 0 var(--pn-space-12);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-lightbox-button);
}

.lightbox__chip {
  display: flex;
  align-items: center;
  gap: var(--pn-space-copy-gap);
  height: var(--pn-size-lightbox-chip);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-lightbox-chip);
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.lightbox__chip:hover { background: var(--pn-lightbox-button-hover); }

.lightbox__chip:active,
.lightbox__chip[data-state='open'] { background: var(--pn-lightbox-button-press); }

.lightbox__nav {
  position: absolute;
  top: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-lightbox-nav);
  height: var(--pn-size-lightbox-nav);
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--pn-lightbox-button);
  color: var(--pn-text1);
  transform: translateY(-50%);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.lightbox__nav:hover { background: var(--pn-lightbox-button-hover); }
.lightbox__nav:active { background: var(--pn-lightbox-button-press); }
.lightbox__nav--prev { left: var(--pn-space-20); }
.lightbox__nav--next { right: var(--pn-space-20); }

.lightbox__failed {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--pn-space-button-sm-x);
  width: var(--pn-size-lightbox-failed-w);
  max-width: calc(100% - 2 * var(--pn-size-lightbox-nav) - 4 * var(--pn-space-20));
  height: var(--pn-size-lightbox-failed-h);
  max-height: calc(100% - var(--pn-size-lightbox-top) - var(--pn-size-lightbox-bottom));
  border-radius: var(--pn-radius-sm);
  background: var(--pn-canvas);
  box-shadow: 0 0 0 1px var(--pn-lightbox-rule);
  color: var(--pn-text3);
  transform: translate(-50%, -50%);
}

.lightbox__spinner {
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--pn-size-lightbox-nav);
  height: var(--pn-size-lightbox-nav);
  box-sizing: border-box;
  border: var(--pn-space-2) solid var(--pn-lightbox-chip);
  border-top-color: var(--pn-text1);
  border-radius: 50%;
  translate: -50% -50%;
  animation: pn-spin var(--pn-dur-spin) linear infinite;
  pointer-events: none;
}


.lightbox__bottom {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: var(--pn-space-dialog-gap);
  height: var(--pn-size-lightbox-bottom);
  padding: 0 var(--pn-space-16) 0 var(--pn-space-20);
  box-shadow: inset 0 1px 0 var(--pn-lightbox-rule);
  background: var(--pn-lightbox-bg);
}

.lightbox__info { display: flex; flex-direction: column; min-width: 0; }

.lightbox__info .lightbox__muted,
.lightbox__hosts-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lightbox__name {
  overflow: hidden;
  font-weight: var(--pn-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lightbox__hosts {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  min-width: 0;
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
}
</style>
