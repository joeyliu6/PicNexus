<script setup lang="ts">
import { ref, computed } from 'vue';
import { onClickOutside } from '@vueuse/core';
import Button from 'primevue/button';
import type { ServiceType } from '../../../config/types';
import type { LinkFormat } from '../../../utils/linkFormatter';
import { useConfigManager } from '../../../composables/useConfig';
import { SERVICE_DISPLAY_NAMES } from '../../../constants/serviceNames';

const props = defineProps<{
  selectedCount: number;
  visible: boolean;
  availableServices?: ServiceType[];
}>();

const emit = defineEmits<{
  (e: 'copy', format: LinkFormat, serviceId?: ServiceType): void;
  (e: 'export'): void;
  (e: 'delete'): void;
  (e: 'clear-selection'): void;
}>();

const configManager = useConfigManager();

const copyMenuVisible = ref(false);
const copyDropdownRef = ref<HTMLElement | null>(null);
const selectedService = ref<ServiceType | undefined>(undefined);

const hasCustomTemplate = computed(() => !!configManager.config.value.linkOutput?.customTemplate);
const showServiceChips = computed(() => (props.availableServices?.length ?? 0) > 1);

const COPY_FORMATS: { type: LinkFormat; icon: string; label: string; needsCustom?: boolean }[] = [
  { type: 'url', icon: 'pi-link', label: 'URL' },
  { type: 'markdown', icon: 'pi-file-edit', label: 'Markdown' },
  { type: 'html', icon: 'pi-code', label: 'HTML' },
  { type: 'bbcode', icon: 'pi-comment', label: 'BBCode' },
  { type: 'custom', icon: 'pi-pencil', label: '自定义', needsCustom: true },
];

function closeCopyMenu(): void {
  copyMenuVisible.value = false;
  selectedService.value = undefined;
}

function toggleCopyMenu(): void {
  copyMenuVisible.value ? closeCopyMenu() : (copyMenuVisible.value = true);
}

onClickOutside(copyDropdownRef, closeCopyMenu);

function handleServiceSelect(serviceId: ServiceType): void {
  selectedService.value = selectedService.value === serviceId ? undefined : serviceId;
}

function handleCopy(format: LinkFormat): void {
  emit('copy', format, selectedService.value);
  closeCopyMenu();
}
</script>

<template>
  <Transition name="float-bar">
    <div v-if="visible" class="floating-action-bar">
      <div class="fab-content">
        <!-- 选中计数 -->
        <span class="fab-count">
          <i class="pi pi-check-circle"></i>
          {{ selectedCount }}
        </span>

        <div class="fab-divider"></div>

        <!-- 复制链接下拉菜单 -->
        <div class="fab-copy-dropdown" ref="copyDropdownRef">
          <Button
            icon="pi pi-copy"
            text
            size="small"
            class="fab-btn"
            @click.stop="toggleCopyMenu"
            v-tooltip.top="'复制链接'"
          />
          <Transition name="dropdown">
            <div v-if="copyMenuVisible" class="copy-menu">
              <!-- 图床选择芯片（多图床时显示）-->
              <div v-if="showServiceChips" class="service-chips">
                <button
                  v-for="sid in availableServices"
                  :key="sid"
                  class="service-chip"
                  :class="{ active: selectedService === sid }"
                  @click.stop="handleServiceSelect(sid)"
                >
                  {{ SERVICE_DISPLAY_NAMES[sid] || sid }}
                </button>
              </div>
              <div v-if="showServiceChips" class="menu-divider"></div>

              <template v-for="fmt in COPY_FORMATS" :key="fmt.type">
                <button
                  v-if="!fmt.needsCustom || hasCustomTemplate"
                  class="copy-menu-item"
                  @click="handleCopy(fmt.type)"
                >
                  <i class="pi" :class="fmt.icon"></i><span>{{ fmt.label }}</span>
                </button>
              </template>
            </div>
          </Transition>
        </div>

        <!-- 导出 -->
        <Button
          icon="pi pi-download"
          text
          size="small"
          class="fab-btn"
          @click="emit('export')"
          v-tooltip.top="'导出'"
        />

        <!-- 删除 -->
        <Button
          icon="pi pi-trash"
          severity="danger"
          text
          size="small"
          class="fab-btn fab-btn-danger"
          @click="emit('delete')"
          v-tooltip.top="'删除'"
        />

        <div class="fab-divider"></div>

        <!-- 取消选择 -->
        <Button
          icon="pi pi-times"
          text
          rounded
          size="small"
          class="fab-close"
          @click="emit('clear-selection')"
          v-tooltip.top="'取消选择'"
        />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.floating-action-bar {
  position: fixed;
  bottom: 70px;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-overlay);
  background: rgba(26, 26, 30, 0.9);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  box-shadow: var(--shadow-float), 0 -1px 0 rgba(255, 255, 255, 0.05) inset;
  padding: 8px 16px;
}

:root.light-theme .floating-action-bar {
  background: rgba(255, 255, 255, 0.95);
  box-shadow: var(--shadow-float), 0 1px 0 rgba(0, 0, 0, 0.03) inset;
}

.fab-content {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fab-count {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  padding: 6px 12px;
  background: var(--primary-alpha-10);
  border-radius: 12px;
  white-space: nowrap;
}

.fab-count i {
  font-size: 14px;
}

.fab-divider {
  width: 1px;
  height: 24px;
  background: var(--border-subtle);
  margin: 0 4px;
}

.fab-btn {
  font-size: 13px !important;
  padding: 6px 12px !important;
  border-radius: 8px !important;
}

.fab-btn-danger:hover {
  color: var(--error) !important;
  background: var(--error-alpha-10) !important;
}

.fab-close {
  width: 32px !important;
  height: 32px !important;
  color: var(--text-secondary) !important;
}

.fab-close:hover {
  color: var(--text-primary) !important;
  background: var(--hover-overlay) !important;
}

/* 浮动栏进入/退出动画 */
.float-bar-enter-active,
.float-bar-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.float-bar-enter-from,
.float-bar-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px);
}

.fab-copy-dropdown {
  position: relative;
}

.copy-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  box-shadow: var(--shadow-float);
  padding: 6px;
  min-width: 160px;
  z-index: var(--z-modal);
}

/* 图床芯片选择 */
.service-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
}

.service-chip {
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.service-chip:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.service-chip.active {
  background: var(--primary-alpha-15);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 500;
}

.menu-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 4px 8px;
}

.copy-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.copy-menu-item:hover {
  background: var(--hover-overlay);
  color: var(--primary);
}

.copy-menu-item i {
  font-size: 14px;
  color: var(--text-secondary);
  width: 16px;
  text-align: center;
}

.copy-menu-item:hover i {
  color: var(--primary);
}

/* 下拉菜单动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* 响应式：窄屏幕隐藏按钮文字 */
@media (max-width: 600px) {
  .fab-btn :deep(.p-button-label) {
    display: none;
  }

  .floating-action-bar {
    padding: 8px 12px;
  }
}
</style>
