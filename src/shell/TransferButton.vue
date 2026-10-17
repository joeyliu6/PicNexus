<script setup lang="ts">
// 标题栏的传输图标（HomeScreen.dc.html）：有进行中的任务时出现，进度环 + 数字（还在传的张数，补充备份、链接检测各算一项）；点开传输中心
import { useTransferCenter } from './useTransferCenter';

const transfer = useTransferCenter();
</script>

<template>
  <button
    v-if="transfer.activeCount.value > 0 || transfer.open.value"
    type="button"
    class="transfer-button"
    :class="{ 'transfer-button--open': transfer.open.value }"
    aria-label="传输中心"
    title="传输中心"
    @click="transfer.toggle()"
  >
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" class="transfer-button__track" stroke-width="2" />
      <circle cx="8" cy="8" r="6" fill="none" class="transfer-button__ring" stroke-width="2" stroke-linecap="round" transform="rotate(-90 8 8)" :stroke-dasharray="transfer.ringDash.value" />
    </svg>
    <span v-if="transfer.activeCount.value > 0">{{ transfer.activeCount.value }}</span>
  </button>
</template>

<style scoped>
.transfer-button {
  display: flex;
  flex: none;
  align-items: center;
  align-self: center;
  gap: var(--pn-space-6);
  height: var(--pn-size-button-sm);
  margin-right: var(--pn-space-6);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-brand-text);
  font: inherit;
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
  cursor: pointer;
}

.transfer-button:hover,
.transfer-button--open { background: var(--pn-selected); }

.transfer-button__track { stroke: var(--pn-track); }
.transfer-button__ring { stroke: var(--pn-brand); transition: stroke-dasharray var(--pn-dur-standard) var(--pn-ease-in); }
</style>
