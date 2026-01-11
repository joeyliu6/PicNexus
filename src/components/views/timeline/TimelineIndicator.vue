<script setup lang="ts">
/**
 * 时间轴指示器组件
 * 特性：年份标签、密度轨道、拖拽气泡、可见区域指示
 */
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { TimePeriodStats } from '../../../composables/useHistory';

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

const props = withDefaults(defineProps<{
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
  /** 是否显示密度指示 */
  showDensity?: boolean;
  /** 基于布局高度的月份位置映射（用于精确定位） */
  monthLayoutPositions?: Map<string, { start: number; end: number }>;
}>(), {
  showDensity: true,
});

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
 * 计算最大月份照片数（用于密度标准化）
 */
const maxMonthCount = computed(() => {
  if (props.periods.length === 0) return 1;
  return Math.max(...props.periods.map(p => p.count), 1);
});

/**
 * 计算总照片数
 */
const totalCount = computed(() => {
  return props.periods.reduce((sum, p) => sum + p.count, 0);
});

/**
 * 生成月份区段数据
 * 优先使用布局高度位置，fallback 到数量位置
 */
const monthSegments = computed<MonthSegment[]>(() => {
  if (props.periods.length === 0 || totalCount.value === 0) return [];

  let cumulative = 0;
  const segments: MonthSegment[] = [];

  for (const period of props.periods) {
    const monthKey = `${period.year}-${period.month}`;
    const density = Math.ceil((period.count / maxMonthCount.value) * 5);

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
      density: Math.max(1, Math.min(5, density)),
      count: period.count,
      isLoaded: props.loadedMonths?.has(monthKey) ?? true,
    });

    cumulative += period.count;
  }

  return segments;
});

/**
 * 生成年份区段数据
 */
