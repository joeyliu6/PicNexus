<script setup lang="ts">
import { computed, ref } from 'vue';
import { onClickOutside, useElementBounding } from '@vueuse/core';
import Button from 'primevue/button';
import type { ServerServiceType } from '../../config/types';

interface ServiceOption {
  value: ServerServiceType;
  label: string;
}

interface Props {
  modelValue: ServerServiceType | null;
  configuredServices: ServiceOption[];
  healthStatusMap: Record<string, string>;
  healthTooltipMap: Record<string, string>;
  cliUnsupportedServices: Set<ServerServiceType>;
  serviceLabelMap: Record<ServerServiceType, string>;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: ServerServiceType | null];
  'navigateHosting': [];
}>();

const popoverOpen = ref(false);
const selectorRef = ref<HTMLElement | null>(null);

const { top: selectorTop, bottom: selectorBottom } = useElementBounding(selectorRef);
onClickOutside(selectorRef, () => { popoverOpen.value = false; });

const dropdownUpward = computed(() => {
  const spaceBelow = window.innerHeight - selectorBottom.value;
  const spaceAbove = selectorTop.value;
  return spaceBelow < 220 && spaceAbove > spaceBelow;
});

function getServiceLabel(service: ServerServiceType): string {
  return props.serviceLabelMap[service] || service;
}

function selectService(svc: ServerServiceType | null) {
  emit('update:modelValue', svc);
  popoverOpen.value = false;
}
</script>

<template>
  <div ref="selectorRef" class="service-selector" :class="{ 'is-upward': dropdownUpward }">
    <button
      class="service-trigger"
      v-tooltip.top="modelValue ? getServiceLabel(modelValue) : null"
      @click.stop="popoverOpen = !popoverOpen"
    >
      <span
        v-if="modelValue"
        class="status-dot"
        :class="healthStatusMap[modelValue]"
        v-tooltip.top="healthTooltipMap[modelValue]"
      />
      <span v-else class="status-dot-placeholder" />
      <span class="service-trigger-name">
        {{ modelValue ? getServiceLabel(modelValue) : '请选择图床' }}
      </span>
      <i class="pi pi-chevron-down service-trigger-chevron" />
    </button>

    <Transition name="dropdown">
      <div v-if="popoverOpen" class="service-dropdown" :class="{ upward: dropdownUpward }">
        <button
          v-for="svc in configuredServices"
          :key="svc.value"
          class="service-item"
          :class="{
            active: modelValue === svc.value,
            disabled: cliUnsupportedServices.has(svc.value),
          }"
          v-tooltip.top="cliUnsupportedServices.has(svc.value)
            ? '该图床不支持外部编辑器模式（需要浏览器自动化）'
            : (healthTooltipMap[svc.value] || null)"
          @click="!cliUnsupportedServices.has(svc.value) && selectService(svc.value)"
        >
          <span
            class="status-dot"
            :class="cliUnsupportedServices.has(svc.value) ? '' : (healthStatusMap[svc.value] || '')"
          />
          <span>{{ svc.label }}</span>
        </button>

        <div v-if="configuredServices.length === 0" class="service-empty">
          <i class="pi pi-box service-empty-icon" />
          <span class="service-empty-title">暂无可用图床</span>
          <span class="service-empty-desc">需要先在「图床设置」中配置并验证至少一个图床</span>
          <Button
            text
            size="small"
            icon="pi pi-arrow-right"
            label="前往图床设置"
            @click="popoverOpen = false; emit('navigateHosting')"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

.service-selector {
  position: relative;
  flex-shrink: 0;
  width: 110px;
}

.service-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-main);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.service-trigger:hover {
  background: var(--hover-overlay-subtle);
  border-color: var(--primary-alpha-30);
}

.service-trigger-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-trigger-chevron {
  font-size: 10px;
  color: var(--text-muted);
}

.service-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  bottom: auto;
  z-index: var(--z-dropdown);
  min-width: 220px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  box-shadow: var(--shadow-float);
  padding: 4px 0;
  overflow: hidden;
}

.service-dropdown.upward {
  top: auto;
  bottom: calc(100% + 6px);
}

.is-upward .dropdown-enter-from,
.is-upward .dropdown-leave-to {
  transform: translateY(8px);
}

.service-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border: none;
  background: transparent;
  color: var(--text-main);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background 0.1s;
}

.service-item:hover:not(.disabled) {
  background: var(--hover-overlay);
}

.service-item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.service-item.active {
  background: var(--primary-alpha-10);
  color: var(--primary);
}

.service-empty {
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
}

.service-empty-icon {
  font-size: 24px;
  color: var(--text-muted);
  opacity: 0.5;
  margin-bottom: 4px;
}

.service-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.service-empty-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  max-width: 200px;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.status-dot.configured,
.status-dot.verified {
  background: var(--success);
  box-shadow: 0 0 6px var(--success-border);
}

.status-dot.pending {
  background: var(--warning);
  box-shadow: 0 0 6px var(--warning-border);
}

.status-dot.error {
  background: var(--error);
  box-shadow: 0 0 6px var(--error-border);
}

.status-dot-placeholder {
  display: inline-block;
  width: 7px;
  height: 7px;
  flex-shrink: 0;
}

@media (max-width: 760px) {
  .service-selector {
    width: 100%;
  }

  .service-trigger {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
