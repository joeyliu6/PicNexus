<script setup lang="ts">
// 命令面板（HomeScreen.dc.html H15 / H16）：宽 640、圆角 16，与对话框同一遮罩和阴影；↑↓ 选择，Enter 执行。
// 图片：Enter 复制链接（面板不关，行内显示「已复制」），Ctrl+Enter 在图库中定位；设置项 Enter 跳到那一项。
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { emit as tauriEmit } from '@tauri-apps/api/event';
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import type { HistoryItem } from '@/config/types';
import { getThumbnailCandidates } from '@/composables/image/useThumbCache';
import { useLinkCheckManager } from '@/composables/link-check/useLinkCheck';
import { repairState } from '@/views/health/useLinkHealth';
import { useConfirmedHttpHosts } from '@/composables/image/useConfirmedHttpHosts';
import { useCopyLink } from '@/composables/useCopyLink';
import { useThemeManager } from '@/composables/useTheme';
import { useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import { useUploadController } from '@/composables/upload/useUploadController';
import { uiPlatform } from '@/utils/platform';
import { shortcutLabel } from './commandIndex';
import { requestLocate } from './galleryLocate';
import { useCommandPalette, type CommandEntry } from './useCommandPalette';
import { useUrlDialog } from './useUrlDialog';
import { vOverflowTitle } from '@/utils/overflowTitle';

const palette = useCommandPalette();
const upload = useUploadController();
const confirmedHttpHosts = useConfirmedHttpHosts(upload.config);
const router = useRouter();
const linkCheck = useLinkCheckManager();
const { copyLinks } = useCopyLink();
const theme = useThemeManager();
const urlDialog = useUrlDialog();
const { markCopied, isCopied } = useCopyBadgeFeedback(1500);

const mac = uiPlatform() === 'macos';
/** 写法照设计稿底栏：「Ctrl+Enter」/「⌘Enter」 */
const mod = mac ? '⌘' : 'Ctrl+';
const activeIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

watch(() => palette.flat.value.length, () => { activeIndex.value = 0; });
watch(palette.open, async (open) => {
  if (!open) return;
  activeIndex.value = 0;
  await nextTick();
  inputRef.value?.focus();
});

/** 底栏跟着选中的那一项说 Enter 会做什么：图片复制链接（交接说明 8.1 命令面板），其余打开 */
const activeIsImage = computed(() => palette.flat.value[activeIndex.value]?.run.kind === 'image');

function historyUrl(item: HistoryItem): string | undefined {
  return item.results.find((r) => r.serviceId === item.primaryService && r.status === 'success')?.result?.url ?? item.generatedLink;
}

async function run(entry: CommandEntry, alt: boolean): Promise<void> {
  const target = entry.run;
  if (target.kind === 'image') {
    if (alt) {
      palette.hide();
      requestLocate(target.item.id, target.item.timestamp);
      await router.push('/gallery');
      return;
    }
    const url = historyUrl(target.item);
    if (!url) return;
    const result = await copyLinks([{ url, fileName: target.item.localFileName, serviceId: target.item.primaryService }], { showSuccessToast: false });
    if (result.ok) markCopied(entry.id);
    return;
  }
  palette.hide();
  if (target.kind === 'page') await router.push(target.path);
  else if (target.kind === 'setting') void tauriEmit('navigate-to', target.target);
  else if (target.action === 'paste') void upload.pasteClipboard();
  else if (target.action === 'pick') void upload.pickAndUpload();
  else if (target.action === 'url') { await router.push('/home'); urlDialog.show(); }
  else if (target.action === 'check') {
    // 直接开始检测，并到链接健康页看进度（正在检测或修复时只跳过去）
    await router.push('/health');
    if (!linkCheck.isChecking.value && !repairState.running) void linkCheck.checkAllHistoryLinks();
  }
  else if (target.action === 'theme') await theme.setTheme(theme.effectiveTheme.value === 'dark' ? 'light' : 'dark');
}

function onKeydown(event: KeyboardEvent) {
  const count = palette.flat.value.length;
  if (event.key === 'ArrowDown' && count) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % count;
    scrollActive();
  } else if (event.key === 'ArrowUp' && count) {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + count) % count;
    scrollActive();
  } else if (event.key === 'Enter') {
    const entry = palette.flat.value[activeIndex.value];
    if (!entry) return;
    event.preventDefault();
    void run(entry, event.ctrlKey || event.metaKey);
  }
}

