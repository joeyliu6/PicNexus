<script setup lang="ts">
import { ref } from 'vue';
import type { LinkFormat } from '../../../../utils/linkFormatter';
import { useFabCopyFormat } from './useFabCopyFormat';
import CopyFormatPopover from './CopyFormatPopover.vue';

const emit = defineEmits<{
  (e: 'copy', format: LinkFormat): void;
}>();

const { currentDefault, mainButtonLabel, mainButtonTooltip } = useFabCopyFormat();

const popoverRef = ref<InstanceType<typeof CopyFormatPopover> | null>(null);

function handleQuickCopy(): void {
  emit('copy', currentDefault.value);
}

function handleMoreClick(event: Event): void {
  popoverRef.value?.toggle(event);
}

function handlePopoverCopy(format: LinkFormat): void {
  emit('copy', format);
}
</script>

<template>
  <div class="fab-copy-section">
    <div class="fab-copy-row">
      <button
        v-tooltip.top="mainButtonTooltip"
        class="fab-copy-main"
        @click="handleQuickCopy"
      >
        <i class="pi pi-copy" />
        <span class="fab-copy-main-label">{{ mainButtonLabel }}</span>
      </button>
      <button
        class="fab-copy-more"
        aria-label="更多格式"
        @click.stop="handleMoreClick"
      >
        <i class="pi pi-ellipsis-h" />
        <span>更多格式</span>
      </button>
    </div>

    <CopyFormatPopover
      ref="popoverRef"
      @copy="handlePopoverCopy"
    />
  </div>
</template>

<style scoped>
.fab-copy-section {
  display: flex;
  flex-direction: column;
}

.fab-copy-row {
  display: flex;
  align-items: stretch;
  gap: var(--space-xs);
  padding: 0 var(--space-xs-sm);
}

.fab-copy-main {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm-md) var(--space-md);
  border: none;
  border-radius: var(--radius-md);
  background: var(--primary);
  color: var(--text-on-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition:
    filter var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.fab-copy-main:hover {
  filter: brightness(1.08);
}

.fab-copy-main:active {
  transform: scale(0.98);
}

.fab-copy-main i {
  font-size: var(--text-base);
}

.fab-copy-main-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fab-copy-more {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-2xs);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--duration-fast) var(--ease-standard);
}

.fab-copy-more:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-alpha-8);
}

.fab-copy-more i {
  font-size: var(--text-2xs);
}
</style>