const yearSections = computed<YearSection[]>(() => {
  if (monthSegments.value.length === 0) return [];

  const sections: YearSection[] = [];
  let currentYear: number | null = null;
  let sectionStart = 0;
  let sectionCount = 0;

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
          labelPosition: sectionStart,
        });
      }

      // 开始新的年份区段
      currentYear = segment.year;
      sectionStart = segment.position;
      sectionCount = segment.count;
    } else {
      sectionCount += segment.count;
    }
  }

  // 添加最后一个年份区段
  if (currentYear !== null) {
    sections.push({
      year: currentYear,
      startPosition: sectionStart,
      endPosition: 1,
      totalCount: sectionCount,
      labelPosition: sectionStart,
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
 * 1. 最新的一年不显示（用户刚进入时就在这里，不需要标签）
 * 2. 最老的一年必须显示（让用户知道时间轴边界）
 * 3. 最近5年必须显示（用户最常浏览的区域）
 * 4. 其他年份应用空间优先规则（间距 >= MIN_LABEL_GAP_PX）
 */
const visibleYearSections = computed<YearSection[]>(() => {
  const sections = yearSections.value;
  const height = containerHeight.value;

  if (sections.length === 0) return [];

  // 容器高度未知时，应用基本规则（跳过第一个）
  if (height <= 0) {
    return sections.slice(1);
  }

  const visible: YearSection[] = [];
  let lastPixelPosition = -Infinity;

  // 当前年份，用于判断"最近5年"
  const currentYear = new Date().getFullYear();

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const pixelPosition = section.labelPosition * height;

    const isFirst = i === 0; // 最新的年份
    const isLast = i === sections.length - 1; // 最老的年份
    const isRecentFiveYears = section.year >= currentYear - 4; // 最近5年

    // 规则1：最新的一年不显示
    if (isFirst) continue;

    // 规则2 & 3：最老的一年 或 最近5年 必须显示
    const mustShow = isLast || isRecentFiveYears;

    if (mustShow) {
      // 强制显示，但更新位置以影响后续判断
      visible.push(section);
      lastPixelPosition = pixelPosition;
    } else {
      // 规则4：其他年份应用空间优先规则
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
 * 获取密度对应的宽度
 */
function getDensityWidth(density: number): string {
  const widths = ['2px', '3px', '4px', '5px', '6px'];
  return widths[Math.min(density - 1, 4)];
}

/**
 * 获取密度对应的透明度
 */
function getDensityOpacity(density: number): number {
  return 0.3 + (density / 5) * 0.5;
}

/**
 * 格式化月份
 */
function formatMonth(month: number): string {
  const months = ['1月', '2月', '3月', '4月', '5月', '6月',
                  '7月', '8月', '9月', '10月', '11月', '12月'];
  return months[month] || '';
}

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
let dragStartY = 0;
let dragStartProgress = 0;

function startDrag(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();

  isDragging.value = true;
  dragStartY = e.clientY;
  dragStartProgress = hoverPosition.value ?? props.scrollProgress;

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

      <!-- 密度指示条 -->
      <div
        v-for="segment in monthSegments"
        :key="segment.id"
        class="density-segment"
        :class="{
          loaded: segment.isLoaded,
          unloaded: !segment.isLoaded
        }"
        :style="{
          top: `${segment.position * 100}%`,
          width: showDensity ? getDensityWidth(segment.density) : '3px',
          opacity: getDensityOpacity(segment.density),
        }"
        :title="`${segment.year}年${segment.month + 1}月 (${segment.count}张)`"
      />

      <!-- 年份分隔线 -->
      <div
        v-for="section in yearSections"
        :key="`sep-${section.year}`"
        class="year-separator"
        :style="{ top: `${section.startPosition * 100}%` }"
      />
    </div>

    <!-- 滑块/指示器 -->
    <div
      class="scrubber"
      :class="{ active: showBubble }"
      :style="scrubberStyle"
      @mousedown="startDrag"
    >
      <!-- 滑块把手 -->
      <div class="scrubber-handle">
        <div class="handle-line"></div>
      </div>

      <!-- 日期气泡 -->
      <Transition name="bubble-fade">
        <div v-if="showBubble" class="scrubber-bubble">
          <span class="bubble-year">{{ currentDateInfo.year }}</span>
          <span class="bubble-month">{{ formatMonth(currentDateInfo.month) }}</span>
        </div>
      </Transition>
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
  cursor: pointer;
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
  transform: translateY(-50%);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  opacity: 0.6;
  transition: all 0.2s ease;
  pointer-events: auto;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
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

/* 密度区段 */
.density-segment {
  position: absolute;
  height: 3px;
  border-radius: 2px;
  background: var(--primary);
  transform: translateY(-50%);
  transition: width 0.2s, opacity 0.2s;
}

.density-segment.unloaded {
  background: transparent;
  border: 1px solid var(--text-secondary);
  opacity: 0.3 !important;
}

.timeline-indicator:hover .density-segment {
  opacity: 0.8 !important;
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

.scrubber {
  position: absolute;
  right: 8px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  flex-direction: row-reverse;
  gap: 8px;
  z-index: 10;
  cursor: grab;
  transition: transform 0.1s ease-out;
}

.scrubber:active,
.timeline-indicator.is-dragging .scrubber {
  cursor: grabbing;
}

/* 滑块把手 */
.scrubber-handle {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
  transition: transform 0.2s, box-shadow 0.2s;
}

.handle-line {
  width: 8px;
  height: 2px;
  background: white;
  border-radius: 1px;
}

.scrubber.active .scrubber-handle,
.scrubber:hover .scrubber-handle {
  transform: scale(1.15);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
}

.timeline-indicator.is-dragging .scrubber-handle {
  transform: scale(1.25);
  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.5);
}

/* 日期气泡 */
.scrubber-bubble {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding: 10px 14px;
  background: var(--bg-elevated);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  min-width: 72px;
}

.bubble-year {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.bubble-month {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-top: 2px;
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

/* ==================== 可见区域指示器 ==================== */

.visible-indicator {
  position: absolute;
  right: 14px;
  width: 4px;
  background: var(--primary);
  border-radius: 2px;
  opacity: 0.15;
  pointer-events: none;
  min-height: 20px;
}

.timeline-indicator:hover .visible-indicator {
  opacity: 0.25;
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

  .scrubber-bubble {
    display: none;
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
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

:root.dark-theme .year-separator,
.dark-theme .year-separator {
  opacity: 0.3;
}
</style>
