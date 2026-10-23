<script setup lang="ts">
// 图床页左栏（HostsScreen.dc.html、P01 / P14）：标题「图床」+「＋」；只列已添加的图床，有问题的 → 已启用的 → 停用的。
// 正常时不打标记；停用的整行变淡、第二行「已停用」；有问题的第二行琥珀 ⚠ + 原因。
// 悬停一行右侧浮出「启用 / 停用」；右键菜单同一个动作；键盘 ↑↓ 换行、空格切换、Enter 打开。
import { computed, nextTick, ref } from 'vue';
import HostIcon from '@/components/biz/HostIcon.vue';
import PnContextMenu from '@/components/pn/PnContextMenu.vue';
import PnContextMenuItem from '@/components/pn/PnContextMenuItem.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import TransferButton from '@/shell/TransferButton.vue';
import WindowControls from '@/shell/WindowControls.vue';
import type { HostRow } from './hostList';

const props = defineProps<{
  rows: readonly HostRow[];
  /** 选中的那一行（窄窗口第一级不画选中） */
  selectedId: string | null;
  /** 右侧是目录 / 连接表单：「＋」按下态 */
  adding: boolean;
  /** 窄窗口第一级：清单占满主栏，标题行带窗口按钮 */
  listOnly: boolean;
}>();

const emit = defineEmits<{ select: [id: string]; add: []; toggle: [id: string] }>();

// 指针在清单里时先不重排：点「停用」后那一行若立刻挪走，浮出的按钮会落到另一个图床上，再点一下就停错了。
// 离开清单再按「有问题 → 已启用 → 停用」排好。
const frozenOrder = ref<string[] | null>(null);
const shownRows = computed(() => {
  const order = frozenOrder.value;
  if (!order) return props.rows;
  const rank = (id: string) => { const i = order.indexOf(id); return i === -1 ? order.length : i; };
  return [...props.rows].sort((a, b) => rank(a.id) - rank(b.id));
});
function freezeOrder(): void { frozenOrder.value = props.rows.map((r) => r.id); }
function releaseOrder(): void { frozenOrder.value = null; }

// 按行号记：v-for 在插槽里，普通的 ref 数组顺序跟排序后的行对不上
const rowRefs = ref<Array<HTMLElement | null>>([]);

function focusRow(index: number): void {
  const clamped = Math.max(0, Math.min(shownRows.value.length - 1, index));
  void nextTick(() => rowRefs.value[clamped]?.focus());
}

function onKeydown(event: KeyboardEvent, index: number, row: HostRow): void {
  if (event.key === 'ArrowDown') { event.preventDefault(); focusRow(index + 1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); focusRow(index - 1); }
  else if (event.key === 'Home') { event.preventDefault(); focusRow(0); }
  else if (event.key === 'End') { event.preventDefault(); focusRow(shownRows.value.length - 1); }
  else if (event.key === ' ') { event.preventDefault(); emit('toggle', row.id); }
  else if (event.key === 'Enter') { event.preventDefault(); emit('select', row.id); }
}

/** 整个清单一个 Tab 停留点：选中的那行，没有就第一行 */
function tabIndexOf(row: HostRow, index: number): number {
  const anchor = props.rows.some((r) => r.id === props.selectedId) ? props.selectedId : props.rows[0]?.id;
  return row.id === anchor || (!anchor && index === 0) ? 0 : -1;
}
</script>

<template>
  <div class="hosts-list" :class="{ 'hosts-list--only': listOnly }">
    <div class="hosts-list__head" data-tauri-drag-region>
      <h1 class="hosts-list__title" data-tauri-drag-region>图床</h1>
      <div class="hosts-list__spacer" data-tauri-drag-region />
      <button
        type="button"
        class="hosts-list__add"
        :class="{ 'hosts-list__add--on': adding }"
        aria-label="添加图床"
        title="添加图床"
        @click="emit('add')"
      >
        <PnIcon name="plus" :size="15" />
      </button>
      <template v-if="listOnly">
        <TransferButton />
        <WindowControls />
      </template>
    </div>
    <div class="hosts-list__rows" role="listbox" aria-label="已连接的图床" @pointerenter="freezeOrder" @pointerleave="releaseOrder">
      <PnContextMenu v-for="(row, index) in shownRows" :key="row.id">
        <template #trigger>
          <div
            :ref="(el) => { rowRefs[index] = el as HTMLElement | null; }"
            role="option"
            class="hosts-list__row"
            :class="{
              'hosts-list__row--selected': !listOnly && row.id === selectedId,
              'hosts-list__row--off': !row.enabled,
            }"
            :aria-selected="!listOnly && row.id === selectedId"
            :tabindex="tabIndexOf(row, index)"
            @click="emit('select', row.id)"
            @keydown="onKeydown($event, index, row)"
          >
            <span class="hosts-list__plate"><HostIcon :host="row.id" :name="row.name" :size="17" /></span>
            <span class="hosts-list__text">
              <span class="hosts-list__name">{{ row.name }}</span>
              <span class="hosts-list__sub" :class="{ 'hosts-list__sub--bad': row.problem && !row.testing }">
                <PnIcon v-if="row.problem && !row.testing" name="warning" :size="12" />{{ row.sub }}
              </span>
            </span>
            <button
              type="button"
              class="hosts-list__toggle"
              tabindex="-1"
              @click.stop="emit('toggle', row.id)"
            >
              {{ row.enabled ? '停用' : '启用' }}
            </button>
          </div>
        </template>
        <PnContextMenuItem @select="emit('toggle', row.id)">{{ row.enabled ? '停用' : '启用' }}</PnContextMenuItem>
      </PnContextMenu>
    </div>
  </div>
