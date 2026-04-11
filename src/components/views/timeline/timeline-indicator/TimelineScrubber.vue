<script setup lang="ts">
/**
 * 时间轴 - 滑块 + 日期气泡
 * 展示当前位置指示点；按下时把 mousedown 原样抛给父组件，
 * 由父组件的 startDrag 接管 document 级拖拽监听
 */

defineProps<{
  positionTop: string;  // 例如 "42%"
  showBubble: boolean;
  year: number;
  month: number;
}>();

const emit = defineEmits<{
  (e: 'drag-start', event: MouseEvent): void;
}>();
</script>

<template>
  <div class="scrubber-container">
    <div
      class="scrubber"
      :class="{ active: showBubble }"
      :style="{ top: positionTop }"
      @mousedown="emit('drag-start', $event)"
    >
      <!-- 默认小圆点（非悬停时显示） -->
      <div v-if="!showBubble" class="scrubber-dot"></div>

      <!-- 日期气泡（底部蓝边样式：悬停/拖拽时显示） -->
      <Transition name="bubble-fade">
        <div v-if="showBubble" class="scrubber-bubble">
          <span class="bubble-date">{{ year }}年{{ month + 1 }}月</span>
          <div class="bubble-indicator"></div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/* 滑块定位容器（与轨道对齐） */
.scrubber-container {
  position: absolute;
  right: 8px;
  top: 24px;
  bottom: 24px;
  pointer-events: none;
}

.scrubber {
  position: absolute;
  right: 0;
  pointer-events: auto;
  transform: translateY(-50%);
  z-index: 10;
  cursor: row-resize;
  transition: transform var(--duration-fast) ease;
}

/* 激活状态：蓝色底边对齐鼠标位置 */
.scrubber.active {
  transform: translateY(calc(-100% + 3px));
}

/* 默认小圆点（非悬停时显示） */
.scrubber-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 1px 4px var(--primary-alpha-30);
}

/* 日期气泡（底部蓝边样式） */
.scrubber-bubble {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 15%);
  overflow: hidden;
  white-space: nowrap;
}

/* 底部蓝色指示条 */
.bubble-indicator {
  width: 100%;
  height: 3px;
  background: var(--primary);
  flex-shrink: 0;
}

.bubble-date {
  padding: 4px 8px;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-main);
  letter-spacing: 0.1px;
}

/* 气泡动画 */
.bubble-fade-enter-active,
.bubble-fade-leave-active {
  transition: all var(--duration-normal) ease;
}

.bubble-fade-enter-from,
.bubble-fade-leave-to {
  opacity: 0;
  transform: translateX(12px) scale(0.9);
}

/* ==================== 响应式 ==================== */

@media (width <= 768px) {
  .scrubber-handle {
    width: 16px;
    height: 16px;
  }
}

/* 触摸设备 */
@media (hover: none) {
  .scrubber-handle {
    width: 24px;
    height: 24px;
  }

  .scrubber-bubble {
    display: flex;
  }
}

/* ==================== 深色主题适配 ==================== */

:root.dark-theme .scrubber-bubble,
.dark-theme .scrubber-bubble {
  background: var(--bg-surface);
  box-shadow: 0 2px 12px rgb(0 0 0 / 40%);
}

:root.dark-theme .bubble-date,
.dark-theme .bubble-date {
  color: var(--text-primary);
}
</style>
