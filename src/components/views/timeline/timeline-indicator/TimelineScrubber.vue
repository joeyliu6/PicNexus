<script setup lang="ts">
/**
 * 时间轴 - 细线指示器 + 日期气泡
 *
 * 细线和气泡是独立的兄弟节点，各自有自己的 top 位置：
 * - 细线 top = scrollTop（始终跟随当前滚动位置）
 * - 气泡 top = hoverTop（跟随最后一次 hover 位置，离开时保持最后值避免跳跃）
 *
 * 按下气泡时把 mousedown 原样抛给父组件，由父组件的 startDrag 接管拖拽监听
 */

defineProps<{
  /** 细线位置，对应当前滚动进度，例如 "42%" */
  scrollTop: string;
  /** 气泡位置，对应最后一次 hover 进度，例如 "30%" */
  hoverTop: string;
  /** 是否显示气泡（hover 或拖拽时） */
  showBubble: boolean;
  /** 气泡显示的年份（对应最后一次 hover 位置） */
  year: number;
  /** 气泡显示的月份（对应最后一次 hover 位置） */
  month: number;
}>();

const emit = defineEmits<{
  (e: 'drag-start', event: MouseEvent): void;
}>();
</script>

<template>
  <div class="scrubber-container">
    <!-- 细线指示器：始终跟随滚动位置 -->
    <div class="scrubber-line" :style="{ top: scrollTop }"></div>

    <!-- 日期气泡：仅 hover/拖拽时显示，位置跟随最后 hover 值 -->
    <Transition name="bubble-fade">
      <div
        v-if="showBubble"
        class="scrubber-bubble-wrap"
        :style="{ top: hoverTop }"
        @mousedown="emit('drag-start', $event)"
      >
        <div class="scrubber-bubble">
          <span class="bubble-date">{{ year }}年{{ month + 1 }}月</span>
          <div class="bubble-indicator"></div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 滑块定位容器（与轨道对齐，紧贴界面右侧边界） */
.scrubber-container {
  position: absolute;
  right: 0;
  top: 24px;
  bottom: 24px;
  pointer-events: none;
}

/* 细线指示器：中心对齐滚动 y 位置 */
.scrubber-line {
  position: absolute;
  right: 0;
  width: 48px;
  height: 1px;
  background: var(--primary);
  transform: translateY(-50%);
  pointer-events: none;
  z-index: 10;
}

/*
 * 气泡包裹层：calc(-100% + 1px) 让气泡底部的蓝条顶边对齐 hover y 位置，
 * 与细线在视觉上的锚点接近一致，hover 切换时蓝线位置平滑过渡
 */
.scrubber-bubble-wrap {
  position: absolute;
  right: 0;
  transform: translateY(calc(-100% + 1px));
  pointer-events: auto;
  cursor: row-resize;
  z-index: 11;
}

/* 日期气泡（磨砂半透白底；仅左上圆角，其余直角，紧贴界面右边界） */
.scrubber-bubble {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: color-mix(in srgb, var(--bg-surface) 72%, transparent);
  backdrop-filter: blur(12px) saturate(160%);
  border-radius: var(--radius-md) 0 0 0;
  box-shadow: 0 2px 8px rgb(0 0 0 / 15%);
  overflow: hidden;
  white-space: nowrap;
}

/* 底部蓝色指示条 */
.bubble-indicator {
  width: 100%;
  height: 1px;
  background: var(--primary);
  flex-shrink: 0;
}

.bubble-date {
  padding: 2px 8px;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
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
  transform: translateY(calc(-100% + 1px)) translateX(12px) scale(0.9);
}

/* ==================== 深色主题适配 ==================== */

.dark-theme .scrubber-bubble,
:root.dark-theme .scrubber-bubble {
  background: color-mix(in srgb, var(--bg-surface) 72%, transparent);
  box-shadow: 0 2px 12px rgb(0 0 0 / 40%);
}

.dark-theme .bubble-date,
:root.dark-theme .bubble-date {
  color: var(--text-primary);
}
</style>
