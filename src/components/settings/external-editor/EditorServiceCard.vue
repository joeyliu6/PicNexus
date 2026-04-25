<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ServerServiceType } from '../../../config/types';
import ServiceSelectorDropdown from '../ServiceSelectorDropdown.vue';
import CollapsibleSettingsCard from '../CollapsibleSettingsCard.vue';

/**
 * 通用「外部编辑器服务卡片」骨架
 * 提供折叠卡片头部、缺失服务横幅、服务选择行等公共结构。
 * 各编辑器（Obsidian / Typora）的引导步骤通过默认 slot 注入。
 */
interface Props {
  title: string;
  description: string;
  serviceLabel?: string;
  serviceDesc: string;
  configuredServices: Array<{ value: ServerServiceType; label: string }>;
  healthStatusMap: Record<string, string>;
  healthTooltipMap: Record<string, string>;
  cliUnsupportedServices: Set<ServerServiceType>;
  serviceLabelMap: Record<ServerServiceType, string>;
}

withDefaults(defineProps<Props>(), {
  serviceLabel: '上传到',
});

const enabled = defineModel<boolean>('enabled', { required: true });
const service = defineModel<ServerServiceType | null>('service', { required: true });

const emit = defineEmits<{
  navigateHosting: [];
}>();

const expanded = ref(false);

const needsService = computed(() => enabled.value && !service.value);

// 用户刚把开关从关切到开、且图床还没选时，自动展开卡片引导下一步
watch(enabled, (curr, prev) => {
  if (curr && !prev && !service.value) {
    expanded.value = true;
  }
});
</script>

<template>
  <CollapsibleSettingsCard
    :title="title"
    :description="description"
    :enabled="enabled"
    :expanded="expanded"
    :needsAttention="needsService"
    attentionTooltip="需选择图床才能使用"
    allowOverflow
    @update:enabled="(v: boolean) => enabled = v"
    @update:expanded="(v: boolean) => expanded = v"
  >
    <div class="editor-card-content">
      <div v-if="needsService" class="missing-service-banner">
        <i class="pi pi-exclamation-circle" />
        <span>开关已开启，但还没选择图床。请在下方选择一个图床后才能正常使用。</span>
      </div>
      <div class="card-service-row">
        <div class="card-service-info">
          <span class="card-service-label">{{ serviceLabel }}</span>
          <span class="card-service-desc">{{ serviceDesc }}</span>
        </div>
        <ServiceSelectorDropdown
          :modelValue="service"
          :configuredServices="configuredServices"
          :healthStatusMap="healthStatusMap"
          :healthTooltipMap="healthTooltipMap"
          :cliUnsupportedServices="cliUnsupportedServices"
          :serviceLabelMap="serviceLabelMap"
          @update:modelValue="(v: ServerServiceType | null) => service = v"
          @navigateHosting="emit('navigateHosting')"
        />
      </div>

      <slot />
      <slot name="footer" />
    </div>
  </CollapsibleSettingsCard>
</template>

<style>
@import url('../../../styles/editor-card.css');
</style>

<style scoped>
@import url('../../../styles/settings-shared.css');
</style>
