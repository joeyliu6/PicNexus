<script setup lang="ts">
// 空状态（交接说明 6.2；尺寸照 GalleryScreen.dc.html G09–G11）：44px 线条图标 + 15px 标题 + 一句说明 + 可选按钮，
// 居中偏上（下方留 80px）。backdrop 插槽放背景装饰（BgDecor，铺满整块、垫在文字下面）。
// compact = 卡片 / 小列表里的紧凑版（Patterns.dc.html「空状态」第二格）：只有标题与说明。
import PnIcon from './PnIcon.vue';
import type { IconName } from './icons';

withDefaults(defineProps<{
  title: string;
  description?: string;
  icon?: IconName;
  compact?: boolean;
}>(), { description: undefined, icon: undefined, compact: false });
</script>

<template>
  <div class="pn-empty" :class="{ 'pn-empty--compact': compact }">
    <slot name="backdrop" />
    <PnIcon v-if="icon && !compact" :name="icon" :size="44" :stroke="1.2" class="pn-empty__icon" />
    <span class="pn-empty__title">{{ title }}</span>
    <span v-if="description" class="pn-empty__desc">{{ description }}</span>
    <div v-if="$slots.default" class="pn-empty__actions"><slot /></div>
  </div>
</template>

<style scoped>
.pn-empty {
  position: relative;
  isolation: isolate;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--pn-space-8);
  padding: 0 var(--pn-space-20) var(--pn-space-empty-bottom);
  text-align: center;
}

.pn-empty--compact { gap: var(--pn-space-4); padding-bottom: 0; }

.pn-empty__icon { color: var(--pn-text3); }

.pn-empty__title {
  margin-top: var(--pn-space-6);
  font-size: var(--pn-text-headline);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-headline);
}

.pn-empty--compact .pn-empty__title {
  margin-top: 0;
  font-size: var(--pn-text-body);
  font-weight: var(--pn-weight-medium);
}

.pn-empty__desc { color: var(--pn-text2); }

.pn-empty--compact .pn-empty__desc {
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.pn-empty__actions { display: flex; gap: var(--pn-space-8); margin-top: var(--pn-space-empty-action-top); }
</style>
