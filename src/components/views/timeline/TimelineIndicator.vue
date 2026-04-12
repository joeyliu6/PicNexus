<script setup lang="ts">
/**
 * 时间轴指示器组件
 * 特性：年份标签、密度轨道、拖拽气泡、可见区域指示
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { TimePeriodStats } from '../../../composables/useHistory';
import { filterMonthPoints, type FilteredPoint } from '../../../utils/timelineFilter';
import TimelineYearLabels from './timeline-indicator/TimelineYearLabels.vue';
import TimelineTrack from './timeline-indicator/TimelineTrack.vue';
import TimelineScrubber from './timeline-indicator/TimelineScrubber.vue';

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

/**
 * 气泡"最后一次 hover"的缓存：
 * hover 时更新，hover 离开（hoverPosition=null）时保持最后值。
 * 这样气泡 leave 动画期间仍显示正确的位置和年月，不会瞬移到滚动位置或显示错的年月。
 */
const lastHoverTopPct = ref('0%');
const lastHoverYear = ref(new Date().getFullYear());
const lastHoverMonth = ref(0);

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
 * 根据进度位置匹配对应的年月
 */
function resolveDateInfo(pos: number): { year: number; month: number } {
  const segments = monthSegments.value;
  if (segments.length === 0) {
    return { year: new Date().getFullYear(), month: 0 };
  }
  for (let i = 0; i < segments.length; i++) {
    const segmentEnd = i + 1 < segments.length ? segments[i + 1].position : 1;
    if (pos < segmentEnd) {
      return { year: segments[i].year, month: segments[i].month };
    }
  }
  const last = segments[segments.length - 1];
  return { year: last.year, month: last.month };
}

/**
 * hover 位置变化时更新缓存；null 时保持最后值
 */
watch(hoverPosition, (pos) => {
  if (pos === null) return;
  lastHoverTopPct.value = `${pos * 100}%`;
  const info = resolveDateInfo(pos);
  lastHoverYear.value = info.year;
  lastHoverMonth.value = info.month;
});

/**
 * 气泡显示状态
 */
const showBubble = computed(() => {
  return isDragging.value || isHovering.value;
});

/**
 * 细线位置（始终跟随当前滚动进度，与 hover 完全独立）
 */
const scrollTopStyle = computed(() => `${props.scrollProgress * 100}%`);

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

  const info = resolveDateInfo(hoverPosition.value);
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
    <TimelineYearLabels
      :sections="visibleYearSections"
      :active="isHovering || isDragging"
      @year-click="handleYearClick"
    />

    <!-- 时间轴轨道 -->
    <TimelineTrack
      :filtered-dots="filteredDots"
      :year-sections="yearSections"
      :hovered="isHovering"
    />

    <!-- 滑块容器（细线 + 气泡，state 分离避免 hover 离开时视觉跳跃） -->
    <TimelineScrubber
      :scroll-top="scrollTopStyle"
      :hover-top="lastHoverTopPct"
      :show-bubble="showBubble"
      :year="lastHoverYear"
      :month="lastHoverMonth"
      @drag-start="startDrag"
    />

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

/* ==================== 可见区域指示器（已隐藏） ==================== */

.visible-indicator {
  display: none;
}

/* ==================== 响应式 ==================== */

@media (width <= 1024px) {
  .timeline-indicator {
    width: 52px;
  }
}

@media (width <= 768px) {
  .timeline-indicator {
    width: 40px;
    padding: 16px 4px;
  }
}
</style>
