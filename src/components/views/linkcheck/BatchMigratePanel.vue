<script setup lang="ts">
/**
 * 批量迁移面板 — 容器组件
 * 管理 composable 初始化 + 阶段切换 + provide 给子组件
 */
import { watch, onActivated, provide } from 'vue';
import { useBatchMigrateManager } from '../../../composables/useBatchMigrate';
import { useServiceHealth } from '../../../composables/useServiceHealth';
import { MIGRATE_KEY } from './migrate/keys';
import MigrateSelectPhase from './migrate/MigrateSelectPhase.vue';
import MigrateProgressPhase from './migrate/MigrateProgressPhase.vue';
import MigrateDonePhase from './migrate/MigrateDonePhase.vue';

const manager = useBatchMigrateManager();
const { healthStatusMap, healthTooltipMap } = useServiceHealth();

// provide 给子组件
provide(MIGRATE_KEY, {
  ...manager,
  healthStatusMap,
  healthTooltipMap,
});

manager.initConfiguring();
onActivated(() => { if (manager.phase.value === 'configuring') manager.initConfiguring(); });

watch(manager.maxSuccessCount, () => { if (manager.phase.value === 'configuring') manager.applyFilter(); });
watch(manager.sourceServiceFilter, () => {
  if (manager.phase.value === 'configuring' && manager.isFilterApplied.value) manager.applyFilter();
});

function handleStartClick() {
  // 启动前再过滤一次健康状态为 error 的目标（防渲染到点击之间的竞态）
  for (const svc of manager.targetServices.value) {
    if (svc.checked && healthStatusMap.value[svc.serviceId] === 'error') {
      svc.checked = false;
    }
  }
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

    <!-- migrating -->
    <MigrateProgressPhase v-else-if="manager.phase.value === 'migrating'" />

    <!-- done -->
    <MigrateDonePhase v-else-if="manager.phase.value === 'done'" />
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
