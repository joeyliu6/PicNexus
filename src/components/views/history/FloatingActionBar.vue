<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onBeforeUnmount } from 'vue';
import { onClickOutside } from '@vueuse/core';
import type { LinkFormat } from '../../../utils/linkFormatter';
import { useFabCopyFormat } from './fab/useFabCopyFormat';
import FabStatusBar from './fab/FabStatusBar.vue';
import FabCopySection from './fab/FabCopySection.vue';
import FabServiceChips from './fab/FabServiceChips.vue';

// Hover 交互延迟：进入短延迟防路过误触，离开较长延迟给用户从气泡到面板的缓冲
const HOVER_ENTER_DELAY = 80;
const HOVER_LEAVE_DELAY = 450;
const CLICK_GRACE_PERIOD = 300; // hover 打开面板后的点击宽限期，避免习惯性点击误关

const props = defineProps<{
  selectedCount: number;
  visible: boolean;
  availableServices?: { serviceId: string; count: number }[];
  favoriteState?: 'all' | 'partial' | 'none';
}>();

const emit = defineEmits<{
  (e: 'copy', format: LinkFormat, serviceId?: string): void;
  (e: 'export'): void;
  (e: 'delete'): void;
  (e: 'clear-selection'): void;
  (e: 'batch-favorite', favorited: boolean): void;
}>();

const { currentDefault } = useFabCopyFormat();
const currentCopyFormat = ref<LinkFormat>(currentDefault.value);

const fabContainerRef = ref<HTMLElement | null>(null);
const panelVisible = ref(false);

const serviceCount = computed(() => props.availableServices?.length ?? 0);

const deleteLabel = computed(() =>
  props.selectedCount > 0 ? `删除 ${props.selectedCount} 张` : '删除'
);

// 收藏成功的短暂过渡态：收藏后先显示"已收藏"1.5 秒，再切换到"取消收藏"
const isFavoriteSuccess = ref(false);
let favoriteSuccessTimer: ReturnType<typeof setTimeout> | null = null;

// 三态收藏逻辑（MECE：none / partial / all，相互独立，完全穷尽）
const favoriteIconClass = computed(() => {
  // 收藏成功过渡态期间强制显示实心星，避免 DB 异步更新前出现"文字已收藏+空心星"的视觉矛盾
  if (isFavoriteSuccess.value) return 'pi-star-fill';
  return props.favoriteState === 'none' ? 'pi-star' : 'pi-star-fill';
});

const favoriteBtnLabel = computed(() => {
  if (isFavoriteSuccess.value) return '已收藏';
  return props.favoriteState === 'all' ? '取消收藏' :
    props.favoriteState === 'partial' ? '全部收藏' : '收藏';
});
const favoriteBtnClass = computed(() => {
  if (isFavoriteSuccess.value) return { 'panel-item-active': true };
  return {
    'panel-item-warn': props.favoriteState === 'all',
    'panel-item-active': props.favoriteState === 'partial',
  };
});

let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let panelOpenedAt = 0;

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
    panelOpenedAt = Date.now();
    hoverTimer = null;
  }, HOVER_ENTER_DELAY);
}

function handleHoverLeave(): void {
  clearHoverTimer();
  hoverTimer = setTimeout(() => {
    panelVisible.value = false;
    hoverTimer = null;
  }, HOVER_LEAVE_DELAY);
}

function togglePanel(): void {
  if (panelVisible.value) {
    // 面板刚由 hover 打开时，短时间内的点击不关闭，避免习惯性点击误关
    if (Date.now() - panelOpenedAt < CLICK_GRACE_PERIOD) return;
    closePanel();
  } else {
    clearHoverTimer();
    panelVisible.value = true;
    panelOpenedAt = Date.now();
  }
}

function closePanel(): void {
  clearHoverTimer();
  panelVisible.value = false;
}

// Popover 被 Teleport 到 body，必须在 ignore 里排除，否则点 Popover 会关整个面板
onClickOutside(fabContainerRef, closePanel, {
  ignore: ['.cfp-popover'],
});
onBeforeUnmount(clearHoverTimer);

// Esc: 面板开 → 关面板，面板关 → 清选中（Popover 显示时由其自身 capture listener 消费，不触达这里）
function handleKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !props.visible) return;
  e.stopPropagation();
  if (panelVisible.value) panelVisible.value = false;
  else emit('clear-selection');
}

onMounted(() => document.addEventListener('keydown', handleKeydown));
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  if (favoriteSuccessTimer) clearTimeout(favoriteSuccessTimer);
});

function handleCopyFormat(format: LinkFormat): void {
  emit('copy', format, undefined);
}

function handleFormatChange(format: LinkFormat): void {
  currentCopyFormat.value = format;
}

function handleServiceCopy(serviceId: string): void {
  emit('copy', currentCopyFormat.value, serviceId);
}

