<script setup lang="ts">
// 上传日历（HealthScreen.dc.html，交接说明 8.3 / 11 / 15）：一次一年、一格一天；只吃数据，不查库。
// 图上不放图例和说明文字；悬停 / 聚焦出标准气泡「日期 · 上传 N 张 · N 张失效」。
// 键盘：整张日历一个 Tab 停留点，方向键按天 / 周移动，Enter 或空格筛到这一天，再按一次取消。
import { computed, nextTick, ref, watch } from 'vue';
import type { CalendarCell, CalendarYear } from '@/views/health/healthCalendar';
import { formatCount } from '@/utils/formatters';

const props = defineProps<{
  calendar: CalendarYear;
  /** 窄窗口：格子 9px、月份只标单数月 */
  narrow?: boolean;
  /** 选中的那一天（getDayKey） */
  picked?: string | null;
}>();

const emit = defineEmits<{ pick: [key: string] }>();

const WEEKDAYS = ['一', '', '三', '', '五', '', ''];

const root = ref<HTMLElement | null>(null);
const focusKey = ref<string | null>(null);
const tip = ref<{ text: string; x: number; y: number } | null>(null);

/** 能点的格子：这一年里、今天及以前（未来的格子透明，不能点） */
const cells = computed(() => props.calendar.weeks.flat().filter((c): c is CalendarCell => c !== null && !c.future));
/** Tab 停在：选中的那天 > 上次聚焦的那天 > 最近的一天 */
const tabKey = computed(() => {
  const keys = new Set(cells.value.map((c) => c.key));
  if (props.picked && keys.has(props.picked)) return props.picked;
  if (focusKey.value && keys.has(focusKey.value)) return focusKey.value;
  return cells.value.at(-1)?.key;
});

const months = computed(() => props.calendar.months.filter((m) => !props.narrow || m.month % 2 === 1));

function dateText(cell: CalendarCell): string {
  const d = new Date(cell.date);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function describe(cell: CalendarCell): string {
  return [dateText(cell), `上传 ${formatCount(cell.count)} 张`, cell.dead ? `${formatCount(cell.dead)} 张失效` : ''].filter(Boolean).join(' · ');
}

const summary = computed(() => {
  const total = cells.value.reduce((n, c) => n + c.count, 0);
  const dead = cells.value.reduce((n, c) => n + c.dead, 0);
  return `${props.calendar.year} 年按天的上传量，共 ${formatCount(total)} 张${dead ? `，${formatCount(dead)} 张失效，琥珀色为当天上传的图片中有失效` : ''}`;
});

function showTip(cell: CalendarCell, el: HTMLElement): void {
  const box = root.value?.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (!box) return;
  tip.value = { text: describe(cell), x: r.left - box.left + r.width / 2, y: r.top - box.top };
}

/** 键盘聚焦才出气泡；鼠标点完焦点留在格子上，移开后气泡不该一直挂着 */
function onFocus(cell: CalendarCell, el: HTMLElement): void {
  focusKey.value = cell.key;
  if (el.matches(':focus-visible')) showTip(cell, el);
}

function cellClass(cell: CalendarCell): Record<string, boolean> {
  return {
    [`upload-calendar__cell--lv${cell.level}`]: cell.bad === 0,
    'upload-calendar__cell--bad-soft': cell.bad === 1,
    'upload-calendar__cell--bad': cell.bad === 2,
    'upload-calendar__cell--picked': cell.key === props.picked,
  };
}

function cellEl(key: string): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(`[data-day="${key}"]`) ?? null;
}

function moveFocus(from: CalendarCell, days: number): void {
  const index = cells.value.findIndex((c) => c.key === from.key);
  const next = cells.value[Math.min(cells.value.length - 1, Math.max(0, index + days))];
  if (!next) return;
  focusKey.value = next.key;
  void nextTick(() => cellEl(next.key)?.focus());
}

function onKey(event: KeyboardEvent, cell: CalendarCell): void {
  const step: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1, Home: -366, End: 366 };
  if (event.key in step) {
    event.preventDefault();
    moveFocus(cell, step[event.key]);
  }
}

watch(() => props.calendar.year, () => { focusKey.value = null; tip.value = null; });
</script>

