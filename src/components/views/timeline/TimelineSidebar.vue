<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from 'vue';

export interface TimeGroup {
  id: string; // unique id (e.g., '2024-5-15')
  label: string; // display label (e.g., '5月')
  year: number;
  month: number;
  day: number;
  date: Date;
  count: number;
}

const props = defineProps<{
  groups: TimeGroup[];
  scrollProgress: number; // 滚动进度 0-1
  visibleRatio: number; // 可见区域比例 0-1
  currentMonthLabel: string; // 当前滚动位置的月份标签
}>();

const emit = defineEmits<{
  (e: 'drag-scroll', progress: number): void;
}>();

// 侧边栏容器引用
const sidebarRef = ref<HTMLElement | null>(null);

// 鼠标悬停位置（0-1），null 表示鼠标不在区域内
const hoverProgress = ref<number | null>(null);

// 页面滚动时，重置悬停状态，让指示器跟随滚动位置
watch(() => props.scrollProgress, () => {
  hoverProgress.value = null;
});

// 计算总照片数
const totalCount = computed(() => {
  return props.groups.reduce((sum, g) => sum + g.count, 0);
});

// 按年分组，并计算每个年份在时间轴上的位置（按照片数量加权）
const years = computed(() => {
  if (props.groups.length === 0 || totalCount.value === 0) return [];

  // 按年份分组并计算每年照片数
  const yearsMap = new Map<number, { groups: TimeGroup[], count: number }>();
  props.groups.forEach(group => {
    if (!yearsMap.has(group.year)) {
      yearsMap.set(group.year, { groups: [], count: 0 });
    }
    const yearData = yearsMap.get(group.year)!;
    yearData.groups.push(group);
    yearData.count += group.count;
  });

  // 计算每个年份的位置和高度（按照片数量加权）
  let cumulativePosition = 0;
  return Array.from(yearsMap.entries())
    .sort((a, b) => b[0] - a[0]) // 年份降序（2025 在上，2024 在下）
    .map(([year, data]) => {
      const weight = data.count / totalCount.value; // 权重 = 该年照片数 / 总照片数
      const startPosition = cumulativePosition;
      cumulativePosition += weight;
      return {
        year,
        // 年份内的月份按时间降序排列（最新月份在上，1月在下）
        groups: data.groups.sort((a, b) => b.date.getTime() - a.date.getTime()),
        count: data.count,
        startPosition,  // 该年份区域的起始位置 (0-1)
        // 年份标签放在区域底部（表示"以上是这一年的内容"）
        labelPosition: cumulativePosition,
        height: weight  // 该年份占据的高度比例 (0-1)
      };
    });
});

// 计算所有日期点的位置（基于 years 结构，确保顺序正确）
const allDots = computed(() => {
  const dots: { id: string; position: number }[] = [];

  for (const yearData of years.value) {
    const groupCount = yearData.groups.length;
    yearData.groups.forEach((group, index) => {
      // 每个点在该年份区域内的位置
      const positionInYear = groupCount > 1 ? index / (groupCount - 1) : 0.5;
      const position = yearData.startPosition + positionInYear * yearData.height;
      dots.push({ id: group.id, position });
    });
  }

  return dots;
});

// 滑块显示的月份（根据加权位置找到对应月份）
const displayMonth = computed(() => {
  if (props.groups.length === 0 || years.value.length === 0) return '';

  const progress = hoverProgress.value ?? props.scrollProgress;

  // 根据进度找到对应的年份
  for (const yearData of years.value) {
    const yearEnd = yearData.startPosition + yearData.height;
    if (progress >= yearData.startPosition && progress < yearEnd) {
      // 在这个年份内，找到对应的月份
      const progressInYear = (progress - yearData.startPosition) / yearData.height;
      const groupIndex = Math.floor(progressInYear * yearData.groups.length);
      const group = yearData.groups[Math.min(groupIndex, yearData.groups.length - 1)];
      return `${group.year}年${group.month + 1}月`;
    }
  }

  // 默认返回最后一个年份的最后一个月
  const lastYear = years.value[years.value.length - 1];
  if (lastYear && lastYear.groups.length > 0) {
    const lastGroup = lastYear.groups[lastYear.groups.length - 1];
    return `${lastGroup.year}年${lastGroup.month + 1}月`;
  }

  return props.currentMonthLabel;
});

// 滑块位置样式（完全填充窗口高度）
const indicatorStyle = computed(() => {
  if (!sidebarRef.value) return {};
  const trackHeight = sidebarRef.value.clientHeight;
  const indicatorHeight = 28; // 指示器高度（紧凑布局）
  const availableHeight = trackHeight - indicatorHeight;

  // 使用悬停位置或滚动位置
  const progress = hoverProgress.value ?? props.scrollProgress;
  const top = (indicatorHeight / 2) + availableHeight * progress;

  return {
    top: `${top}px`
  };
});

