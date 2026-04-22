<script setup lang="ts">
/**
 * 批量迁移面板 — 容器组件
 * 管理 composable 初始化 + 阶段切换 + provide 给子组件
 */
import { watch, onActivated, onDeactivated, onUnmounted, provide } from 'vue';
import { useBatchMigrateManager } from '../../../composables/useBatchMigrate';
import { debounceWithError } from '../../../utils/debounce';
import { useServiceHealth } from '../../../composables/useServiceHealth';
import { useToast } from '../../../composables/useToast';
import { MIGRATE_KEY } from './migrate/keys';
import MigrateSelectPhase from './migrate/MigrateSelectPhase.vue';
import MigrateProgressPhase from './migrate/MigrateProgressPhase.vue';

const manager = useBatchMigrateManager();
const { healthStatusMap, healthTooltipMap } = useServiceHealth();
const toast = useToast();

// 启动前统一过滤健康状态为 error 的目标，首次启动和重试失败项都必须走这条路径，
// 否则"重试失败"直连 manager.retryFailed() 会绕过过滤，当目标仍为 error 时
// startMigrate 内部 targets.length===0 静默 return，用户看到按钮点了没反应
function prefilterUnhealthyTargets() {
  for (const svc of manager.targetServices.value) {
    if (svc.checked && healthStatusMap.value[svc.serviceId] === 'error') {
      svc.checked = false;
    }
  }
}

async function handleRetryFailed(historyIds: string[]) {
  prefilterUnhealthyTargets();
  await manager.retryFailed(historyIds);
}

// provide 给子组件，retryFailed 替换为带健康过滤的包装版本
provide(MIGRATE_KEY, {
  ...manager,
  retryFailed: handleRetryFailed,
  healthStatusMap,
  healthTooltipMap,
});

manager.initConfiguring();

onActivated(() => {
  manager.onViewActivated();
  // 若上次被空闲计时器清理过，提示用户原因
  if (manager.wasIdleCleared.value) {
    manager.wasIdleCleared.value = false;
    toast.info('迁移数据已自动释放', '面板闲置 3 分钟后已清空列表和结果以释放内存');
  }
  if (manager.phase.value === 'configuring') manager.initConfiguring();
});

onDeactivated(() => manager.onViewDeactivated());

const debouncedApplyFilter = debounceWithError(() => manager.applyFilter(), 150);
onUnmounted(() => {
  debouncedApplyFilter.cancel();
  manager.dispose();
});

watch(manager.maxSuccessCount, () => { if (manager.phase.value === 'configuring') debouncedApplyFilter(); });
watch([manager.sourceServiceFilter, manager.timestampAfterMs], () => {
  if (manager.phase.value === 'configuring' && manager.isFilterApplied.value) debouncedApplyFilter();
});

function handleStartClick() {
  prefilterUnhealthyTargets();
  if (manager.checkedTargets.value.length === 0) return;
  manager.startMigrate();
}
</script>

<template>
  <div class="migrate-panel">

    <!-- configuring -->
    <MigrateSelectPhase
      v-if="manager.phase.value === 'configuring'"
      @start="handleStartClick"
    />

    <!-- migrating + done 共用同一面板 -->
    <MigrateProgressPhase
      v-else-if="manager.phase.value === 'migrating' || manager.phase.value === 'done'"
    />
  </div>
</template>

<style scoped>
.migrate-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: var(--space-lg-xl) 0 var(--space-lg-xl) var(--space-xl);
  gap: var(--space-md-lg);
}
</style>
