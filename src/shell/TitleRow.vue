<script setup lang="ts">
// 页面顶部标题行（交接说明 3.2）：单栏页标题在左（左距 24，高 40，margin-top 6），
// 右侧依次是页面自带的操作、传输中心入口、窗口按钮。整行可拖动窗口。
import WindowControls from './WindowControls.vue';

defineProps<{
  /** 不传 = 首页那种只有窗口按钮的 40px 行 */
  title?: string;
}>();
</script>

<template>
  <header class="title-row" :class="{ 'title-row--bare': !title }" data-tauri-drag-region>
    <h1 v-if="title" class="title-row__title" data-tauri-drag-region>{{ title }}</h1>
    <div class="title-row__spacer" data-tauri-drag-region />
    <slot name="actions" />
    <WindowControls />
  </header>
</template>

<style scoped>
.title-row {
  display: flex;
  flex: none;
  align-items: flex-start;
  height: var(--pn-size-page-title-row);
  padding-left: var(--pn-space-24);
  user-select: none;
}

.title-row--bare {
  align-items: center;
  height: var(--pn-size-title-bar);
}

.title-row__title {
  display: flex;
  align-items: center;
  height: var(--pn-size-title-bar);
  margin: var(--pn-space-6) 0 0;
  font-size: var(--pn-text-headline);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-headline);
  letter-spacing: var(--pn-tracking-headline);
}

.title-row__spacer {
  flex: 1;
  align-self: stretch;
}
</style>
