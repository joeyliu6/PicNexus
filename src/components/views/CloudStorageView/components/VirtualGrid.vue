<script setup lang="ts" generic="T">
import { ref, computed, watch, type StyleValue } from 'vue';
import { useVirtualGrid } from '../composables/useVirtualGrid';
import type { VirtualGridConfig } from '../types';

const props = withDefaults(
  defineProps<{
    /** 数据项列表 */
    items: T[];
    /** 项目宽度 */
    itemWidth?: number;
    /** 项目高度 */
    itemHeight?: number;
    /** 间距 */
    gap?: number;
    /** 预渲染行数 */
    overscan?: number;
  }>(),
  {
    itemWidth: 180,
    itemHeight: 200,
    gap: 16,
    overscan: 3,
  }
);

const emit = defineEmits<{
  scrollEnd: [];
}>();

// 容器引用
const containerRef = ref<HTMLElement | null>(null);

// 将 props.items 转换为 ref（用于 composable）
const itemsRef = computed(() => props.items);

// 使用虚拟滚动
const { visibleItems, totalHeight, columns, onScroll, recalculate } = useVirtualGrid({
  items: itemsRef,
  containerRef,
  config: {
    itemWidth: props.itemWidth,
    itemHeight: props.itemHeight,
    gap: props.gap,
    overscan: props.overscan,
  },
});

// 监听滚动到底部
const handleScroll = (e: Event) => {
  onScroll(e);

  const target = e.target as HTMLElement;
  const isAtBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 100;

  if (isAtBottom) {
    emit('scrollEnd');
  }
};

// 内容区域样式
const contentStyle = computed<StyleValue>(() => ({
  height: `${totalHeight.value}px`,
  position: 'relative' as const,
}));

// 暴露方法给父组件
defineExpose({
  recalculate,
  containerRef,
});
</script>

<template>
  <div ref="containerRef" class="virtual-grid-container" @scroll="handleScroll">
    <div class="virtual-grid-content" :style="contentStyle">
      <div
        v-for="{ item, index, style } in visibleItems"
        :key="index"
        class="virtual-grid-item"
        :style="style"
      >
        <slot :item="item" :index="index" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.virtual-grid-container {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

.virtual-grid-content {
  width: 100%;
}

.virtual-grid-item {
  /* 位置由 style 控制 */
}

/* 滚动条样式 */
.virtual-grid-container::-webkit-scrollbar {
  width: 8px;
}

.virtual-grid-container::-webkit-scrollbar-track {
  background: transparent;
}

.virtual-grid-container::-webkit-scrollbar-thumb {
  background: var(--border-subtle);
  border-radius: 4px;
}

.virtual-grid-container::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}
</style>
