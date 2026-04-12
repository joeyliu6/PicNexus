<script setup lang="ts">
import { ref, computed } from 'vue';
import { onClickOutside } from '@vueuse/core';
import Button from 'primevue/button';
import type { LinkFormat } from '../../../utils/linkFormatter';
import { useConfigManager } from '../../../composables/useConfig';
import { getServiceDisplayName } from '../../../constants/serviceNames';

const props = defineProps<{
  selectedCount: number;
  visible: boolean;
  availableServices?: string[];
}>();

const emit = defineEmits<{
  (e: 'copy', format: LinkFormat, serviceId?: string): void;
  (e: 'export'): void;
  (e: 'delete'): void;
  (e: 'clear-selection'): void;
  (e: 'batch-favorite', favorited: boolean): void;
}>();

const configManager = useConfigManager();

const copyMenuVisible = ref(false);
const copyDropdownRef = ref<HTMLElement | null>(null);
const selectedService = ref<string | undefined>(undefined);

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
  if (copyMenuVisible.value) {
    closeCopyMenu();
  } else {
    copyMenuVisible.value = true;
  }
}

onClickOutside(copyDropdownRef, closeCopyMenu);

function handleServiceSelect(serviceId: string): void {
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

        <!-- 收藏 -->
        <Button
          icon="pi pi-star"
          text
          size="small"
          class="fab-btn"
          @click="emit('batch-favorite', true)"
          v-tooltip.top="'收藏'"
        />

        <!-- 取消收藏 -->
        <Button
          icon="pi pi-star-fill"
          text
          size="small"
          class="fab-btn fab-btn-unfavorite"
          @click="emit('batch-favorite', false)"
          v-tooltip.top="'取消收藏'"
        />

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
                  {{ getServiceDisplayName(sid) }}
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
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 深色毛玻璃底色，无对应 CSS 变量 */
  background: rgb(26 26 30 / 90%);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-2xl);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 内阴影高光含 rgb 色值 */
  box-shadow: var(--shadow-float), 0 -1px 0 rgb(255 255 255 / 5%) inset;
  padding: var(--space-sm) var(--space-lg);
}

:root.light-theme .floating-action-bar {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 亮色毛玻璃底色，无对应 CSS 变量 */
  background: rgb(255 255 255 / 95%);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 内阴影高光含 rgb 色值 */
  box-shadow: var(--shadow-float), 0 1px 0 rgb(0 0 0 / 3%) inset;
}

.fab-content {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.fab-count {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--primary);
  padding: var(--space-xs-sm) var(--space-md);
  background: var(--primary-alpha-10);
  border-radius: var(--radius-lg);
  white-space: nowrap;
}

.fab-count i {
  font-size: var(--text-base);
}

.fab-divider {
  width: 1px;
  height: 24px;
  background: var(--border-subtle);
  margin: 0 var(--space-xs);
}

.fab-btn {
  font-size: var(--text-sm) !important;
  padding: var(--space-xs-sm) var(--space-md) !important;
  border-radius: var(--radius-md) !important;
}

.fab-btn-unfavorite {
  color: var(--warning) !important;
}

.fab-btn-unfavorite:hover {
  background: var(--warning-alpha-15) !important;
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
  transition: all var(--duration-medium) var(--ease-standard);
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
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-float);
  padding: var(--space-xs-sm);
  min-width: 160px;
  z-index: var(--z-modal);
}

/* 图床芯片选择 */
.service-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  padding: var(--space-xs-sm) var(--space-sm);
}

.service-chip {
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--radius-sm-md);
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
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
  font-weight: var(--weight-medium);
}

.menu-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: var(--space-xs) var(--space-sm);
}

.copy-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm-md);
  width: 100%;
  padding: var(--space-sm-md) var(--space-md-lg);
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast) ease;
  text-align: left;
}

.copy-menu-item:hover {
  background: var(--hover-overlay);
  color: var(--primary);
}

.copy-menu-item i {
  font-size: var(--text-base);
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
  transition: all var(--duration-normal) var(--ease-standard);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* 响应式：窄屏幕隐藏按钮文字 */
@media (width <= 600px) {
  .fab-btn :deep(.p-button-label) {
    display: none;
  }

  .floating-action-bar {
    padding: var(--space-sm) var(--space-md);
  }
}
</style>
