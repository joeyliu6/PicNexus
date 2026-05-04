<script setup lang="ts">
import HostingCard from '../HostingCard.vue';

defineProps<{
  jdAvailable: boolean;
  qiyuAvailable: boolean;
  isCheckingJd: boolean;
  isCheckingQiyu: boolean;
  healthTooltipMap: Record<string, string>;
  refreshingServiceIds: Set<string>;
  targetCardId?: string | null;
}>();

const emit = defineEmits<{
  checkBuiltin: [providerId: string];
}>();

</script>

<template>
  <div class="provider-grid">
    <!-- 京东 -->
    <HostingCard
      id="jd"
      :force-expand="targetCardId === 'jd'"
      name="京东"
      description="默认启用，京东云存储"
      :isBuiltin="true"
      :isConfigured="jdAvailable"
      :isAvailable="jdAvailable"
      :isChecking="isCheckingJd"
      :is-refreshing="refreshingServiceIds.has('jd')"
      :health-tooltip="healthTooltipMap['jd']"
      :showTestButton="false"
      @check="emit('checkBuiltin', $event)"
    >
      <div class="builtin-info">
        <p>京东图床默认启用，无需手动配置，可以直接使用。</p>
      </div>
    </HostingCard>

    <!-- 七鱼 -->
    <HostingCard
      id="qiyu"
      :force-expand="targetCardId === 'qiyu'"
      name="七鱼"
      description="默认启用，Token 自动获取"
      :isBuiltin="true"
      :isConfigured="qiyuAvailable"
      :isAvailable="qiyuAvailable"
      :isChecking="isCheckingQiyu"
      :is-refreshing="refreshingServiceIds.has('qiyu')"
      :health-tooltip="healthTooltipMap['qiyu']"
      :showTestButton="false"
      @check="emit('checkBuiltin', $event)"
    >
      <div class="builtin-info">
        <p>七鱼图床默认启用，Token 会自动获取，无需手动配置。</p>
      </div>
    </HostingCard>
  </div>
</template>

<style scoped>
.builtin-info {
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.builtin-info p {
  margin: 0;
}
</style>
