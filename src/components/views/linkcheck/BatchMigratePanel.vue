<script setup lang="ts">
/**
 * 批量迁移面板 — 容器组件
 * 管理 composable 初始化 + 阶段切换 + provide 给子组件
 */
import { watch, onActivated, ref, provide } from 'vue';
import { useBatchMigrateManager } from '../../../composables/useBatchMigrate';
import { useServiceHealth } from '../../../composables/useServiceHealth';
import { MIGRATE_KEY } from './migrate/keys';
import MigrateSelectPhase from './migrate/MigrateSelectPhase.vue';
import MigrateConfirmPhase from './migrate/MigrateConfirmPhase.vue';
import MigrateProgressPhase from './migrate/MigrateProgressPhase.vue';
import MigrateDonePhase from './migrate/MigrateDonePhase.vue';

const manager = useBatchMigrateManager();
const { healthStatusMap, healthTooltipMap } = useServiceHealth();

// 确认视图（独立全页，不是底栏面板）
const showConfirmView = ref(false);

// provide 给子组件
provide(MIGRATE_KEY, {
  ...manager,
  healthStatusMap,
  healthTooltipMap,
});

manager.initConfiguring();
onActivated(() => { if (manager.phase.value === 'configuring') manager.initConfiguring(); });

watch(manager.maxSuccessCount, () => { if (manager.phase.value === 'configuring') manager.applyFilter(); });
watch(manager.sourceServiceFilter, () => { if (manager.phase.value === 'configuring') manager.applyFilter(); });

// phase 变化时重置确认视图
watch(manager.phase, () => { showConfirmView.value = false; });

function handleStartClick() {
  showConfirmView.value = true;
}

function confirmStart() {
  showConfirmView.value = false;
  manager.startMigrate();
}

function cancelConfirm() {
  showConfirmView.value = false;
}
</script>

<template>
  <div class="migrate-panel">

    <!-- configuring + 确认视图 -->
    <template v-if="manager.phase.value === 'configuring'">
      <MigrateConfirmPhase
        v-if="showConfirmView"
        @confirm="confirmStart"
        @cancel="cancelConfirm"
      />
      <MigrateSelectPhase
        v-else
        @start="handleStartClick"
      />
    </template>

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