// 鼠标移动：滑块跟随鼠标
const handleMouseMove = (e: MouseEvent) => {
  if (!sidebarRef.value) return;
  const rect = sidebarRef.value.getBoundingClientRect();
  const indicatorHeight = 28;
  const y = e.clientY - rect.top - (indicatorHeight / 2);
  const availableHeight = rect.height - indicatorHeight;
  hoverProgress.value = Math.max(0, Math.min(1, y / availableHeight));
};

// 鼠标离开：保持指示器在当前位置（不再回到滚动位置）
const handleMouseLeave = () => {
  // 不再重置 hoverProgress，让指示器保持在当前位置
};

// 点击：跳转到鼠标位置
const handleClick = () => {
  if (hoverProgress.value !== null) {
    emit('drag-scroll', hoverProgress.value);
  }
};

// 拖拽状态（保留拖拽功能）
const isDragging = ref(false);
const dragStartY = ref(0);
const dragStartProgress = ref(0);

const startDrag = (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  isDragging.value = true;
  dragStartY.value = e.clientY;
  dragStartProgress.value = hoverProgress.value ?? props.scrollProgress;
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
};

const onDrag = (e: MouseEvent) => {
  if (!isDragging.value || !sidebarRef.value) return;
  const indicatorHeight = 28;
  const availableHeight = sidebarRef.value.clientHeight - indicatorHeight;
  const deltaY = e.clientY - dragStartY.value;
  const deltaProgress = deltaY / availableHeight;
  const newProgress = Math.max(0, Math.min(1, dragStartProgress.value + deltaProgress));
  hoverProgress.value = newProgress;
  emit('drag-scroll', newProgress);
};

const stopDrag = () => {
  isDragging.value = false;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
};

// 清理事件监听
onUnmounted(() => {
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
});

</script>

<template>
  <div
    class="timeline-sidebar"
    ref="sidebarRef"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
    @click="handleClick"
  >
    <!-- 位置指示器：标签 + 指示线 -->
    <div
      class="position-indicator"
      :class="{ dragging: isDragging, hovering: hoverProgress !== null }"
      :style="indicatorStyle"
      @mousedown="startDrag"
    >
      <div class="indicator-label">
        <span>{{ displayMonth }}</span>
      </div>
      <div class="indicator-line"></div>
    </div>

    <!-- 时间轴轨道（绝对定位，与滚动进度对应） -->
    <div class="timeline-track">
      <!-- 年份标签（放在该年份区域底部） -->
      <div
        v-for="yearData in years"
        :key="yearData.year"
        class="year-label"
        :style="{ top: `${yearData.labelPosition * 100}%` }"
      >
        {{ yearData.year }}
      </div>

      <!-- 日期点（基于 years 结构正确定位） -->
      <div
        v-for="dot in allDots"
        :key="dot.id"
        class="day-dot"
        :style="{ top: `${dot.position * 100}%` }"
      ></div>
    </div>
  </div>
</template>
<style scoped>
.timeline-sidebar {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  overflow: visible;
  user-select: none;
  cursor: pointer;
}


/* 时间轴轨道 - 填满整个高度 */
.timeline-track {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 12px;
  width: 24px;
  pointer-events: none;
}

/* 年份标签 - 绝对定位 */
.year-label {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  opacity: 0.7;
  white-space: nowrap;
}

/* 日期点 - 绝对定位 */
.day-dot {
  position: absolute;
  right: 10px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: var(--text-muted);
  opacity: 0.08;
  transform: translateY(-50%);
  transition: opacity 0.3s ease;
}

.timeline-sidebar:hover .day-dot {
  opacity: 0.25;
}

/* 位置指示器 - 紧贴时间轴右侧 */
.position-indicator {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  cursor: grab;
  z-index: 10;
  pointer-events: auto;
  transition: transform 0.15s ease;
}

.position-indicator:hover,
.position-indicator.hovering {
  cursor: pointer;
}

.position-indicator.dragging {
  cursor: grabbing;
}

/* 月份标签 - 直角矩形 + 蓝色底边框 + 紧凑布局 */
.indicator-label {
  padding: 4px 10px;
  background: var(--bg-app);
  border-bottom: 3px solid var(--primary);
  border-radius: 0;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  transition: box-shadow 0.2s ease;
}

/* 悬浮时加深阴影 */
.position-indicator:hover .indicator-label,
.position-indicator.hovering .indicator-label {
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18);
}

/* 拖拽时的状态 */
.position-indicator.dragging .indicator-label {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
}

/* 隐藏连接线（矩形紧贴时间轴） */
.indicator-line {
  display: none;
}
</style>
