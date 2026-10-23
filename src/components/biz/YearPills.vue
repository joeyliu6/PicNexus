<script setup lang="ts">
// 年份胶囊（HealthScreen.dc.html 上传日历顶部）：最近 6 年平铺，其余收进「更早 ▾」；有失效的年份旁写琥珀张数
//（「更早」写合计）。选中的是白色浮起胶囊。
import { computed } from 'vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import { formatCount } from '@/utils/formatters';

const props = defineProps<{
  shown: readonly number[];
  earlier: readonly number[];
  /** 每年的失效张数 */
  dead: ReadonlyMap<number, number>;
  narrow?: boolean;
}>();

const year = defineModel<number>({ required: true });

const earlierDead = computed(() => props.earlier.reduce((n, y) => n + (props.dead.get(y) ?? 0), 0));
const earlierPicked = computed(() => props.earlier.includes(year.value));
const earlierOptions = computed(() => props.earlier.map((y) => ({
  value: String(y),
  label: `${y} 年`,
  hint: props.dead.get(y) ? `${formatCount(props.dead.get(y)!)} 张失效` : undefined,
})));
const earlierModel = computed({
  get: () => (earlierPicked.value ? String(year.value) : ''),
  set: (value: string) => { if (value) year.value = Number(value); },
});
</script>

<template>
  <div class="year-pills" :class="{ 'year-pills--narrow': narrow }" role="radiogroup" aria-label="年份">
    <button
      v-for="y in shown"
      :key="y"
      type="button"
      role="radio"
      class="year-pills__pill"
      :class="{ 'year-pills__pill--on': y === year }"
      :aria-checked="y === year"
      @click="year = y"
    >
      {{ y }}<span v-if="dead.get(y)" class="year-pills__bad">{{ formatCount(dead.get(y)!) }}</span>
    </button>
    <PnMenu v-if="earlier.length" align="start" :width="200">
      <template #trigger>
        <button type="button" class="year-pills__pill" :class="{ 'year-pills__pill--on': earlierPicked }" aria-haspopup="menu">
          {{ earlierPicked ? year : '更早' }}<span v-if="!earlierPicked && earlierDead" class="year-pills__bad">{{ formatCount(earlierDead) }}</span>
          <PnIcon name="chevronDown" :size="11" :stroke="2" />
        </button>
      </template>
      <PnMenuRadioGroup v-model="earlierModel" :options="earlierOptions" />
    </PnMenu>
  </div>
</template>

<style scoped>
.year-pills { display: flex; align-items: center; gap: var(--pn-space-2); }

.year-pills__pill {
  display: flex;
  align-items: center;
  gap: var(--pn-space-year-pill-gap);
  height: var(--pn-size-year-pill);
  padding: 0 var(--pn-space-year-pill-x);
  border: 0;
  border-radius: var(--pn-radius-year-pill);
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  /* 选中换到另一年：白底与阴影按「快」过渡；悬停只变字色，按「即时」 */
  transition: background-color var(--pn-dur-fast) var(--pn-ease-in), box-shadow var(--pn-dur-fast) var(--pn-ease-in), color var(--pn-dur-instant) var(--pn-ease-in);
}

.year-pills--narrow .year-pills__pill { padding: 0 var(--pn-space-year-pill-x-narrow); }
.year-pills__pill:hover { color: var(--pn-text1); }

/* 年份胶囊点了就选中（白色浮起胶囊立刻出现），不另加按下色；「更早」是菜单触发器：按住 / 打开时垫选中色，与本页其他触发器一致 */
.year-pills__pill[aria-haspopup]:not(.year-pills__pill--on):active,
.year-pills__pill[aria-haspopup]:not(.year-pills__pill--on)[data-state="open"] {
  background: var(--pn-selected);
  color: var(--pn-text1);
}

.year-pills__pill--on {
  background: var(--pn-btn-soft);
  box-shadow: var(--pn-btn-soft-shadow);
  color: var(--pn-text1);
  font-weight: var(--pn-weight-semibold);
}

.year-pills__bad {
  font-size: var(--pn-text-caption);
  font-weight: var(--pn-weight-semibold);
  color: var(--pn-warning);
}

.year-pills__pill:focus-visible {
  outline: var(--pn-ring-width) solid var(--pn-ring);
  outline-offset: var(--pn-ring-offset);
}
</style>
