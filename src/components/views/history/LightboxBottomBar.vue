<script setup lang="ts">
import type { HistoryItem } from '../../../config/types';
import { formatTime, formatFileSize } from '../../../composables/history/useLightboxInfo';

defineProps<{
  item: HistoryItem;
  displayFileName: string;
  successfulServicesText: string;
  isItemFavorited: boolean;
}>();

const emit = defineEmits<{
  (e: 'copy-link'): void;
  (e: 'open-browser'): void;
  (e: 'delete'): void;
  (e: 'toggle-favorite'): void;
}>();
</script>

<template>
  <div class="lightbox-bottom" @click.stop>
    <div class="lightbox-info-cell cell-filename">
      <span class="cell-value filename-value" v-tooltip.top="item.localFileName">{{ displayFileName }}</span>
      <span class="cell-label">文件名</span>
    </div>
    <div class="lightbox-divider"></div>
    <div class="lightbox-info-cell cell-time">
      <span class="cell-value">{{ formatTime(item.timestamp) }}</span>
      <span class="cell-label">上传时间</span>
    </div>
    <div class="lightbox-divider"></div>
    <div class="lightbox-info-cell cell-size">
      <span class="cell-value">{{ formatFileSize(item.fileSize ?? 0) }}</span>
      <span class="cell-label">文件大小</span>
    </div>
    <div class="lightbox-divider"></div>
    <div
      class="lightbox-info-cell cell-source"
      v-tooltip.top="successfulServicesText"
    >
      <span class="cell-value source-value">{{ successfulServicesText }}</span>
      <span class="cell-label">已传图床</span>
    </div>
    <div class="lightbox-actions">
      <button
        class="action-btn"
        :class="{ 'action-btn-favorited': isItemFavorited }"
        @click="emit('toggle-favorite')"
        v-tooltip.top="isItemFavorited ? '取消收藏' : '收藏'"
      >
        <i :class="isItemFavorited ? 'pi pi-star-fill' : 'pi pi-star'"></i>
      </button>
      <button class="action-btn" @click="emit('copy-link')" v-tooltip.top="'复制链接'">
        <i class="pi pi-copy"></i>
      </button>
      <button class="action-btn" @click="emit('open-browser')" v-tooltip.top="'在浏览器打开'">
        <i class="pi pi-external-link"></i>
      </button>
      <button class="action-btn action-btn-danger" @click="emit('delete')" v-tooltip.top="'删除记录'">
        <i class="pi pi-trash"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.lightbox-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 3;
  height: 64px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- Lightbox 遮罩背景含 rgb 色值 */
  background: rgb(0 0 0 / 55%);
  backdrop-filter: blur(40px) saturate(180%);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- box-shadow 含 rgb 色值 */
  box-shadow: 0 -1px 0 0 rgb(255 255 255 / 10%);
  display: flex;
  align-items: center;
  padding: 0 var(--space-xl);
  cursor: default;
}

.lightbox-info-cell {
  display: flex;
  flex-direction: column;
  padding: 0 var(--space-lg);
  gap: var(--space-2xs);
  min-width: 0;
  flex-shrink: 0;
}

.cell-filename {
  flex: 5;
  flex-shrink: 1;
  padding-left: 0;
}

.cell-time {
  flex: 2;
}

.cell-size {
  flex: 1;
}

.cell-source {
  flex: 1.5;
  flex-shrink: 1;
}

.cell-value {
  color: var(--text-main);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- text-shadow 含 rgb 色值 */
  text-shadow: 0 1px 3px rgb(0 0 0 / 50%);
}

.source-value,
.filename-value {
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-label {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  letter-spacing: 0.02em;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- text-shadow 含 rgb 色值 */
  text-shadow: 0 1px 2px rgb(0 0 0 / 40%);
}

.lightbox-divider {
  width: 1px;
  height: 28px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

.lightbox-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
  padding-left: var(--space-lg);
}

.action-btn {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  border: none;
  background: var(--hover-overlay-subtle);
  color: var(--text-muted);
  font-size: var(--text-lg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast) ease;
}

.action-btn:hover {
  background: var(--hover-overlay);
  color: var(--text-main);
}

.action-btn-favorited {
  color: var(--warning) !important;
}

.action-btn-favorited:hover {
  background: var(--warning-alpha-15) !important;
}

.action-btn-danger {
  color: var(--error);
}

.action-btn-danger:hover {
  background: var(--error-soft);
  color: var(--error);
}

/* 浅色模式：灯箱始终保持暗色风格 */
:root.light-theme .lightbox-bottom {
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --text-tertiary: #64748b;
  --hover-overlay: rgb(255 255 255 / 8%);
  --hover-overlay-subtle: rgb(255 255 255 / 4%);
  --border-subtle: #334155;
  --error: #ef4444;
  --error-soft: rgb(239 68 68 / 15%);
}
</style>
