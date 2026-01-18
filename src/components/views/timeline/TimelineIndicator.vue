<script setup lang="ts">
/**
 * 时间轴指示器组件
 * 特性：年份标签、密度轨道、拖拽气泡、可见区域指示
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { TimePeriodStats } from '../../../composables/useHistory';
import { filterMonthPoints, type FilteredPoint } from '../../../utils/timelineFilter';

// ==================== 类型定义 ====================

/** 年份区段 */
interface YearSection {
  year: number;
  startPosition: number;
  endPosition: number;
  totalCount: number;
  labelPosition: number;
}

/** 月份区段 */
interface MonthSegment {
  id: string;
  year: number;
  month: number;
  position: number;
  density: number;
  count: number;
  isLoaded: boolean;
}

// ==================== Props & Emits ====================

const props = defineProps<{
  /** 时间段统计数据 */
  periods: TimePeriodStats[];
  /** 当前滚动进度 (0-1) */
  scrollProgress: number;
  /** 可见区域比例 (0-1) */
  visibleRatio: number;
  /** 总布局高度 */
  totalHeight: number;
  /** 已加载的月份集合 */
  loadedMonths?: Set<string>;
  /** 基于布局高度的月份位置映射（用于精确定位） */
  monthLayoutPositions?: Map<string, { start: number; end: number }>;
}>();

const emit = defineEmits<{
  (e: 'drag-scroll', progress: number): void;
  (e: 'jump-to-period', year: number, month: number): void;
  (e: 'jump-to-year', year: number): void;
}>();

// ==================== 常量 ====================

/** 年份标签之间的最小像素间距 */
const MIN_LABEL_GAP_PX = 80;

// ==================== Refs ====================

const containerRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const isHovering = ref(false);
const hoverPosition = ref<number | null>(null);
/** 容器可用高度（减去上下 padding） */
const containerHeight = ref(0);

// ResizeObserver 实例
let resizeObserver: ResizeObserver | null = null;

// ==================== Computed ====================

/**
 * 计算总照片数
 */
const totalCount = computed(() => {
  return props.periods.reduce((sum, p) => sum + p.count, 0);
});

/**
 * 生成月份区段数据（用于年份区段计算）
 * 优先使用布局高度位置，fallback 到数量位置
 */
const monthSegments = computed<MonthSegment[]>(() => {
  if (props.periods.length === 0 || totalCount.value === 0) return [];

  let cumulative = 0;
  const segments: MonthSegment[] = [];

  for (const period of props.periods) {
    const monthKey = `${period.year}-${period.month}`;

    // 优先使用布局位置（精确），fallback 到数量位置（估算）
    let position: number;
    if (props.monthLayoutPositions?.has(monthKey)) {
      position = props.monthLayoutPositions.get(monthKey)!.start;
    } else {
      // fallback: 未加载的月份使用数量估算位置
      position = cumulative / totalCount.value;
    }

    segments.push({
      id: monthKey,
      year: period.year,
      month: period.month,
      position,
      density: 1, // 不再使用，保留以兼容类型
      count: period.count,
      isLoaded: props.loadedMonths?.has(monthKey) ?? true,
    });

    cumulative += period.count;
  }

  return segments;
});

/**
 * 过滤后的月份点（Google Photos 风格：智能过滤 + 动态间距）
 */
const filteredDots = computed<FilteredPoint[]>(() => {
  if (props.periods.length === 0 || containerHeight.value <= 0) return [];
  return filterMonthPoints(
    props.periods,
    props.loadedMonths ?? new Set(),
    containerHeight.value
  );
});

/**
 * 生成年份区段数据
 * 数据按时间降序排列（最新在前），所以：
 * - 遍历时先遇到的是该年最新的月份
 * - 最后遇到的是该年最早的月份
 * - labelPosition 应该放在该年最早月份处（即该年区段的末尾位置）
 */