function scrollActive() {
  void nextTick(() => listRef.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }));
}

function indexOf(entry: CommandEntry): number {
  return palette.flat.value.indexOf(entry);
}

function hintOf(entry: CommandEntry): string {
  if (isCopied(entry.id)) return '已复制';
  if (entry.run.kind === 'image' && palette.query.value.trim() && indexOf(entry) === activeIndex.value) return 'Enter 复制链接';
  return shortcutLabel(entry.hint, mac);
}

</script>

<template>
  <DialogRoot v-model:open="palette.open.value">
    <DialogPortal>
      <DialogOverlay class="pn-layer command-palette__overlay" />
      <DialogContent class="pn-layer command-palette" :aria-describedby="undefined" @keydown="onKeydown">
        <DialogTitle class="command-palette__sr">命令面板</DialogTitle>
        <div class="command-palette__input-row">
          <PnIcon name="search" :size="16" :stroke="1.8" class="command-palette__muted" />
          <input
            ref="inputRef"
            v-model="palette.query.value"
            class="command-palette__input"
            placeholder="搜索图片、页面或命令"
            spellcheck="false"
            autocomplete="off"
            aria-label="搜索图片、页面或命令"
          >
          <kbd class="command-palette__kbd">Esc</kbd>
        </div>

        <div ref="listRef" class="command-palette__list">
          <template v-for="group in palette.groups.value" :key="group.title">
            <div class="command-palette__group">{{ group.title }}</div>
            <button
              v-for="entry in group.entries"
              :key="entry.id"
              type="button"
              class="command-palette__item"
              :class="{ 'command-palette__item--tall': entry.sub }"
              :data-active="indexOf(entry) === activeIndex"
              @mousemove="activeIndex = indexOf(entry)"
              @click="run(entry, $event.ctrlKey || $event.metaKey)"
            >
              <span v-if="entry.image" class="command-palette__thumb">
                <ThumbnailImage :srcs="getThumbnailCandidates(entry.image, upload.config.value)" alt="" :confirmed-http-hosts="confirmedHttpHosts" />
              </span>
              <span v-else class="command-palette__icon"><PnIcon :name="entry.icon ?? 'arrowRight'" :size="15" :stroke="1.6" /></span>
              <span class="command-palette__text">
                <span v-overflow-title class="command-palette__label">
                  <template v-if="entry.match">{{ entry.match[0] }}<b class="command-palette__hit">{{ entry.match[1] }}</b>{{ entry.match[2] }}</template>
                  <template v-else>{{ entry.label }}</template>
                </span>
                <span v-if="entry.sub" class="command-palette__sub">{{ entry.sub }}</span>
              </span>
              <span class="command-palette__hint" :class="{ 'command-palette__hint--done': isCopied(entry.id) }">{{ hintOf(entry) }}</span>
            </button>
          </template>
          <p v-if="!palette.groups.value.length" class="command-palette__empty">没有找到「{{ palette.query.value }}」</p>
        </div>

        <div class="command-palette__foot">
          <span>↑↓ 选择</span>
          <span>Enter {{ activeIsImage ? '复制链接' : '打开' }}</span>
          <span v-if="activeIsImage">{{ mod }}Enter 在图库中定位</span>
          <div class="command-palette__spacer" />
          <span>Esc 关闭</span>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.command-palette__overlay {
  position: fixed;
  inset: 0;
  z-index: var(--pn-z-dialog);
  background: var(--pn-scrim-light);
}

.command-palette {
  position: fixed;
  top: var(--pn-space-palette-top);
  left: 50%;
  z-index: var(--pn-z-dialog);
  display: flex;
  flex-direction: column;
  width: var(--pn-size-palette);
  max-width: calc(100vw - var(--pn-space-32));
  max-height: calc(100vh - var(--pn-space-palette-top) - var(--pn-space-32));
  overflow: hidden;
  border-radius: var(--pn-radius-dialog);
  background: var(--pn-elevated);
  box-shadow: var(--pn-e4);
  transform: translateX(-50%);
}