<template>
  <div ref="root" class="upload-calendar" :class="{ 'upload-calendar--narrow': narrow }" role="group" :aria-label="summary">
    <div class="upload-calendar__months" aria-hidden="true">
      <span v-for="m in months" :key="m.month" class="upload-calendar__month" :style="{ '--col': m.col }">{{ m.month }}月</span>
    </div>
    <div class="upload-calendar__body">
      <div class="upload-calendar__weekdays" aria-hidden="true">
        <span v-for="(w, i) in WEEKDAYS" :key="i" class="upload-calendar__weekday">{{ w }}</span>
      </div>
      <div class="upload-calendar__weeks" @mouseleave="tip = null">
        <div v-for="(week, col) in calendar.weeks" :key="col" class="upload-calendar__week">
          <template v-for="(cell, row) in week" :key="row">
            <button
              v-if="cell && !cell.future"
              type="button"
              class="upload-calendar__cell"
              :class="cellClass(cell)"
              :data-day="cell.key"
              :tabindex="cell.key === tabKey ? 0 : -1"
              :aria-label="describe(cell)"
              :aria-pressed="cell.key === picked"
              @mouseenter="showTip(cell, $event.currentTarget as HTMLElement)"
              @focus="onFocus(cell, $event.currentTarget as HTMLElement)"
              @blur="tip = null"
              @keydown="onKey($event, cell)"
              @click="emit('pick', cell.key)"
            />
            <span v-else class="upload-calendar__cell upload-calendar__cell--outside" aria-hidden="true" />
          </template>
        </div>
      </div>
    </div>
    <div v-if="tip" class="pn-tooltip upload-calendar__tip" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }" aria-hidden="true">{{ tip.text }}</div>
  </div>
</template>

<style scoped>
.upload-calendar {
  --cell: var(--pn-size-calendar-cell);
  --gap: var(--pn-space-calendar-cell-gap);
  --weekday: var(--pn-size-calendar-weekday);

  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-6);
}

.upload-calendar--narrow {
  --cell: var(--pn-size-calendar-cell-narrow);
  --gap: var(--pn-space-calendar-cell-gap-narrow);
  --weekday: var(--pn-size-calendar-weekday-narrow);
}

.upload-calendar__months {
  position: relative;
  height: var(--pn-size-calendar-month-row);
  margin-left: var(--weekday);
}

.upload-calendar__month {
  position: absolute;
  top: 0;
  left: calc(var(--col) * (var(--cell) + var(--gap)));
  font-size: var(--pn-text-caption);
  line-height: var(--pn-size-calendar-month-row);
  color: var(--pn-text3);
  white-space: nowrap;
}

.upload-calendar__body { display: flex; }

.upload-calendar__weekdays {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--gap);
  width: var(--weekday);
}

.upload-calendar__weekday {
  height: var(--cell);
  font-size: var(--pn-size-calendar-weekday-text);
  line-height: var(--cell);
  color: var(--pn-text3);
}

.upload-calendar__weeks { display: flex; gap: var(--gap); }
.upload-calendar__week { display: flex; flex-direction: column; gap: var(--gap); }

.upload-calendar__cell {
  display: block;
  width: var(--cell);
  height: var(--cell);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-calendar-cell);
  background: var(--pn-cell-empty);
  cursor: pointer;
}

.upload-calendar--narrow .upload-calendar__cell { border-radius: var(--pn-radius-calendar-cell-narrow); }
.upload-calendar__cell--lv1 { background: var(--pn-cell-lv1); }
.upload-calendar__cell--lv2 { background: var(--pn-cell-lv2); }
.upload-calendar__cell--lv3 { background: var(--pn-cell-lv3); }
.upload-calendar__cell--lv4 { background: var(--pn-cell-lv4); }
.upload-calendar__cell--bad-soft { background: var(--pn-cell-bad-soft); }
.upload-calendar__cell--bad { background: var(--pn-cell-bad); }

.upload-calendar__cell--outside {
  background: transparent;
  cursor: default;
}

.upload-calendar__cell--picked { box-shadow: var(--pn-calendar-pick-ring); }

.upload-calendar__cell:focus-visible {
  outline: var(--pn-ring-width) solid var(--pn-ring);
  outline-offset: var(--pn-ring-offset);
}

.upload-calendar__tip {
  position: absolute;
  z-index: var(--pn-z-tooltip);
  pointer-events: none;
  transform: translate(-50%, calc(-100% - var(--pn-space-6)));
}
</style>