const yearSections = computed<YearSection[]>(() => {
  if (monthSegments.value.length === 0) return [];

  const sections: YearSection[] = [];
  let currentYear: number | null = null;
  let sectionStart = 0;
  let sectionCount = 0;
  let lastSegmentPosition = 0;

  for (let i = 0; i < monthSegments.value.length; i++) {
    const segment = monthSegments.value[i];

    if (segment.year !== currentYear) {
      // 保存上一个年份区段
      if (currentYear !== null) {
        sections.push({
          year: currentYear,
          startPosition: sectionStart,
          endPosition: segment.position,
          totalCount: sectionCount,
          labelPosition: lastSegmentPosition,  // 年份标签放在该年最早月份处
        });
      }

      // 开始新的年份区段
      currentYear = segment.year;
      sectionStart = segment.position;
      sectionCount = segment.count;
    } else {
      sectionCount += segment.count;
    }
    lastSegmentPosition = segment.position;
  }

  // 添加最后一个年份区段（最老的年份）
  if (currentYear !== null) {
    sections.push({
      year: currentYear,
      startPosition: sectionStart,
      endPosition: 1,
      totalCount: sectionCount,
      labelPosition: lastSegmentPosition,  // 年份标签放在该年最早月份处
    });
  }

  return sections;
});

/**
 * 可见的年份标签（空间优先算法 + 特殊规则）
 *
 * 核心思想：标签是"路标"，不是"数据展示"
 *
 * 规则：
 * 1. 最新的一年必须显示（让用户知道时间轴起点）
 * 2. 最老的一年必须显示（让用户知道时间轴边界）
 * 3. 其他年份应用空间优先规则（间距 >= MIN_LABEL_GAP_PX）
 */
const visibleYearSections = computed<YearSection[]>(() => {
  const sections = yearSections.value;
  const height = containerHeight.value;

  if (sections.length === 0) return [];

  // 容器高度未知时，返回所有年份
  if (height <= 0) {
    return sections;
  }

  const visible: YearSection[] = [];
  let lastPixelPosition = -Infinity;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const pixelPosition = section.labelPosition * height;

    const isFirst = i === 0; // 最新的年份
    const isLast = i === sections.length - 1; // 最老的年份

    // 规则1 & 2：最新和最老的年份必须显示
    const mustShow = isFirst || isLast;

    if (mustShow) {
      visible.push(section);
      lastPixelPosition = pixelPosition;
    } else {
      // 规则3：其他年份应用空间优先规则
      if (pixelPosition - lastPixelPosition >= MIN_LABEL_GAP_PX) {
        visible.push(section);
        lastPixelPosition = pixelPosition;
      }
    }
  }

  return visible;
});

/**
 * 当前位置（考虑拖拽和悬停）
 */
const currentPosition = computed(() => {
  if (isDragging.value && hoverPosition.value !== null) {
    return hoverPosition.value;
  }
  if (isHovering.value && hoverPosition.value !== null) {
    return hoverPosition.value;
  }
  return props.scrollProgress;
});

/**
 * 当前日期信息（用于气泡显示）
 */
const currentDateInfo = computed(() => {
  const pos = currentPosition.value;

  // 找到最接近的月份
  let closest = monthSegments.value[0];
  let minDistance = Infinity;

  for (const segment of monthSegments.value) {
    const distance = Math.abs(segment.position - pos);
    if (distance < minDistance) {
      minDistance = distance;
      closest = segment;
    }
  }

  if (!closest) {
    return { year: new Date().getFullYear(), month: 0 };
  }

  return {
    year: closest.year,
    month: closest.month,
  };
});

/**
 * 气泡显示状态
 */
const showBubble = computed(() => {
  return isDragging.value || isHovering.value;
});

/**
 * 滑块样式
 */
const scrubberStyle = computed(() => {
  const pos = currentPosition.value;
  return {
    top: `${pos * 100}%`,
  };
});

// ==================== Methods ====================

/**
 * 计算位置到进度
 */
