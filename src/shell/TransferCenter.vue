<script setup lang="ts">
// 传输中心面板（HomeScreen.dc.html H14）：宽 360、圆角 14，盖在主栏右侧；点外面或 Esc 关闭。
import { computed, ref } from 'vue';
import { onClickOutside, onKeyStroke } from '@vueuse/core';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import { getThumbnailCandidates } from '@/composables/image/useThumbCache';
import { useConfirmedHttpHosts } from '@/composables/image/useConfirmedHttpHosts';
import { useUploadController } from '@/composables/upload/useUploadController';
import { hostViews, type HostView } from '@/composables/upload/uploadSessions';
import type { QueueItem } from '@/core/UploadQueue';
import { useTransferCenter } from './useTransferCenter';

const transfer = useTransferCenter();
const upload = useUploadController();
const confirmedHttpHosts = useConfirmedHttpHosts(upload.config);
const panel = ref<HTMLElement | null>(null);

onClickOutside(panel, (event) => {
  // 标题栏上的传输按钮自己会切换，别在这里先关掉
  if ((event.target as HTMLElement | null)?.closest('.transfer-button')) return;
  transfer.close();
});
onKeyStroke('Escape', () => { if (transfer.open.value) transfer.close(); });

const nameOf = (hostId: string) => upload.hosts.value.find((h) => h.id === hostId)?.name ?? hostId;

function hostLine(hosts: HostView[]): string {
  return hosts.map((h) => {
    if (h.state === 'done') return `${nameOf(h.id)}已完成`;
    if (h.state === 'failed') return `${nameOf(h.id)}失败`;
    if (h.state === 'uploading') return `${nameOf(h.id)} ${Math.round(h.progress)}%`;
    if (h.state === 'skipped') return `${nameOf(h.id)}已跳过`;
    return `${nameOf(h.id)}等待`;
  }).join(' · ');
}

function itemProgress(item: QueueItem): number {
  const hosts = hostViews(item);
  return hosts.reduce((sum, h) => sum + (h.state === 'done' ? 100 : h.progress), 0) / Math.max(hosts.length, 1);
}

const uploadingImages = computed(() => transfer.activeUploads.value.reduce((n, row) => n + row.counts.uploading + row.counts.waiting, 0));
</script>

<template>
  <aside v-if="transfer.open.value" ref="panel" class="transfer-center" aria-label="传输中心">
    <div class="transfer-center__head">
      <span class="transfer-center__title">传输</span>
      <div class="transfer-center__spacer" />
      <button type="button" class="transfer-center__close" aria-label="关闭" @click="transfer.close()">
        <PnIcon name="close" :size="12" :stroke="2" />
      </button>
    </div>

    <div v-if="transfer.activeUploads.value.length" class="transfer-center__group">
      <div class="transfer-center__group-head">
        <span class="transfer-center__group-title">上传</span>
        <span class="transfer-center__muted">{{ uploadingImages }} 张进行中</span>
      </div>
      <template v-for="row in transfer.activeUploads.value" :key="row.session.id">
        <div v-if="row.items.length === 1" class="transfer-center__item">
          <span class="transfer-center__thumb">
            <ThumbnailImage v-if="row.items[0].primaryUrl" :srcs="getThumbnailCandidates(row.items[0], upload.config.value)" alt="" :confirmed-http-hosts="confirmedHttpHosts" />
          </span>
          <div class="transfer-center__item-body">
            <div class="transfer-center__item-line">
              <span class="transfer-center__name">{{ row.items[0].fileName }}</span>
              <span class="transfer-center__faint">{{ hostViews(row.items[0]).filter((h) => h.state === 'done').length }} / {{ hostViews(row.items[0]).length }}</span>
            </div>
            <div class="transfer-center__bar"><span :style="{ width: `${itemProgress(row.items[0])}%` }" /></div>
            <span class="transfer-center__detail">{{ hostLine(hostViews(row.items[0])) }}</span>
          </div>
        </div>
        <div v-else class="transfer-center__batch">
          <div class="transfer-center__item-line">
            <span class="transfer-center__strong">上传 · {{ row.counts.total }} 张</span>
            <span class="transfer-center__muted">{{ row.counts.done }} / {{ row.counts.total }}</span>
          </div>
          <div class="transfer-center__bar"><span :style="{ width: `${(row.counts.done / row.counts.total) * 100}%` }" /></div>
        </div>
      </template>
    </div>

    <div class="transfer-center__spacer" />

    <div v-if="transfer.finishedUploads.value.length" class="transfer-center__done">
      <div class="transfer-center__item-line">
        <span class="transfer-center__faint">已完成</span>
        <div class="transfer-center__spacer" />
        <button type="button" class="transfer-center__clear" @click="transfer.clearFinished()">清除</button>
      </div>
      <span v-for="row in transfer.finishedUploads.value" :key="row.session.id" class="transfer-center__done-line">
        <PnIcon :name="row.counts.failed === row.counts.total ? 'close' : 'check'" :size="13" :stroke="2.4" :class="row.counts.failed === row.counts.total ? 'transfer-center__danger' : 'transfer-center__success'" />
        <template v-if="row.items.length > 1">上传 {{ row.counts.total }} 张 · {{ row.counts.done }} 张已完成</template>
        <template v-else>{{ row.items[0].fileName }}</template>
      </span>
    </div>

    <p v-if="!transfer.hasAnything.value" class="transfer-center__empty">没有进行中的任务</p>
  </aside>
