<script setup lang="ts">
import HostingCard from '../HostingCard.vue';

const props = defineProps<{
  jdAvailable: boolean;
  qiyuAvailable: boolean;
  isCheckingJd: boolean;
  isCheckingQiyu: boolean;
  healthTooltipMap: Record<string, string>;
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
      description="京东云存储，开箱即用"
      :isBuiltin="true"
      :isConfigured="jdAvailable"
      :isAvailable="jdAvailable"
      :isChecking="isCheckingJd"
      :health-tooltip="healthTooltipMap['jd']"
      :showTestButton="false"
      @check="emit('checkBuiltin', $event)"
    >
      <div class="builtin-info">
        <p>京东图床无需任何配置，可以直接使用。</p>
      </div>
    </HostingCard>

    <!-- 七鱼 -->
    <HostingCard
      id="qiyu"
      :force-expand="targetCardId === 'qiyu'"
      name="七鱼"
      description="网易七鱼客服系统存储"
      :isBuiltin="true"
      :isConfigured="qiyuAvailable"
      :isAvailable="qiyuAvailable"
      :isChecking="isCheckingQiyu"
      :health-tooltip="healthTooltipMap['qiyu']"
      :showTestButton="false"
      @check="emit('checkBuiltin', $event)"
    >
      <div class="builtin-info">
        <p>七鱼图床 Token 已自动获取，可以直接使用。</p>
      </div>
    </HostingCard>
  </div>
</template>

<style scoped>
.builtin-info {
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.builtin-info p {
  margin: 0;
}
</style>
