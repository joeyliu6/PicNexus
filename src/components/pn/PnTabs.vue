<script setup lang="ts" generic="T extends string">
// 标签页（Controls.dc.html）：切换同一页里的不同工具。下划线用正文色，不用品牌蓝（蓝色只表示进行中）。
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui';

const model = defineModel<T>({ required: true });

defineProps<{
  tabs: readonly { value: T; label: string }[];
  label?: string;
}>();
</script>

<template>
  <TabsRoot v-model="model" class="pn-tabs" activation-mode="manual">
    <TabsList class="pn-tabs__list" :aria-label="label">
      <TabsTrigger v-for="tab in tabs" :key="tab.value" class="pn-tabs__trigger" :value="tab.value">
        {{ tab.label }}
      </TabsTrigger>
    </TabsList>
    <slot />
  </TabsRoot>
</template>

<style scoped>
.pn-tabs__list {
  display: flex;
  gap: var(--pn-space-tab-gap);
  box-shadow: inset 0 -1px 0 var(--pn-border);
}

.pn-tabs__trigger {
  padding: var(--pn-space-tab-top) 0 var(--pn-space-tab-bottom);
  border: 0;
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  cursor: pointer;
}

.pn-tabs__trigger[data-state='active'] {
  color: var(--pn-text1);
  font-weight: var(--pn-weight-semibold);
  box-shadow: inset 0 -2px 0 var(--pn-text1);
}
</style>
