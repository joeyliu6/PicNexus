<script setup lang="ts">
// 设置的一组（SettingsScreen.dc.html）：12px 小标题 → 卡片（默认插槽）→ 卡片下方一句灰色脚注说清后果。
// 小标题右侧可放一个控件（「图片压缩」旁的「上传前压缩」开关）。
defineProps<{
  title: string;
  note?: string;
}>();
</script>

<template>
  <section class="settings-section" :aria-label="title">
    <div class="settings-section__head">
      <h2 class="settings-section__title">{{ title }}</h2>
      <div class="settings-section__spacer" />
      <slot name="aside" />
    </div>
    <slot />
    <p v-if="note || $slots.note" class="settings-section__note"><slot name="note">{{ note }}</slot></p>
  </section>
</template>

<style scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-8);
}

.settings-section__head {
  display: flex;
  align-items: center;
  padding-left: var(--pn-space-4);
}

.settings-section__title {
  margin: 0;
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-footnote);
}

.settings-section__spacer { flex: 1; }

.settings-section__note {
  margin: 0;
  padding: 0 var(--pn-space-4);
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-settings-note);
}
</style>