/* 遮罩与面板一起淡入（标准 200ms），关时一起淡出、ease-out、快 30%；「减少动态效果」时照样淡入淡出（关键帧在 pn-base.css） */
.command-palette__overlay[data-state='open'],
.command-palette[data-state='open'] { animation: pn-dialog-fade var(--pn-dur-standard) var(--pn-ease-in); }

.command-palette__overlay[data-state='closed'],
.command-palette[data-state='closed'] { animation: pn-fade-out calc(var(--pn-dur-standard) * 0.7) var(--pn-ease-out) forwards; }

@media (prefers-reduced-motion: reduce) {
  .command-palette__overlay[data-state='open'],
  .command-palette[data-state='open'] { animation: pn-dialog-fade var(--pn-dur-fade-standard) var(--pn-ease-in); }

  .command-palette__overlay[data-state='closed'],
  .command-palette[data-state='closed'] { animation: pn-fade-out calc(var(--pn-dur-fade-standard) * 0.7) var(--pn-ease-out) forwards; }
}

.command-palette__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.command-palette__input-row {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-sidebar-x);
  height: var(--pn-size-logo-row);
  padding: 0 var(--pn-space-16);
  box-shadow: inset 0 -1px 0 var(--pn-border);
}

.command-palette__muted { flex: none; color: var(--pn-text3); }

.command-palette__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-headline);
}

.command-palette__input::placeholder { color: var(--pn-text3); }

.command-palette__kbd {
  padding: var(--pn-space-1) var(--pn-space-6);
  border-radius: var(--pn-radius-xs);
  box-shadow: inset 0 0 0 1px var(--pn-border);
  color: var(--pn-text3);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-caption);
}

.command-palette__list { display: flex; flex-direction: column; padding: var(--pn-space-6); overflow-y: auto; }

.command-palette__group {
  padding: var(--pn-space-8) var(--pn-space-sidebar-x) var(--pn-space-4);
  font-size: var(--pn-text-caption);
  font-weight: var(--pn-weight-medium);
  color: var(--pn-text3);
}

.command-palette__item {
  display: flex;
  align-items: center;
  gap: var(--pn-space-sidebar-x);
  min-height: var(--pn-size-palette-item);
  padding: 0 var(--pn-space-sidebar-x);
  border: 0;
  border-radius: var(--pn-radius-md);
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  text-align: left;
}

.command-palette__item--tall { min-height: var(--pn-size-palette-item-tall); }
.command-palette__item[data-active='true'] { background: var(--pn-menu-sel); }
.command-palette__item:active { background: var(--pn-ghost-press); }

.command-palette__thumb {
  flex: none;
  width: var(--pn-size-palette-thumb-w);
  height: var(--pn-size-palette-thumb-h);
  overflow: hidden;
  border-radius: var(--pn-radius-sm);
  background: var(--pn-subtle);
  box-shadow: 0 0 0 1px var(--pn-hairline);
}

.command-palette__icon { display: flex; flex: none; justify-content: center; width: var(--pn-space-20); color: var(--pn-text3); }
.command-palette__text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.command-palette__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.command-palette__hit { color: var(--pn-brand-text); font-weight: var(--pn-weight-semibold); }
.command-palette__sub { font-size: var(--pn-text-footnote); color: var(--pn-text3); }
.command-palette__hint { flex: none; font-size: var(--pn-text-footnote); color: var(--pn-text3); }
.command-palette__hint--done { color: var(--pn-success); }
.command-palette__empty { margin: 0; padding: var(--pn-space-16) var(--pn-space-sidebar-x); color: var(--pn-text3); }

.command-palette__foot {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-16);
  height: var(--pn-size-palette-foot);
  padding: 0 var(--pn-space-16);
  box-shadow: inset 0 1px 0 var(--pn-border);
  font-size: var(--pn-text-footnote);
  color: var(--pn-text3);
}

.command-palette__spacer { flex: 1; }
</style>
