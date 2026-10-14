<script setup lang="ts">
// 链接检测列表的单行：缩略图 + 文件名 / 图床 + 后果提示 + 白话状态 + 悬停操作
import { computed } from 'vue';
import type { LinkCheckRow } from '@/types/linkCheck';
import type { CopyHint } from '@/composables/link-check/rowCopies';
import { statusTone, statusTooltip, statusWord } from '@/composables/link-check/useLinkStatusDisplay';
import { getServiceDisplayName } from '@/constants/serviceNames';
import ServiceLogo from '@/components/common/ServiceLogo.vue';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';

const props = defineProps<{
  row: LinkCheckRow;
  selected: boolean;
  disabled: boolean;
  copied: boolean;
  fading: boolean;
  leaving: boolean;
  thumbSrcs: string[];
  hint: CopyHint | null;
  confirmedHttpHosts?: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  (e: 'toggle-select', event: MouseEvent): void;
  (e: 'copy-url'): void;
  (e: 'recheck'): void;
  (e: 'delete'): void;
}>();

const result = computed(() => props.row.recheckResult ?? props.row.checkResult);
const tone = computed(() => statusTone(result.value));
const word = computed(() => statusWord(result.value));
const tooltip = computed(() => statusTooltip(result.value) || null);
const serviceName = computed(() => getServiceDisplayName(props.row.serviceId));
const recheckTone = computed(() => (props.row.recheckResult ? statusTone(props.row.recheckResult) : null));
</script>

<template>
  <div
    class="link-row"
    :class="{
      'row-selected': selected,
      'fading-out': fading,
      'leaving-unchecked': leaving,
    }"
    @click="!disabled && emit('toggle-select', $event)"
  >
    <div class="row-thumb">
      <ThumbnailImage
        :srcs="thumbSrcs"
        :alt="row.fileName"
        image-class="row-thumb-img"
        :confirmed-http-hosts="confirmedHttpHosts"
      >
        <template #placeholder>
          <i class="pi pi-image row-thumb-placeholder" aria-hidden="true"></i>
        </template>
      </ThumbnailImage>
    </div>

    <div class="row-main">
      <span class="link-filename" :class="{ 'filename-selected': selected }">{{ row.fileName }}</span>
      <span class="row-meta">
        <span
          v-tooltip.top="copied ? '已复制' : `${serviceName} · 点击复制链接`"
          class="service-badge"
          :class="{ 'is-copied': copied }"
          @click.stop="emit('copy-url')"
        >
          <i v-if="copied" class="pi pi-check badge-icon copied-check" aria-hidden="true"></i>
          <ServiceLogo v-else :service-id="row.serviceId" class="badge-icon" />
          <span class="badge-label">{{ serviceName }}</span>
        </span>
        <span
          v-if="row.isPrimary"
          v-tooltip.top="'复制出去、写进文档的就是这条链接'"
          class="primary-tag"
        >主链接</span>
      </span>
    </div>

    <span
      v-if="hint"
      v-tooltip.top="hint.tooltip"
      class="copy-hint"
      :class="`copy-hint--${hint.tone}`"
    >
      <i :class="hint.tone === 'ok' ? 'pi pi-shield' : 'pi pi-exclamation-circle'" aria-hidden="true"></i>
      {{ hint.text }}
    </span>

    <span v-tooltip.top="tooltip" class="status-pill" :class="`status-pill--${tone}`">
      <span class="status-dot" aria-hidden="true"></span>{{ word }}
    </span>

    <div class="row-actions" :class="{ 'is-pinned': row.recheckLoading || row.recheckResult }">
      <span
        v-if="row.recheckResult"
        v-tooltip.top="`重检完成：${statusWord(row.recheckResult)}`"
        class="recheck-result-badge"
        :class="{
          'badge-fading': row.recheckBadgeFading,
          'badge-valid': recheckTone === 'ok',
          'badge-invalid': recheckTone === 'error',
          'badge-timeout': recheckTone === 'warning',
          'badge-suspicious': recheckTone === 'suspicious',
        }"
      >
        <i :class="recheckTone === 'ok' ? 'pi pi-check' : 'pi pi-times'" aria-hidden="true"></i>
      </span>
      <button
        v-else
        class="row-action recheck-btn"
        :class="{ spinning: row.recheckLoading }"
        :disabled="disabled"
        :aria-label="`重新检测 ${row.fileName}`"
        v-tooltip.top="'重新检测'"
        @click.stop="emit('recheck')"
      >
        <i class="pi pi-refresh"></i>
      </button>

      <button
        class="row-action delete-btn"
        :disabled="disabled"
        :aria-label="`删除 ${serviceName} 上的这条链接`"
        v-tooltip.top="'删除这条链接'"
        @click.stop="emit('delete')"
      >
        <i class="pi pi-trash"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.link-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  height: 56px;
  padding: 0 var(--space-md) 0 var(--space-sm);
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background var(--duration-micro);
}

