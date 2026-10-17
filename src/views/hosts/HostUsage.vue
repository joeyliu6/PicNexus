<script setup lang="ts">
// 使用情况（HostsScreen.dc.html）：三个数字 + 竖线 + 近 14 天上传总数 + 14 根柱子，底边对齐。
// 柱高按 14 天里最多的那天归一，最矮 3px；0 张的画灰色，今天用品牌蓝。「张失效」大于 0 时琥珀色（交接说明第 4 节规则 5；设计稿画的红色，待拍板）、可点（跳到链接健康）。
import { computed } from 'vue';
import { formatCount } from '@/utils/formatters';
import type { HostUsage } from '@/services/database/HostUsageQuery';

const props = defineProps<{ usage: HostUsage | null }>();
const emit = defineEmits<{ showDead: [] }>();

const BAR_MAX = 44;
const BAR_MIN = 3;

const bars = computed(() => {
  const days = props.usage?.last14 ?? new Array<number>(14).fill(0);
  const max = Math.max(1, ...days);
  return days.map((v, i) => ({
    height: `${Math.max(BAR_MIN, Math.round((BAR_MAX * v) / max))}px`,
    kind: v === 0 ? 'empty' : i === days.length - 1 ? 'today' : 'past',
  }));
});

const recent = computed(() => (props.usage?.last14 ?? []).reduce((a, b) => a + b, 0));
const dead = computed(() => props.usage?.dead ?? 0);
</script>

<template>
  <div class="host-usage">
    <div class="host-usage__stat">
      <span class="host-usage__num">{{ formatCount(usage?.uploaded ?? 0) }}</span>
      <span class="host-usage__label">张传到这里</span>
    </div>
    <div class="host-usage__stat">
      <span class="host-usage__num">{{ formatCount(usage?.firstDone ?? 0) }}</span>
      <span class="host-usage__label">张最先完成</span>
    </div>
    <button v-if="dead > 0" type="button" class="host-usage__stat host-usage__stat--link" @click="emit('showDead')">
      <span class="host-usage__num host-usage__num--bad">{{ formatCount(dead) }}</span>
      <span class="host-usage__label">张失效 ›</span>
    </button>
    <div v-else class="host-usage__stat">
      <span class="host-usage__num">0</span>
      <span class="host-usage__label">张失效</span>
    </div>
    <span class="host-usage__divider" aria-hidden="true" />
    <div class="host-usage__stat">
      <span class="host-usage__num">{{ formatCount(recent) }}</span>
      <span class="host-usage__label">近 14 天上传</span>
    </div>
    <div class="host-usage__bars" title="每根柱子是一天，最右边是今天" aria-hidden="true">
      <span v-for="(bar, i) in bars" :key="i" class="host-usage__bar" :class="`host-usage__bar--${bar.kind}`" :style="{ height: bar.height }" />
    </div>
  </div>
</template>

<style scoped>
.host-usage {
  display: flex;
  align-items: flex-end;
  gap: var(--pn-space-host-usage-gap);
  padding: var(--pn-space-host-usage);
  border-radius: var(--pn-radius-xl);
  background: var(--pn-subtle);
}

.host-usage__stat {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--pn-space-2);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.host-usage__stat--link { cursor: pointer; }

.host-usage__num {
  font-size: var(--pn-text-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-title);
  letter-spacing: var(--pn-tracking-headline);
}

.host-usage__num--bad { color: var(--pn-warning); }

.host-usage__label {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.host-usage__divider {
  flex: none;
  width: 1px;
  height: var(--pn-size-host-bars);
  background: var(--pn-border);
}

.host-usage__bars {
  display: flex;
  flex: 1;
  align-items: flex-end;
  gap: var(--pn-space-host-bar-gap);
  min-width: 0;
  height: var(--pn-size-host-bars);
}

.host-usage__bar {
  flex: 1;
  border-radius: var(--pn-radius-host-bar);
}

.host-usage__bar--empty { background: var(--pn-border); }
.host-usage__bar--past { background: var(--pn-host-bar); }
.host-usage__bar--today { background: var(--pn-brand); }
</style>
