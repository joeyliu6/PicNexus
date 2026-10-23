<script setup lang="ts">
// 全部失效图片（HealthScreen.dc.html，交接说明 8.3 / 15）：不受日历年份影响——「一次找全、一次修完」的入口。
// 右侧三个筛选：原因 / 图床 / 年份（年份菜单只列有失效的年份并带张数，最后一项「与上方日历同步」）；
// 点日历某天后标题旁出现可移除的日期标签。分「可改用备份 / 无可用备份」两组，先显示 3 / 2 行，「显示其余 N 张」每次多 100 行。
import { computed, reactive, watch } from 'vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import PnMenuSeparator from '@/components/pn/PnMenuSeparator.vue';
import type { UserConfig } from '@/config/types';
import { formatCount } from '@/utils/formatters';
import { REASON_TEXT, type DeadGroup, type HealthImage } from './healthModel';
import HealthDeadRow from './HealthDeadRow.vue';

/** 年份筛选：全部 / 某一年 / 跟着上方日历 */
export type YearFilter = 'all' | 'sync' | number;

const props = defineProps<{
  groups: readonly DeadGroup[];
  /** 筛选菜单的张数来源：全部失效 + 可能受限 */
  pool: readonly HealthImage[];
  title: string;
  /** 「21 张」 */
  count: string;
  /** 点日历选中的那一天：「2023年5月22日」 */
  dayLabel: string | null;
  showFilters: boolean;
  narrow: boolean;
  /** 修复中：不给「显示其余 N 张」（L10） */
  fixing: boolean;
  hostName: (id: string) => string;
  shortHostName: (id: string) => string;
  config: UserConfig;
  confirmedHttpHosts: ReadonlySet<string>;
  docsOf: (id: string) => number | null;
  repairRows: ReadonlyMap<string, { phase: 'waiting' | 'fixing' | 'done' | 'failed'; to: string }>;
  retrying: ReadonlySet<string>;
  stillDead: ReadonlySet<string>;
}>();

const reason = defineModel<string>('reason', { required: true });
const host = defineModel<string>('host', { required: true });
const year = defineModel<YearFilter>('year', { required: true });

const emit = defineEmits<{
  clearDay: [];
  switch: [id: string];
  retry: [id: string];
  reupload: [id: string];
  locate: [id: string];
  openBrowser: [id: string];
  removeDead: [id: string];
}>();

const FIRST_ROWS: Record<DeadGroup['key'], number> = { fixable: 3, unfixable: 2, limited: 3 };
const MORE_ROWS = 100;
const extra = reactive<Record<string, number>>({});
watch(() => [reason.value, host.value, year.value, props.dayLabel], () => { for (const k of Object.keys(extra)) delete extra[k]; });

const visible = (group: DeadGroup) => group.images.slice(0, FIRST_ROWS[group.key] + (extra[group.key] ?? 0));

const counted = <K extends string>(keyOf: (image: HealthImage) => K | null) => {
  const map = new Map<K, number>();
  for (const image of props.pool) {
    const key = keyOf(image);
    if (key !== null) map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
};

const deadPool = computed(() => props.pool.filter((i) => i.state !== 'limited'));

const reasonOptions = computed(() => {
  const counts = counted((i) => (i.state === 'limited' ? 'limited' : i.reason ?? null));
  return [
    { value: 'all', label: '全部', hint: formatCount(deadPool.value.length) },
    ...(['gone', 'denied', 'timeout', 'limited'] as const).map((k) => ({ value: k, label: REASON_TEXT[k], hint: formatCount(counts.get(k) ?? 0) })),
  ];
});

const hostOptions = computed(() => {
  const counts = counted((i) => (i.state === 'limited' ? null : i.copyHost));
  return [
    { value: 'all', label: '全部', hint: formatCount(deadPool.value.length) },
    ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ value: id, label: props.hostName(id), hint: formatCount(n) })),
  ];
});

const yearCounts = computed(() => counted((i) => (i.state === 'limited' ? null : String(new Date(i.uploadedAt).getFullYear()))));
const yearOptions = computed(() => [
  { value: 'all', label: '全部年份', hint: formatCount(deadPool.value.length) },
  ...[...yearCounts.value.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([y, n]) => ({ value: y, label: `${y} 年`, hint: formatCount(n) })),
]);
const yearModel = computed({
  get: () => String(year.value),
  set: (v: string) => { year.value = v === 'all' || v === 'sync' ? v : Number(v); },
});

