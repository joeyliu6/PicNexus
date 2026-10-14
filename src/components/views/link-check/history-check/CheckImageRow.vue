<script setup lang="ts">
/**
 * 链接检测列表里的一行 = 一张图
 *
 * 左边认图（缩略图 + 文件名），中间一句白话说它怎么了，右边只放这一刻最该点的那个按钮
 * （改用备份 / 重试），其余操作收在「⋯」里。各份链接的具体状态在悬停提示里。
 * 行本身是哑组件：说什么、能不能改用，都由父级按最新结果算好传进来。
 */
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
import type { ImageDescription, ImageEntry } from '@/composables/link-check/imageHealth';

defineProps<{
  entry: ImageEntry;
  description: ImageDescription;
  thumbSrcs: string[];
  /** 「改用 X」里的 X；null 时不显示这个按钮 */
  promoteName: string | null;
  canRetry: boolean;
  rechecking: boolean;
  copied: boolean;
  disabled: boolean;
  confirmedHttpHosts?: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  promote: [];
  recheck: [];
  more: [event: MouseEvent];
}>();
</script>

<template>
  <div class="image-row" :class="`image-row--${description.kind}`">
    <div class="row-thumb">
      <ThumbnailImage
        :srcs="thumbSrcs"
        :alt="entry.fileName"
        image-class="row-thumb-img"
        :confirmed-http-hosts="confirmedHttpHosts"
      >
        <template #placeholder>
          <i class="pi pi-image row-thumb-placeholder" aria-hidden="true"></i>
        </template>
      </ThumbnailImage>
    </div>

    <div class="row-main">
      <span class="row-name">{{ entry.fileName }}</span>
      <span v-tooltip.top="description.detail" class="row-status">
        <span class="row-dot" aria-hidden="true"></span>
        <span class="row-status-text">{{ description.text }}</span>
      </span>
    </div>

    <div class="row-actions">
      <span v-if="rechecking" class="row-note">
        <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
        检查中
      </span>
      <span v-else-if="copied" class="row-note row-note--ok">
        <i class="pi pi-check" aria-hidden="true"></i>
        已复制链接
      </span>
      <button
        v-else-if="promoteName"
        type="button"
        class="row-btn row-btn--accent"
        :disabled="disabled"
        v-tooltip.top="`以后复制、插入的都用 ${promoteName} 上的这份；随时可以改回`"
        @click="emit('promote')"
      >
        改用 {{ promoteName }}
      </button>
      <button
        v-else-if="canRetry"
        type="button"
        class="row-btn"
        :disabled="disabled"
        @click="emit('recheck')"
      >
        重试
      </button>

      <button
        type="button"
        class="row-more"
        :aria-label="`${entry.fileName} 的更多操作`"
        @click="emit('more', $event)"
      >
        <i class="pi pi-ellipsis-h" aria-hidden="true"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.image-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  min-height: 56px;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-md);
  transition: background var(--duration-micro);
}

.image-row:hover {
  background: var(--hover-overlay-subtle);
}

.row-thumb {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--radius-sm-md);
  overflow: hidden;
  background: var(--bg-input);
  display: flex;
  align-items: center;
  justify-content: center;
}

.row-thumb :deep(.row-thumb-img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.row-thumb-placeholder {
  font-size: var(--text-base);
  color: var(--text-tertiary);
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.row-name {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-status {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
  cursor: default;
}

.row-status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-tertiary);
}

/* 打不开的两类读主文字色：这是用户最该看的那句 */
.image-row--fixable .row-status,
.image-row--broken .row-status {
  color: var(--text-secondary);
}

.image-row--fixable .row-dot,
.image-row--backup-broken .row-dot {
  background: var(--warning);
}

.image-row--broken .row-dot {
  background: var(--error);
}

.image-row--limited .row-dot {
  background: var(--pending);
}

.image-row--ok .row-dot {
  background: var(--success);
}

.image-row--unchecked .row-status {
  color: var(--text-tertiary);
}

.row-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}

.row-btn {
  height: 26px;
  max-width: 180px;
  padding: 0 var(--space-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast), border-color var(--duration-fast), color var(--duration-fast);
}

.row-btn:hover:not(:disabled) {
  background: var(--hover-overlay);
  color: var(--text-main);
}

.row-btn--accent {
  border-color: var(--primary-alpha-30);
  background: var(--primary-alpha-8);
  color: var(--primary);
}

.row-btn--accent:hover:not(:disabled) {
  background: var(--primary-alpha-15);
  border-color: var(--primary-alpha-50);
  color: var(--primary);
}

.row-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.row-note {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0 var(--space-sm);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.row-note--ok {
  color: var(--success);
}

.row-more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm-md);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--duration-micro), color var(--duration-micro);
}

.row-more:hover,
.row-more:focus-visible {
  background: var(--hover-overlay);
  color: var(--text-main);
}
</style>