function positionToProgress(clientY: number): number {
  if (!containerRef.value) return 0;

  const rect = containerRef.value.getBoundingClientRect();
  const padding = 24; // 上下内边距
  const availableHeight = rect.height - padding * 2;
  const y = clientY - rect.top - padding;

  return Math.max(0, Math.min(1, y / availableHeight));
}

// ==================== Event Handlers ====================

function handleMouseEnter() {
  isHovering.value = true;
}

function handleMouseLeave() {
  if (!isDragging.value) {
    isHovering.value = false;
    hoverPosition.value = null;
  }
}

function handleMouseMove(e: MouseEvent) {
  hoverPosition.value = positionToProgress(e.clientY);
}

function handleClick() {
  if (hoverPosition.value === null) return;

  const info = currentDateInfo.value;
  const monthKey = `${info.year}-${info.month}`;
  const isLoaded = props.loadedMonths?.has(monthKey) ?? true;

  if (!isLoaded) {
    emit('jump-to-period', info.year, info.month);
  } else {
    emit('drag-scroll', hoverPosition.value);
  }
}

function handleYearClick(year: number, e: MouseEvent) {
  e.stopPropagation();
  emit('jump-to-year', year);
}

// 拖拽处理
function startDrag(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();

  isDragging.value = true;

  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value || !containerRef.value) return;

  const progress = positionToProgress(e.clientY);
  hoverPosition.value = progress;
  emit('drag-scroll', progress);
}

function stopDrag() {
  isDragging.value = false;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
}

// 滚轮处理
function handleWheel(e: WheelEvent) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.02 : -0.02;
  const newProgress = Math.max(0, Math.min(1, props.scrollProgress + delta));
  emit('drag-scroll', newProgress);
}

// ==================== Lifecycle ====================

onMounted(() => {
  // 初始化容器高度
  updateContainerHeight();

  // 监听容器大小变化
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateContainerHeight();
    });
    resizeObserver.observe(containerRef.value);
  }
});

/** 更新容器可用高度 */
function updateContainerHeight() {
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect();
    const padding = 24; // 上下内边距
    containerHeight.value = rect.height - padding * 2;
  }
}

onUnmounted(() => {
  // 清理 ResizeObserver
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
});
</script>

<template>
  <div
    ref="containerRef"
    class="timeline-indicator"
    :class="{ 'is-dragging': isDragging, 'is-hovering': isHovering }"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
    @mousemove="handleMouseMove"
    @click="handleClick"
    @wheel.prevent="handleWheel"
  >
    <!-- 年份标签列（空间优先：只显示有足够间距的标签） -->
    <div class="year-labels">
      <div
        v-for="section in visibleYearSections"
        :key="section.year"
        class="year-label"
        :style="{ top: `${section.labelPosition * 100}%` }"
        @click="handleYearClick(section.year, $event)"
      >
        {{ section.year }}
      </div>
    </div>

    <!-- 时间轴轨道 -->
    <div class="timeline-track">
      <!-- 轨道背景 -->
      <div class="track-background"></div>

      <!-- 月份点（Google Photos 风格：统一灰色圆点，智能过滤） -->
      <div
        v-for="dot in filteredDots"
        :key="dot.id"
        class="month-dot"
        :style="{ top: `${dot.position * 100}%` }"
        :title="`${dot.label} (${dot.count}张)`"
      />

      <!-- 年份分隔线 -->
      <div
        v-for="section in yearSections"
        :key="`sep-${section.year}`"
        class="year-separator"
        :style="{ top: `${section.startPosition * 100}%` }"
      />
    </div>

    <!-- 滑块容器（与轨道对齐） -->
    <div class="scrubber-container">
      <div
        class="scrubber"
        :class="{ active: showBubble }"
        :style="scrubberStyle"
        @mousedown="startDrag"
      >
        <!-- 默认小圆点（非悬停时显示） -->
        <div v-if="!showBubble" class="scrubber-dot"></div>

        <!-- 日期气泡（底部蓝边样式：悬停/拖拽时显示） -->
        <Transition name="bubble-fade">
          <div v-if="showBubble" class="scrubber-bubble">
            <span class="bubble-date">{{ currentDateInfo.year }}年{{ currentDateInfo.month + 1 }}月</span>
            <div class="bubble-indicator"></div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 可见区域指示器 -->
    <div
      class="visible-indicator"
      :style="{
        top: `${scrollProgress * 100}%`,
        height: `${Math.max(visibleRatio * 100, 3)}%`,
      }"
    />
  </div>