const reasonLabel = computed(() => reasonOptions.value.find((o) => o.value === reason.value)?.label ?? '全部');
const hostLabel = computed(() => (host.value === 'all' ? '全部' : props.hostName(host.value)));
const yearLabel = computed(() => (year.value === 'all' ? '全部' : year.value === 'sync' ? '与日历同步' : `${year.value} 年`));
</script>

<template>
  <section class="dead-list" :aria-label="title">
    <div class="dead-list__head">
      <h2 class="dead-list__title">{{ title }}</h2>
      <span class="dead-list__count">{{ count }}</span>
      <span v-if="dayLabel" class="dead-list__chip">
        {{ dayLabel }}
        <button type="button" class="dead-list__chip-remove" aria-label="移除这个筛选" @click="emit('clearDay')">
          <PnIcon name="close" :size="10" :stroke="2.6" />
        </button>
      </span>
      <div class="dead-list__spacer" />
      <template v-if="showFilters">
        <PnMenu align="end" :width="200">
          <template #trigger>
            <button type="button" class="dead-list__filter" aria-haspopup="menu"><span class="dead-list__filter-label">原因</span>{{ reasonLabel }}<PnIcon name="chevronDown" :size="11" :stroke="2" class="dead-list__caret" /></button>
          </template>
          <PnMenuRadioGroup v-model="reason" :options="reasonOptions" />
        </PnMenu>
        <PnMenu align="end" :width="200">
          <template #trigger>
            <button type="button" class="dead-list__filter" aria-haspopup="menu"><span class="dead-list__filter-label">图床</span>{{ hostLabel }}<PnIcon name="chevronDown" :size="11" :stroke="2" class="dead-list__caret" /></button>
          </template>
          <PnMenuRadioGroup v-model="host" :options="hostOptions" />
        </PnMenu>
        <PnMenu align="end" :width="200">
          <template #trigger>
            <button type="button" class="dead-list__filter" aria-haspopup="menu"><span class="dead-list__filter-label">年份</span>{{ yearLabel }}<PnIcon name="chevronDown" :size="11" :stroke="2" class="dead-list__caret" /></button>
          </template>
          <PnMenuRadioGroup v-model="yearModel" :options="yearOptions" />
          <PnMenuSeparator />
          <PnMenuRadioGroup v-model="yearModel" :options="[{ value: 'sync', label: '与上方日历同步' }]" />
        </PnMenu>
      </template>
    </div>

    <p v-if="groups.length === 0" class="dead-list__empty">没有符合条件的失效图片</p>
    <TransitionGroup v-for="group in groups" :key="group.key" name="dead-row" tag="div" class="dead-list__group">
      <div key="head" class="dead-list__group-head">
        <span class="dead-list__group-title">{{ group.title }}</span>
        <span class="dead-list__count">{{ formatCount(group.images.length) }} 张</span>
        <div class="dead-list__spacer" />
        <button
          v-if="group.images.length > visible(group).length"
          type="button"
          class="dead-list__more"
          :class="{ 'dead-list__more--hidden': fixing }"
          @click="extra[group.key] = (extra[group.key] ?? 0) + MORE_ROWS"
        >
          显示其余 {{ formatCount(group.images.length - visible(group).length) }} 张
        </button>
      </div>
      <HealthDeadRow
        v-for="(image, i) in visible(group)"
        :key="image.id"
        :image="image"
        :host-name="hostName"
        :short-host-name="shortHostName"
        :config="config"
        :confirmed-http-hosts="confirmedHttpHosts"
        :narrow="narrow"
        :docs="docsOf(image.id)"
        :repair="repairRows.get(image.id)"
        :retrying="retrying.has(image.id)"
        :still-dead="stillDead.has(image.id)"
        :last="i === visible(group).length - 1"
        @switch="emit('switch', image.id)"
        @retry="emit('retry', image.id)"
        @reupload="emit('reupload', image.id)"
        @locate="emit('locate', image.id)"
        @open-browser="emit('openBrowser', image.id)"
        @remove-dead="emit('removeDead', image.id)"
      />
    </TransitionGroup>
  </section>
</template>

<style scoped>
.dead-list { display: flex; flex-direction: column; gap: var(--pn-space-2); }

.dead-list__head {
  display: flex;
  gap: var(--pn-space-8);
  align-items: center;
  padding: var(--pn-space-dead-head);
}

.dead-list__title {
  margin: 0;
  font-size: var(--pn-text-headline);
  font-weight: var(--pn-weight-semibold);
  letter-spacing: var(--pn-tracking-headline);
  white-space: nowrap;
}

