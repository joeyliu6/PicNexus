<script setup lang="ts">
// 文档修复列表的单行：缩略图 + 图片名 / 位置 + 白话状态 + 替换来源（或修复结果）+ 悬停操作
import { computed } from 'vue';
import type { CheckLinkResult, MdBackupLink } from '@/types/linkCheck';
import type { MdImageLinkWithFile } from '@/composables/md-rescue/shared';
import type { FlatRow } from '@/composables/md-rescue/useFlatBrokenRows';
import {
  extractFilenameFromUrl, extractHost, isDefunctHost, statusTone, statusTooltip, statusWord,
} from '@/composables/link-check/useLinkStatusDisplay';
import { getServiceDisplayName } from '@/constants/serviceNames';
import ServiceLogo from '@/components/common/ServiceLogo.vue';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';

/**
 * 会变的字段（检测结果、选中的备份）单独传：imageLinks 里的对象会被原地改写，
 * 只传 link 引用时子组件感知不到（同链接检测的 CheckLinkRow）。
 */
const props = defineProps<{
  link: MdImageLinkWithFile;
  status: FlatRow['status'];
  result: CheckLinkResult | undefined;
  selectedBackup: MdBackupLink | undefined;
  backupCount: number;
  thumbSrcs: string[];
  confirmedHttpHosts?: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  (e: 'choose-backup', event: MouseEvent): void;
  (e: 'copy'): void;
  (e: 'open'): void;
  (e: 'edit'): void;
}>();

const tone = computed(() => (props.status === 'replaced' ? 'ok' : statusTone(props.result)));
const word = computed(() => (props.status === 'replaced' ? '已修复' : statusWord(props.result)));
const tooltip = computed(() => statusTooltip(props.result) || null);
const fileName = computed(() => extractFilenameFromUrl(props.link.url));
const host = computed(() => extractHost(props.link.url));
const backupName = computed(() => (props.selectedBackup ? getServiceDisplayName(props.selectedBackup.serviceId) : ''));
</script>

<template>
  <div class="mr-row" :class="`mr-row--${status}`">
    <div class="mr-thumb">
      <ThumbnailImage
        :srcs="thumbSrcs"
        :alt="link.altText || fileName"
        image-class="mr-thumb-img"
        :confirmed-http-hosts="confirmedHttpHosts"
      >
        <template #placeholder>
          <i class="pi pi-image mr-thumb-placeholder" aria-hidden="true"></i>
        </template>
      </ThumbnailImage>
    </div>

    <div class="mr-main">
      <span class="mr-img-name" v-tooltip.top="link.url">{{ fileName }}</span>
      <span class="mr-meta">
        <span :class="{ 'mr-host--defunct': isDefunctHost(link.url) }">{{ host }}</span>
        <span class="mr-meta-sep" aria-hidden="true">·</span>
        <span>第 {{ link.lineNumber }} 行</span>
      </span>
    </div>

    <span v-tooltip.top="tooltip" class="status-pill" :class="`status-pill--${tone}`">
      <span class="status-dot" aria-hidden="true"></span>{{ word }}
    </span>

    <div class="mr-fix">
      <button
        v-if="status === 'rescuable' && selectedBackup"
        type="button"
        class="mr-backup-chip"
        :aria-label="`替换为 ${backupName}，点击更换`"
        v-tooltip.top="backupCount > 1 ? '点击换一个图床' : '只有这一个可用备份'"
        @click.stop="emit('choose-backup', $event)"
      >
        <i class="pi pi-arrow-right mr-fix-arrow" aria-hidden="true"></i>
        <ServiceLogo :service-id="selectedBackup.serviceId" class="mr-backup-logo" />
        <span class="mr-backup-name">{{ backupName }}</span>
        <i v-if="backupCount > 1" class="pi pi-chevron-down mr-backup-caret" aria-hidden="true"></i>
      </button>
      <span v-else-if="status === 'replaced' && selectedBackup" class="mr-fixed-to">
        <i class="pi pi-check" aria-hidden="true"></i>
        已换成 {{ backupName }}
      </span>
      <span v-else-if="status === 'manual'" class="mr-no-backup" v-tooltip.top="'PicNexus 里没有这张图的可用备份，需要手动替换'">
        无可用备份
      </span>
    </div>

    <div class="mr-row-actions">
      <button type="button" class="mr-row-icon-btn" aria-label="复制原链接" v-tooltip.top="'复制原链接'" @click.stop="emit('copy')">
        <i class="pi pi-copy" />
      </button>
      <button type="button" class="mr-row-icon-btn" aria-label="在浏览器打开原链接" v-tooltip.top="'在浏览器打开'" @click.stop="emit('open')">
        <i class="pi pi-external-link" />
      </button>
      <button
        v-if="status === 'manual'"
        type="button"
        class="mr-row-icon-btn"
        aria-label="用编辑器打开源文件"
        v-tooltip.top="'用编辑器打开源文件'"
        @click.stop="emit('edit')"
      >
        <i class="pi pi-file-edit" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.mr-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 52px;
  padding: 0 var(--space-md);
  transition: background var(--duration-micro);
}

.mr-row:hover {
  background: var(--hover-overlay-subtle);
}

.mr-thumb {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: var(--radius-sm-md);
  overflow: hidden;
  background: var(--bg-input);
  display: flex;
  align-items: center;
  justify-content: center;
}

.mr-thumb :deep(.mr-thumb-img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.mr-thumb-placeholder {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.mr-row--manual .mr-thumb {
  opacity: 0.6;
}

.mr-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.mr-img-name {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mr-meta {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
}

.mr-meta-sep {
  color: var(--text-tertiary);
}

.mr-host--defunct {
  text-decoration: line-through;
}

/* 状态药丸：与链接检测同一套样式口径 */
.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs-sm);
  min-width: 76px;
  height: 22px;
  padding: 0 var(--space-sm);
  flex-shrink: 0;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  cursor: default;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentcolor;
  flex-shrink: 0;
}

.status-pill--ok {
  color: var(--success);
  background: var(--success-alpha-10);
}

.status-pill--unchecked {
  color: var(--text-tertiary);
}

.status-pill--error {
  color: var(--error);
  background: var(--error-alpha-10);
}

.status-pill--warning {
  color: var(--warning);
  background: var(--warning-alpha-10);
}

.status-pill--suspicious {
  color: var(--pending);
  background: var(--pending-alpha-8);
}

/* 替换来源 / 修复结果：固定宽度，让一列箭头对齐 */
.mr-fix {
  width: 168px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.mr-backup-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  max-width: 100%;
  height: 28px;
  padding: 0 var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-main);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: border-color var(--duration-fast), background var(--duration-fast);
}

.mr-backup-chip:hover {
  border-color: var(--primary-alpha-40);
  background: var(--primary-alpha-5);
}

.mr-fix-arrow {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}

.mr-backup-logo {
  width: 14px;
  height: 14px;
  font-size: var(--text-xs);
  flex-shrink: 0;
}

.mr-backup-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mr-backup-caret {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}

.mr-fixed-to {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs-sm);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--success);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mr-no-backup {
  font-size: var(--text-xs);
  color: var(--text-muted);
  cursor: help;
}

.mr-row-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--duration-fast);
}

.mr-row:hover .mr-row-actions,
.mr-row-actions:focus-within {
  opacity: 1;
}

.mr-row-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm-md);
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: background var(--duration-micro), color var(--duration-micro);
}

.mr-row-icon-btn:hover {
  background: var(--primary-alpha-8);
  color: var(--primary);
}
</style>
