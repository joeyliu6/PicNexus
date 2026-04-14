<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { onClickOutside } from '@vueuse/core';
import type { LinkFormat } from '../../../utils/linkFormatter';
import { useConfigManager } from '../../../composables/useConfig';
import { getServiceDisplayName } from '../../../constants/serviceNames';

// Hover 交互延迟：进入短延迟防路过误触，离开较长延迟给用户从气泡到面板的缓冲
const HOVER_ENTER_DELAY = 80;
const HOVER_LEAVE_DELAY = 200;

const props = defineProps<{
  selectedCount: number;
  visible: boolean;
  availableServices?: string[];
  allFavorited?: boolean;
}>();

const emit = defineEmits<{
  (e: 'copy', format: LinkFormat, serviceId?: string): void;
  (e: 'export'): void;
  (e: 'delete'): void;
  (e: 'clear-selection'): void;
  (e: 'batch-favorite', favorited: boolean): void;
}>();

const configManager = useConfigManager();

const fabContainerRef = ref<HTMLElement | null>(null);
const panelVisible = ref(false);
const copySubMenuVisible = ref(false);
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

let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function clearHoverTimer(): void {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function handleHoverEnter(): void {
  clearHoverTimer();
  hoverTimer = setTimeout(() => {
    panelVisible.value = true;
    hoverTimer = null;
  }, HOVER_ENTER_DELAY);
}

function handleHoverLeave(): void {
  clearHoverTimer();
  hoverTimer = setTimeout(() => {
    panelVisible.value = false;
    copySubMenuVisible.value = false;
    selectedService.value = undefined;
    hoverTimer = null;
  }, HOVER_LEAVE_DELAY);
}

// 点击气泡作为 hover 的补充（键盘/触屏 fallback）
function togglePanel(): void {
  if (panelVisible.value) {
    closeAll();
  } else {
    clearHoverTimer();
    panelVisible.value = true;
  }
}

function closeAll(): void {
  clearHoverTimer();
  panelVisible.value = false;
  copySubMenuVisible.value = false;
  selectedService.value = undefined;
}

onClickOutside(fabContainerRef, closeAll);

onBeforeUnmount(clearHoverTimer);

function toggleCopySubMenu(): void {
  copySubMenuVisible.value = !copySubMenuVisible.value;
  if (!copySubMenuVisible.value) {
    selectedService.value = undefined;
  }
}

function handleServiceSelect(serviceId: string): void {
  selectedService.value = selectedService.value === serviceId ? undefined : serviceId;
}

function handleCopy(format: LinkFormat): void {
  emit('copy', format, selectedService.value);
  closeAll();
}

function handleFavoriteClick(): void {
  emit('batch-favorite', !props.allFavorited);
  closeAll();
}

function handleExport(): void {
  emit('export');
  closeAll();
}

function handleDelete(): void {
  emit('delete');
  closeAll();
}

function handleClear(): void {
  emit('clear-selection');
}
</script>

<template>
  <Transition name="fab-bubble">
    <div
      v-if="visible"
      ref="fabContainerRef"
      class="fab-container"
      @mouseenter="handleHoverEnter"
      @mouseleave="handleHoverLeave"
    >
      <!-- 操作面板（从气泡上方弹出）-->
      <Transition name="fab-panel">
        <div v-if="panelVisible" class="fab-panel">
          <!-- 收藏切换（单一按钮，根据 allFavorited 决定文案和色彩）-->
          <button
            class="panel-item"
            :class="{ 'panel-item-warn': allFavorited }"
            @click="handleFavoriteClick"
          >
            <i class="pi" :class="allFavorited ? 'pi-star-fill' : 'pi-star'"></i>
            <span>{{ allFavorited ? '取消收藏' : '收藏' }}</span>
          </button>

          <!-- 复制链接（带子菜单）-->
          <button
            class="panel-item"
            :class="{ 'panel-item-active': copySubMenuVisible }"
            @click.stop="toggleCopySubMenu"
          >
            <i class="pi pi-copy"></i>
            <span>复制链接</span>
            <i class="pi pi-chevron-right panel-item-chevron"></i>
          </button>

          <!-- 导出 -->
          <button class="panel-item" @click="handleExport">
            <i class="pi pi-download"></i>
            <span>导出</span>
          </button>

          <!-- 删除 -->
          <button class="panel-item panel-item-danger" @click="handleDelete">
            <i class="pi pi-trash"></i>
            <span>删除</span>
          </button>

          <div class="panel-divider"></div>

          <!-- 取消选择 -->
          <button class="panel-item panel-item-muted" @click="handleClear">
            <i class="pi pi-times"></i>
            <span>取消选择</span>
          </button>

          <!-- 复制链接子菜单（向左展开）-->
          <Transition name="copy-submenu">
            <div v-if="copySubMenuVisible" class="copy-submenu">
              <!-- 图床选择芯片（多图床时显示）-->
              <template v-if="showServiceChips">
                <div class="service-chips">
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
                <div class="panel-divider"></div>
              </template>

              <template v-for="fmt in COPY_FORMATS" :key="fmt.type">
                <button
                  v-if="!fmt.needsCustom || hasCustomTemplate"
                  class="panel-item"
                  @click="handleCopy(fmt.type)"
                >
                  <i class="pi" :class="fmt.icon"></i>
                  <span>{{ fmt.label }}</span>
                </button>
              </template>
            </div>
          </Transition>
        </div>
      </Transition>

      <!-- 气泡触发器：hover 自动展开，click 作为键盘/触屏 fallback -->
      <button
        class="fab-bubble"
        :class="{ active: panelVisible }"
        :aria-expanded="panelVisible"
        aria-label="批量操作菜单"
        @click.stop="togglePanel"
      >
        <i class="pi pi-check-circle"></i>
        <span class="fab-bubble-count">{{ selectedCount }}</span>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.fab-container {
  position: fixed;
  right: var(--space-xl);
  bottom: var(--space-xl);
  z-index: var(--z-overlay);
}

/* ---- 气泡 ---- */
.fab-bubble {
  display: flex;
  align-items: center;
  gap: var(--space-xs-sm);
  padding: var(--space-sm) var(--space-md);
  min-height: 40px;
  background: var(--primary);
  color: var(--text-on-primary);
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  box-shadow: var(--shadow-float);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.fab-bubble:hover {
  transform: translateY(-1px);
}

.fab-bubble.active {
  background: var(--primary-alpha-15);
  color: var(--primary);
  border-color: var(--primary);
}

.fab-bubble i {
  font-size: var(--text-base);
}

.fab-bubble-count {
  line-height: 1;
}

/* ---- 操作面板 ---- */
.fab-panel {
  position: absolute;
  right: 0;
  bottom: calc(100% + var(--space-sm));
  min-width: 180px;
  padding: var(--space-xs-sm);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-float);
}

.panel-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
  padding: var(--space-sm-md) var(--space-md-lg);
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease;
}