</template>

<style scoped>
.transfer-center {
  position: absolute;
  top: var(--pn-space-transfer-top);
  right: var(--pn-space-8);
  bottom: var(--pn-space-8);
  z-index: var(--pn-z-popover);
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-transfer-gap);
  width: var(--pn-size-toast);
  max-width: calc(100% - var(--pn-space-16));
  box-sizing: border-box;
  padding: var(--pn-space-16) var(--pn-space-transfer-x);
  overflow-y: auto;
  border-radius: var(--pn-radius-xl);
  background: var(--pn-elevated);
  box-shadow: var(--pn-e4);
}

.transfer-center__head { display: flex; align-items: center; }
.transfer-center__title { font-size: var(--pn-text-headline); font-weight: var(--pn-weight-semibold); }
.transfer-center__spacer { flex: 1; }

.transfer-center__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-icon-button);
  height: var(--pn-size-icon-button);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  cursor: pointer;
}

.transfer-center__close:hover { background: var(--pn-ghost-hover); }

.transfer-center__group { display: flex; flex-direction: column; gap: var(--pn-space-8); }
.transfer-center__group-head { display: flex; align-items: baseline; justify-content: space-between; }

.transfer-center__group-title,
.transfer-center__strong { font-weight: var(--pn-weight-semibold); }

.transfer-center__muted { font-size: var(--pn-text-footnote); color: var(--pn-text2); }
.transfer-center__faint { font-size: var(--pn-text-footnote); color: var(--pn-text3); }

.transfer-center__item { display: flex; align-items: center; gap: var(--pn-space-sidebar-x); }

.transfer-center__thumb {
  flex: none;
  width: var(--pn-size-button-lg);
  height: var(--pn-size-button-lg);
  overflow: hidden;
  border-radius: var(--pn-radius-sm);
  background: var(--pn-subtle);
  box-shadow: 0 0 0 1px var(--pn-hairline);
}

.transfer-center__item-body { display: flex; flex: 1; flex-direction: column; gap: var(--pn-space-4); min-width: 0; }

.transfer-center__item-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--pn-space-8);
  font-size: var(--pn-text-footnote);
}

.transfer-center__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.transfer-center__bar {
  height: var(--pn-size-progress);
  overflow: hidden;
  border-radius: var(--pn-space-2);
  background: var(--pn-track);
}

.transfer-center__bar > span {
  display: block;
  height: 100%;
  background: var(--pn-brand);
  transition: width var(--pn-dur-standard) var(--pn-ease-in);
}

.transfer-center__detail { font-size: var(--pn-text-caption); color: var(--pn-text3); }
.transfer-center__batch { display: flex; flex-direction: column; gap: var(--pn-space-6); }

.transfer-center__done {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-6);
  padding-top: var(--pn-space-16);
  box-shadow: inset 0 1px 0 var(--pn-border);
}

.transfer-center__clear {
  height: var(--pn-size-pill);
  padding: 0 var(--pn-space-6);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  font-size: var(--pn-text-footnote);
  cursor: pointer;
}

.transfer-center__done-line {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  font-size: var(--pn-text-footnote);
  color: var(--pn-text2);
}

.transfer-center__success { flex: none; color: var(--pn-success); }
.transfer-center__danger { flex: none; color: var(--pn-danger); }
.transfer-center__empty { margin: 0; font-size: var(--pn-text-footnote); color: var(--pn-text3); }
</style>