function handleFavoriteClick(): void {
  const favorited = props.favoriteState !== 'all';
  emit('batch-favorite', favorited);
  if (favorited) {
    // 收藏方向：短暂显示"已收藏"，避免立刻变成"取消收藏"引起困惑
    isFavoriteSuccess.value = true;
    if (favoriteSuccessTimer) clearTimeout(favoriteSuccessTimer);
    favoriteSuccessTimer = setTimeout(() => {
      isFavoriteSuccess.value = false;
      favoriteSuccessTimer = null;
    }, 1500);
  } else {
    // 取消收藏时清除过渡态
    isFavoriteSuccess.value = false;
    if (favoriteSuccessTimer) {
      clearTimeout(favoriteSuccessTimer);
      favoriteSuccessTimer = null;
    }
  }
}

function handleExport(): void {
  emit('export');
  closePanel();
  emit('clear-selection');
}

function handleDelete(): void {
  emit('delete');
  closePanel();
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
          <!-- section 0: 状态栏（× 按钮 = 取消选择）-->
          <FabStatusBar
            :selected-count="selectedCount"
            :service-count="serviceCount"
            @close="handleClear"
          />

          <!-- section 1: 复制链接（主按钮 + 更多格式 Popover 触发器）-->
          <FabCopySection
            :selected-count="selectedCount"
            @copy="handleCopyFormat"
            @format-change="handleFormatChange"
          />

          <!-- section 2: 图床筛选（多图床时显示）-->
          <FabServiceChips
            v-if="availableServices?.length"
            :services="availableServices"
            @copy-service="handleServiceCopy"
          />

          <!-- section 3-5: footer（border-top 与状态栏 border-bottom 对称）-->
          <div class="panel-footer">
            <!-- section 3+4: 收藏 + 导出（并排） -->
            <div class="panel-actions-pair">
              <button
                class="panel-item panel-item-half"
                :class="favoriteBtnClass"
                @click="handleFavoriteClick"
              >
                <i class="pi" :class="favoriteIconClass"></i>
                <span>{{ favoriteBtnLabel }}</span>
              </button>
              <button class="panel-item panel-item-half" @click="handleExport">
                <i class="pi pi-download"></i>
                <span>导出</span>
              </button>
            </div>

            <!-- section 5: 删除（危险隔离，描边按钮）-->
            <div class="panel-delete-wrap">
              <button class="panel-item panel-item-danger panel-item-delete" @click="handleDelete">
                <i class="pi pi-trash"></i>
                <span>{{ deleteLabel }}</span>
              </button>
            </div>
          </div>
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
  min-height: 40px;
  padding: var(--space-sm) var(--space-md);
  background: var(--primary-alpha-10);
  color: var(--primary);
  border: 1px solid var(--primary-alpha-30);
  border-radius: var(--radius-full);
  box-shadow:
    var(--shadow-float),
    0 0 0 3px var(--primary-alpha-5);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  cursor: pointer;
  backdrop-filter: blur(12px);
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    border-color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.fab-bubble:hover {
  background: var(--primary-alpha-15);
  border-color: var(--primary-alpha-40);
  transform: translateY(-1px);
}

.fab-bubble.active {
  background: var(--primary-alpha-15);
  border-color: var(--primary-alpha-40);
  color: var(--primary);
}

.fab-bubble i {
  font-size: var(--text-base);
}

.fab-bubble-count {
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/* ---- 操作面板 ---- */
.fab-panel {
  position: absolute;
  right: 0;
  bottom: calc(100% + var(--space-sm));
  min-width: 280px;
  padding: 0 0 var(--space-xs-sm) 0;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.panel-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin: 0 var(--space-xs-sm);
  padding: var(--space-sm-md) var(--space-md-lg);
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
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

/* warn/danger/active 的图标 hover 保持原色，不受上面通用规则影响 */
.panel-item-warn:hover i {
  color: var(--warning);
}

.panel-item-danger:hover i {
  color: var(--error);
}

.panel-item-active:hover i {
  color: var(--primary);
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

/* ---- 面板弹出动画（向上弹出，overshoot）---- */
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

/* ---- footer 区块（border-top 与状态栏 border-bottom 对称）---- */
.panel-footer {
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding-top: var(--space-xs-sm);
}

/* ---- 收藏 + 导出并排行 ---- */
.panel-actions-pair {
  display: flex;
  gap: var(--space-xs);
  margin: 0 var(--space-xs-sm);
}

.panel-item-half {
  flex: 1;
  justify-content: center;
  margin: 0;
  padding: var(--space-sm);
  background: var(--bg-input);
}

.panel-item-half:hover {
  background: var(--hover-overlay);
}

.panel-item-half.panel-item-warn {
  background: var(--warning-alpha-8);
}

.panel-item-half.panel-item-active {
  background: var(--primary-alpha-8);
}

/* ---- 描边删除按钮 ---- */
.panel-delete-wrap {
  padding: 0 var(--space-xs-sm);
}

.panel-item-delete {
  width: 100%;
  justify-content: center;
  margin: 0;
  border: 1px solid var(--error-border);
  border-radius: var(--radius-md);
}

.panel-item-delete:hover {
  background: var(--error-alpha-10);
  border-color: var(--error);
}

/* ---- 响应式：窄屏幕收紧间距 ---- */
@media (width <= 600px) {
  .fab-container {
    right: var(--space-md);
    bottom: var(--space-md);
  }

  .fab-panel {
    min-width: 0;
    width: min(280px, calc(100vw - 32px));
    box-sizing: border-box;
  }
}
</style>