.link-row:hover {
  background: var(--hover-overlay-subtle);
}

.link-row.row-selected {
  background: var(--primary-alpha-8);
}

.link-row.row-selected:hover {
  background: var(--primary-alpha-12);
}

/* 缩略图 */
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

/* 文件名 + 图床 */
.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.link-filename {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-filename.filename-selected {
  color: var(--primary);
}

.row-meta {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  min-width: 0;
}

.service-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  margin-left: calc(var(--space-xs) * -1);
  padding: 0 var(--space-xs);
  border-radius: var(--radius-sm);
  cursor: copy;
  transition: background var(--duration-micro), color var(--duration-fast);
}

.service-badge:hover {
  background: var(--primary-alpha-8);
}

.service-badge.is-copied {
  color: var(--success);
}

.badge-icon {
  width: 12px;
  height: 12px;
  font-size: var(--text-2xs);
  color: var(--text-muted);
  flex-shrink: 0;
}

.service-badge.is-copied .badge-icon,
.copied-check {
  color: var(--success);
}

/* 160px 见 docs/design/tokens.md#service-name-truncation（两行布局下这一行独占，放宽到菜单宽度） */
.badge-label {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.service-badge.is-copied .badge-label {
  color: var(--success);
}

.primary-tag {
  flex-shrink: 0;
  padding: 0 var(--space-xs);
  border-radius: var(--radius-xs-sm);
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
  color: var(--primary);
  background: var(--primary-alpha-8);
  cursor: default;
}

/* 后果提示：图还在不在 */
.copy-hint {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
  font-size: var(--text-xs);
  cursor: default;
}

.copy-hint i {
  font-size: var(--text-xs);
}

.copy-hint--ok {
  color: var(--success);
}

.copy-hint--error {
  color: var(--error);
}

/* 状态药丸：正常的安静，出问题的才着色——让眼睛先落在问题上 */
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

/* 悬停操作 */
.row-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--duration-fast);
}

.link-row:hover .row-actions,
.row-actions:focus-within,
.row-actions.is-pinned {
  opacity: 1;
}

.row-action,
.recheck-result-badge {
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
  flex-shrink: 0;
}

.row-action {
  cursor: pointer;
  transition: background var(--duration-micro), color var(--duration-micro);
}

.recheck-btn:hover:not(:disabled) {
  background: var(--primary-alpha-8);
  color: var(--primary);
}

.delete-btn:hover:not(:disabled) {
  background: var(--error-alpha-10);
  color: var(--error);
}

.row-action:disabled {
  opacity: 0.3;
  cursor: default;
}

.recheck-btn.spinning .pi::before {
  content: '';
  display: block;
  width: 12px;
  height: 12px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1.5px spinner stroke has no exact token */
  border: 1.5px solid currentcolor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: k-spin var(--duration-spinner) linear infinite;
}

.recheck-result-badge {
  cursor: default;
  transition: opacity var(--duration-medium) ease;
}

.recheck-result-badge.badge-fading {
  opacity: 0;
}

.recheck-result-badge.badge-valid {
  color: var(--success);
  background: var(--success-alpha-10);
}

.recheck-result-badge.badge-invalid {
  color: var(--error);
  background: var(--error-alpha-10);
}

.recheck-result-badge.badge-timeout {
  color: var(--warning);
  background: var(--warning-alpha-10);
}

.recheck-result-badge.badge-suspicious {
  color: var(--pending);
  background: var(--pending-alpha-8);
}

/* 离场：删除淡出 / 「未检测」筛选下检测完成后收起 */
.link-row.fading-out,
.link-row.leaving-unchecked {
  opacity: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

.link-row.fading-out {
  transition: opacity var(--duration-medium) ease, height var(--duration-slow) ease;
}

.link-row.leaving-unchecked {
  will-change: opacity, height;
  transition:
    opacity var(--duration-medium) var(--ease-standard),
    height var(--duration-slow) var(--ease-standard) var(--duration-fast);
}
</style>