</template>

<style scoped>
.hosts-list {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--pn-space-2);
  width: var(--pn-size-host-list);
  box-sizing: border-box;
  padding: var(--pn-space-host-list);
  border-right: 1px solid var(--pn-border);
  overflow: hidden;
}

.hosts-list--only {
  width: 100%;
  border-right: 0;
}

.hosts-list__head {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-4);
  height: var(--pn-size-title-bar);
  margin: var(--pn-space-host-list-head);
  padding-left: var(--pn-space-8);
  user-select: none;
}

.hosts-list__title {
  margin: 0;
  font-size: var(--pn-text-headline);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-headline);
  letter-spacing: var(--pn-tracking-headline);
}

.hosts-list__spacer { flex: 1; align-self: stretch; }

.hosts-list__add {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-icon-button);
  height: var(--pn-size-icon-button);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in), color var(--pn-dur-instant) var(--pn-ease-in);
}

.hosts-list__add:hover { background: var(--pn-ghost-hover); }
.hosts-list__add:active { background: var(--pn-ghost-press); }

.hosts-list__add--on,
.hosts-list__add--on:hover,
.hosts-list__add--on:active { background: var(--pn-brand-soft); color: var(--pn-brand-text); }

.hosts-list__rows {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-2);
  min-height: 0;
  overflow-y: auto;
}

.hosts-list__row {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-host-row-gap);
  height: var(--pn-size-host-row);
  padding: var(--pn-space-host-row);
  border-radius: var(--pn-radius-host-row);
  cursor: pointer;
  outline-offset: -2px;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.hosts-list__row:hover { background: var(--pn-host-row-hover); }

.hosts-list__row--selected,
.hosts-list__row--selected:hover { background: var(--pn-selected); }

.hosts-list__plate {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-host-plate);
  height: var(--pn-size-host-plate);
  border-radius: var(--pn-radius-md);
  background: var(--pn-canvas);
  box-shadow: 0 0 0 1px var(--pn-hairline);
  color: var(--pn-text1);
}

.hosts-list__row--off .hosts-list__plate,
.hosts-list__row--off .hosts-list__name { color: var(--pn-text3); }

.hosts-list__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: var(--pn-leading-host-row);
}

.hosts-list__name {
  overflow: hidden;
  font-weight: var(--pn-weight-medium);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hosts-list__sub {
  display: flex;
  align-items: center;
  gap: var(--pn-space-4);
  overflow: hidden;
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.hosts-list__sub--bad { color: var(--pn-warning); }

/* 悬停才浮出的「启用 / 停用」：一直占着位置（名字的截断不随悬停变），只是看不见；淡入淡出 */
.hosts-list__toggle {
  flex: none;
  height: var(--pn-size-pill);
  padding: 0 var(--pn-space-button-sm-x);
  border: 0;
  border-radius: calc(var(--pn-size-pill) / 2);
  background: var(--pn-canvas);
  box-shadow: 0 0 0 1px var(--pn-border);
  color: var(--pn-brand-text);
  font: inherit;
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--pn-dur-instant) var(--pn-ease-in), visibility var(--pn-dur-instant), background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.hosts-list__row:hover .hosts-list__toggle,
.hosts-list__row:focus-visible .hosts-list__toggle { opacity: 1; visibility: visible; }

.hosts-list__toggle:hover { background: var(--pn-secondary-hover); }
.hosts-list__toggle:active { background: var(--pn-secondary-press); }
</style>
