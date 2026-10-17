<script setup lang="ts">
// 设置卡片：圆角 12、一圈 1px 分隔色；「备份与同步」的卡片圆角 14（SettingsScreen.dc.html）
withDefaults(defineProps<{ large?: boolean }>(), { large: false });
</script>

<template>
  <div class="settings-card" :class="{ 'settings-card--large': large }">
    <slot />
  </div>
</template>

<style scoped>
.settings-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border-radius: var(--pn-radius-settings-card);
  box-shadow: 0 0 0 1px var(--pn-border);
}

.settings-card--large { border-radius: var(--pn-radius-xl); }
</style>