</template>

<style scoped>
.timeline-indicator {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 64px;
  display: flex;
  padding: 24px 8px;
  box-sizing: border-box;
  user-select: none;
  cursor: row-resize;
}

/* ==================== 年份标签 ==================== */

.year-labels {
  position: absolute;
  left: 0;
  top: 24px;
  bottom: 24px;
  width: 36px;
  pointer-events: none;
}

.year-label {
  position: absolute;
  right: 4px;
  transform: translateY(-100%);  /* 标签位于年份底部边界上方 */
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  opacity: 0.6;
  transition: all 0.2s ease;
  pointer-events: auto;
  cursor: pointer;
  padding: 1px 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.6);
}

.year-label:hover {
  opacity: 1;
  color: var(--primary);
  background: var(--bg-hover);
}

.timeline-indicator.is-hovering .year-label,
.timeline-indicator.is-dragging .year-label {
  opacity: 1;
  color: var(--text-primary);
}

/* ==================== 时间轴轨道 ==================== */

.timeline-track {
  position: absolute;
  right: 16px;
  top: 24px;
  bottom: 24px;
  width: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.track-background {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--border-color);
  border-radius: 1px;
  opacity: 0.3;
}

/* 月份点（Google Photos 风格：统一灰色圆点，更小更密集） */
.month-dot {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-secondary);
  opacity: 0.25;
  transform: translateY(-50%);
  transition: opacity 0.2s;
  pointer-events: none;
}

.timeline-indicator:hover .month-dot {
  opacity: 0.4;
}

/* 年份分隔线 */
.year-separator {
  position: absolute;
  right: -4px;
  width: 16px;
  height: 1px;
  background: var(--border-color);
  opacity: 0.5;
}

/* ==================== 滑块/指示器 ==================== */

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
  transition: transform 0.15s ease;
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
  box-shadow: 0 1px 4px rgba(59, 130, 246, 0.3);
}

/* 日期气泡（底部蓝边样式） */
.scrubber-bubble {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
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
  font-size: 13px;
  font-weight: 500;
  color: #202124;
  letter-spacing: 0.1px;
}

/* 气泡动画 */
.bubble-fade-enter-active,
.bubble-fade-leave-active {
  transition: all 0.2s ease;
}

.bubble-fade-enter-from,
.bubble-fade-leave-to {
  opacity: 0;
  transform: translateX(12px) scale(0.9);
}

/* ==================== 可见区域指示器（已隐藏） ==================== */

.visible-indicator {
  display: none;
}

/* ==================== 响应式 ==================== */

@media (max-width: 1024px) {
  .timeline-indicator {
    width: 52px;
  }

  .year-labels {
    width: 28px;
  }

  .year-label {
    font-size: 10px;
  }
}

@media (max-width: 768px) {
  .timeline-indicator {
    width: 40px;
    padding: 16px 4px;
  }

  .year-labels {
    display: none;
  }

  .timeline-track {
    right: 12px;
  }

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

  .year-label {
    opacity: 0.8;
    font-size: 10px;
  }
}

/* ==================== 深色主题适配 ==================== */

:root.dark-theme .scrubber-bubble,
.dark-theme .scrubber-bubble {
  background: var(--bg-surface);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}

:root.dark-theme .bubble-date,
.dark-theme .bubble-date {
  color: var(--text-primary);
}

:root.dark-theme .year-separator,
.dark-theme .year-separator {
  opacity: 0.3;
}

:root.dark-theme .year-label,
.dark-theme .year-label {
  background: rgba(255, 255, 255, 0.15);
}
</style>
