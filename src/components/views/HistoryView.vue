<script setup lang="ts">
/**
 * 历史记录视图入口组件
 * 负责 Dashboard Strip 和视图切换
 */
import { ref, computed, onMounted, onActivated, onDeactivated, watch, nextTick } from 'vue';
import type { ServiceType } from '../../config/types';
import { useHistoryManager } from '../../composables/useHistory';
import HistoryTableView from './history/HistoryTableView.vue';
import TimelineView from './TimelineView.vue';
import FavoritesView from './FavoritesView.vue';
import DashboardStrip, { type ViewMode } from './history/DashboardStrip.vue';
import EmptyState from '../common/EmptyState.vue';
import 'primeicons/primeicons.css';

const historyManager = useHistoryManager();
const serviceCounts = historyManager.serviceCounts;

const currentViewMode = ref<ViewMode>('table');
const currentFilter = ref<ServiceType | 'all'>('all');
const debouncedSearchTerm = ref('');

const totalCount = ref(0);
const activationTrigger = ref(0);

const historyContainerRef = ref<HTMLElement | null>(null);
let savedTableScrollTop = 0;
let statsLoadPromise: Promise<void> | null = null;
const hasStatsBootstrapSettled = ref(historyManager.isStatsLoaded.value);

const hasKnownNoHistory = computed(() =>
  historyManager.isStatsLoaded.value && historyManager.totalCount.value === 0
);
const showParentEmptyState = computed(() =>
  hasStatsBootstrapSettled.value && hasKnownNoHistory.value
);
const shouldMountChildViews = computed(() =>
  hasStatsBootstrapSettled.value && !showParentEmptyState.value
);
const emptyStateIcon = computed(() =>
  currentViewMode.value === 'favorites' ? 'pi pi-star' : 'pi pi-images'
);
const emptyStateTitle = computed(() =>
  currentViewMode.value === 'favorites' ? '暂无收藏' : '暂无上传记录'
);
const emptyStateDescription = computed(() =>
  currentViewMode.value === 'favorites'
    ? '点击图片右上角的 ★ 开始收藏'
    : '上传图片后，历史记录将在这里显示'
);
const useNoPaddingContainer = computed(() =>
  currentViewMode.value !== 'table' && !showParentEmptyState.value
);

async function ensureStatsLoaded(): Promise<void> {
  if (!statsLoadPromise) {
    statsLoadPromise = (async () => {
      try {
        await historyManager.loadStats();
        totalCount.value = historyManager.totalCount.value;
      } catch {
        // loadStats already owns user-facing error reporting.
      } finally {
        hasStatsBootstrapSettled.value = true;
      }
    })().finally(() => {
      statsLoadPromise = null;
    });
  }
  await statsLoadPromise;
}

// KeepAlive 激活时刷新数据（解决上传后切换回来不更新的问题）
// 注意：此处只加载统计数字（totalCount/favoriteSet），全量 metas 由时间轴/收藏视图自行按需加载
onMounted(() => {
  void ensureStatsLoaded();
});

onActivated(async () => {
  // 通知子视图激活状态变化
  activationTrigger.value++;
  await ensureStatsLoaded();
  // 恢复表格滚动位置（数据加载后等 DOM flush 再设置）
  if (currentViewMode.value === 'table' && savedTableScrollTop > 0) {
    await nextTick();
    if (historyContainerRef.value) {
      historyContainerRef.value.scrollTop = savedTableScrollTop;
    }
  }
});

onDeactivated(() => {
  if (currentViewMode.value === 'table') {
    savedTableScrollTop = historyContainerRef.value?.scrollTop ?? savedTableScrollTop;
  }
});

// 同层 v-show 切换（table ↔ timeline）时保存/恢复滚动位置
watch(currentViewMode, async (newMode, oldMode) => {
  if (oldMode === 'table') {
    // v-show 切换前 DOM 尚未隐藏，此时 scrollTop 仍可读
    savedTableScrollTop = historyContainerRef.value?.scrollTop ?? savedTableScrollTop;
  }
  if (newMode === 'table' && savedTableScrollTop > 0) {
    // 等 HistoryTableView display:block 渲染完成，容器高度恢复后再设置
    await nextTick();
    if (historyContainerRef.value) {
      historyContainerRef.value.scrollTop = savedTableScrollTop;
    }
  }
});

// 表格模式下 filter / search 变化前抢先快照 scrollTop：
// 数据变短时浏览器会把 scrollTop clamp 到新 scrollHeight，若等切视图再读已是被 clamp 值，
// 回到表格时恢复到截断位而非用户原先 5000px 处
watch([currentFilter, debouncedSearchTerm], () => {
  if (currentViewMode.value === 'table' && historyContainerRef.value) {
    savedTableScrollTop = historyContainerRef.value.scrollTop;
  }
});

const handleTotalCountUpdate = (count: number) => {
  totalCount.value = count;
};

watch(
  () => historyManager.totalCount.value,
  (count) => {
    if (historyManager.isStatsLoaded.value) totalCount.value = count;
  },
);
</script>

<template>
  <div class="history-view">
    <!-- 顶部导航栏 -->
    <DashboardStrip
      v-model:view-mode="currentViewMode"
      v-model:filter="currentFilter"
      :total-count="totalCount"
      :service-counts="serviceCounts"
      @update:search-term="debouncedSearchTerm = $event"
    />

    <!-- 视图容器（可滚动） -->
    <div ref="historyContainerRef" class="history-container" :class="{ 'no-padding': useNoPaddingContainer }">
      <div v-if="showParentEmptyState" class="history-empty-state-wrapper">
        <EmptyState
          :icon="emptyStateIcon"
          :title="emptyStateTitle"
          :description="emptyStateDescription"
        />
      </div>

      <!-- 表格视图 -->
      <HistoryTableView
        v-if="shouldMountChildViews"
        v-show="currentViewMode === 'table'"
        :visible="currentViewMode === 'table'"
        :filter="currentFilter"
        :search-term="debouncedSearchTerm"
        @update:total-count="handleTotalCountUpdate"
      />

      <!-- 时间轴视图 -->
      <TimelineView
        v-if="shouldMountChildViews"
        v-show="currentViewMode === 'timeline'"
        :visible="currentViewMode === 'timeline'"
        :activation-trigger="activationTrigger"
        :filter="currentFilter"
        :search-term="debouncedSearchTerm"
        @update:total-count="handleTotalCountUpdate"
      />

      <!-- 收藏视图 -->
      <FavoritesView
        v-if="shouldMountChildViews"
        v-show="currentViewMode === 'favorites'"
        :visible="currentViewMode === 'favorites'"
        :filter="currentFilter"
        :search-term="debouncedSearchTerm"
        @update:total-count="handleTotalCountUpdate"
      />
    </div>
  </div>
</template>

<style scoped>
.history-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-app);
}

.history-container {
  flex: 1;
  overflow: hidden auto;
  padding: var(--space-lg-xl) var(--space-xl);
}

.history-container.no-padding {
  padding: 0;
}

.history-empty-state-wrapper {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* history-container 滚动条样式 */
.history-container::-webkit-scrollbar-track {
  background: transparent;
}
</style>