.panel-item:hover {
  background: var(--hover-overlay);
}

.panel-item i {
  font-size: var(--text-base);
  color: var(--text-secondary);
  width: 16px;
  text-align: center;
}

.panel-item:hover i {
  color: var(--text-primary);
}

.panel-item-chevron {
  margin-left: auto;
  font-size: var(--text-xs) !important;
}

.panel-item-active {
  background: var(--primary-alpha-8);
  color: var(--primary);
}

.panel-item-active i {
  color: var(--primary);
}

.panel-item-danger {
  color: var(--error);
}

.panel-item-danger i {
  color: var(--error);
}

.panel-item-danger:hover {
  background: var(--error-alpha-10);
}

.panel-item-warn {
  color: var(--warning);
}

.panel-item-warn i {
  color: var(--warning);
}

.panel-item-warn:hover {
  background: var(--warning-alpha-15);
}

.panel-item-muted {
  color: var(--text-secondary);
}

.panel-divider {
  height: 1px;
  margin: var(--space-xs) var(--space-sm);
  background: var(--border-subtle);
}

/* ---- 复制链接子菜单（向左展开） ---- */
.copy-submenu {
  position: absolute;
  top: 0;
  right: calc(100% + var(--space-sm));
  min-width: 180px;
  padding: var(--space-xs-sm);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-float);
}

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
  white-space: nowrap;
  transition: all var(--duration-fast) ease;
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

/* ---- 气泡入场动画 ---- */
.fab-bubble-enter-active,
.fab-bubble-leave-active {
  transition: all var(--duration-medium) var(--ease-standard);
}

.fab-bubble-enter-from,
.fab-bubble-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.9);
}

/* ---- 面板弹出动画（向上弹出，overshoot） ---- */
.fab-panel-enter-active {
  transition: all var(--duration-normal) var(--ease-overshoot);
}

.fab-panel-leave-active {
  transition: all var(--duration-fast) var(--ease-accelerate);
}

.fab-panel-enter-from,
.fab-panel-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.95);
  transform-origin: bottom right;
}

/* ---- 子菜单向左展开动画 ---- */
.copy-submenu-enter-active,
.copy-submenu-leave-active {
  transition: all var(--duration-normal) var(--ease-standard);
}

.copy-submenu-enter-from,
.copy-submenu-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

/* ---- 响应式：窄屏幕收紧间距 ---- */
@media (width <= 600px) {
  .fab-container {
    right: var(--space-md);
    bottom: var(--space-md);
  }

  .fab-panel,
  .copy-submenu {
    min-width: 160px;
  }
}
</style>