.dead-list__count { font-size: var(--pn-text-footnote); color: var(--pn-text3); white-space: nowrap; }

.dead-list__chip {
  display: flex;
  gap: var(--pn-space-4);
  align-items: center;
  height: var(--pn-size-dead-chip);
  margin-left: var(--pn-space-4);
  padding: var(--pn-space-dead-chip);
  border-radius: var(--pn-radius-dead-chip);
  background: var(--pn-brand-soft);
  color: var(--pn-brand-text);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
  white-space: nowrap;
}

.dead-list__chip-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-filter-chip-remove);
  height: var(--pn-size-filter-chip-remove);
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--pn-brand-text);
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 同图库筛选标签上的 ×：半透明叠在品牌浅底上 */
.dead-list__chip-remove:hover { background: var(--pn-chip-remove-hover); }
.dead-list__chip-remove:active { background: var(--pn-chip-remove-press); }

.dead-list__spacer { flex: 1; }

.dead-list__filter {
  display: flex;
  flex: none;
  gap: var(--pn-space-year-pill-gap);
  align-items: center;
  height: var(--pn-size-button-sm);
  padding: var(--pn-space-dead-filter);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-surface);
  color: var(--pn-text1);
  font: inherit;
  font-size: var(--pn-text-footnote);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 浅灰底按钮的阶梯：悬停 ghost-press、按住 subtle-press；菜单打开后回到设计稿的 navSel（写在最后，打开期间压过悬停） */
.dead-list__filter:hover { background: var(--pn-ghost-press); }
.dead-list__filter:active { background: var(--pn-subtle-press); }
.dead-list__filter[data-state="open"] { background: var(--pn-selected); }

.dead-list__filter-label,
.dead-list__caret { color: var(--pn-text3); }

.dead-list__group { display: flex; flex-direction: column; }

/* 修复（「修复 N 张」、行内「改用 X」）拿掉的行收起并淡出，下面的行跟着滑上来（decisions/motion.md）。认这一行的办法是
   离开时还带着修复中的 --busy：改好与拿掉常在同一刻发生，来不及画出「已改用 X」；修复失败的行不会被拿掉。
   换筛选拿掉的行不带 --busy，照旧立刻消失（LoadingRules ①）。「减少动态效果」时高度不变，只淡出。
   前面加 .dead-list__group：行自己的悬停变色也写在 transition 上，不加盖不过它 */
.dead-list__group > .dead-row--busy.dead-row-leave-active {
  min-height: 0;
  overflow: hidden;
  transition: max-height var(--pn-dur-standard) var(--pn-ease-out), padding var(--pn-dur-standard) var(--pn-ease-out), opacity var(--pn-dur-fade-standard) var(--pn-ease-out);
}

.dead-list__group > .dead-row--busy.dead-row-leave-from { max-height: var(--pn-size-dead-row); }
.dead-list__group > .dead-row--busy.dead-row-leave-to { opacity: 0; }

@media (prefers-reduced-motion: no-preference) {
  .dead-list__group > .dead-row--busy.dead-row-leave-to { max-height: 0; padding-top: 0; padding-bottom: 0; }
}

.dead-list__group-head {
  display: flex;
  gap: var(--pn-space-8);
  align-items: center;
  height: var(--pn-size-dead-group-head);
  padding: 0 var(--pn-space-12);
}

.dead-list__group-title { font-size: var(--pn-text-footnote); font-weight: var(--pn-weight-semibold); color: var(--pn-text2); }

/* 「显示其余 N 张」是文字按钮：悬停 / 按下垫透明底按钮的底色；左右各留 6 做热区，右边的 6 退回内边距里，文字位置不变 */
.dead-list__more {
  height: var(--pn-size-dead-more);
  margin-right: calc(-1 * var(--pn-space-6));
  padding: 0 var(--pn-space-6);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-brand-text);
  font: inherit;
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in), opacity var(--pn-dur-fast) var(--pn-ease-in), visibility var(--pn-dur-fast);
}

.dead-list__more:hover { background: var(--pn-ghost-hover); }
.dead-list__more:active { background: var(--pn-ghost-press); }

/* 修复中不给（L10）：原地淡出再隐藏，修完淡回来，不一闪一闪 */
.dead-list__more--hidden { visibility: hidden; opacity: 0; pointer-events: none; }

.dead-list__empty { margin: 0; padding: var(--pn-space-12); font-size: var(--pn-text-footnote); color: var(--pn-text3); }
</style>
