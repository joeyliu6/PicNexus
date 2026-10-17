<script setup lang="ts">
// 工具卡（HealthScreen.dc.html，交接说明 8.3）：surface 底、圆角 16、无描边；左插画 → 标题 + 数量 → 一句说明 → 右侧白色浮起按钮。
// 窄窗口去掉插画、按钮移到说明下方。按钮放在 action 插槽里（有的按钮要接菜单）。
import ToolCardArt from './ToolCardArt.vue';

defineProps<{
  title: string;
  art: 'doc' | 'backup' | 'lost' | 'auto';
  /** 标题旁的数量（「3 个文档」「96 / 1,206」）；琥珀色用于「找不回的图片 · 6 张」 */
  num?: string;
  numTone?: 'default' | 'warning';
  desc: string;
  /** 0–1：补充备份进行中的细进度条 */
  progress?: number;
  narrow?: boolean;
}>();
</script>

<template>
  <section class="tool-card" :class="{ 'tool-card--narrow': narrow }" :aria-label="title">
    <ToolCardArt v-if="!narrow" :kind="art" />
    <div class="tool-card__body">
      <span class="tool-card__head">
        <span class="tool-card__title">{{ title }}</span>
        <span v-if="num" class="tool-card__num" :class="{ 'tool-card__num--warning': numTone === 'warning' }">{{ num }}</span>
      </span>
      <span class="tool-card__desc">{{ desc }}</span>
      <div v-if="progress !== undefined" class="tool-card__bar" role="progressbar" :aria-label="`${title}进度`" :aria-valuenow="Math.round(progress * 100)" aria-valuemin="0" aria-valuemax="100">
        <span :style="{ width: `${progress * 100}%` }" />
      </div>
    </div>
    <div v-if="$slots.action" class="tool-card__action"><slot name="action" /></div>
  </section>
</template>

<style scoped>
.tool-card {
  display: flex;
  flex-direction: row;
  gap: var(--pn-space-tool-card);
  align-items: center;
  min-width: 0;
  padding: var(--pn-space-tool-card);
  border-radius: var(--pn-radius-card);
  background: var(--pn-surface);
}

.tool-card--narrow {
  flex-direction: column;
  gap: var(--pn-space-tool-card-gap-narrow);
  align-items: stretch;
}

.tool-card__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-2);
  align-self: stretch;
  justify-content: center;
  min-width: 0;
}

.tool-card__head { display: flex; gap: var(--pn-space-6); align-items: baseline; min-width: 0; }
.tool-card__title { font-weight: var(--pn-weight-semibold); white-space: nowrap; }

.tool-card__num {
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--pn-text2);
  white-space: nowrap;
}

.tool-card__num--warning { color: var(--pn-warning); }

.tool-card__desc {
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-tool-desc);
  color: var(--pn-text3);
}

.tool-card__bar {
  height: var(--pn-size-progress);
  margin-top: var(--pn-space-6);
  overflow: hidden;
  border-radius: var(--pn-space-2);
  background: var(--pn-track);
}

.tool-card__bar > span {
  display: block;
  height: 100%;
  border-radius: var(--pn-space-2);
  background: var(--pn-brand);
  transition: width var(--pn-dur-standard) var(--pn-ease-in);
}

.tool-card__action { display: flex; flex: none; }
.tool-card--narrow .tool-card__action { align-self: flex-start; }
</style>
