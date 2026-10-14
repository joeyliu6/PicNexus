<script setup lang="ts">
/**
 * 链接检测的图片列表：按类分段（能改用备份 / 打不开 / 可能受限 / 备份失效 …），
 * 所有行共用一个「⋯」菜单。只渲染当前页（≤100 行），每行的白话说明在这里按最新结果现算。
 */
import { computed, ref } from 'vue';
import Menu from 'primevue/menu';
import type { MenuItem } from 'primevue/menuitem';
import CheckImageRow from './CheckImageRow.vue';
import {
  describeImage,
  effectiveResult,
  linkVerdict,
  promoteTarget,
  type ImageDescription,
  type ImageEntry,
  type ImageKind,
} from '@/composables/link-check/imageHealth';
import type { LinkCheckRow } from '@/types/linkCheck';

export interface ListEmptyState {
  icon: string;
  title: string;
  description?: string;
  actionLabel?: string;
}

const props = defineProps<{
  entries: ImageEntry[];
  kindOf: (entry: ImageEntry) => ImageKind;
  sectioned: boolean;
  sectionCounts: Record<ImageKind, number>;
  nameOf: (serviceId: string) => string;
  thumbSrcsOf: (entry: ImageEntry) => string[];
  isChecking: boolean;
  actionLocked: boolean;
  copiedId: string | null;
  emptyState: ListEmptyState | null;
  totalPages: number;
  confirmedHttpHosts?: ReadonlySet<string>;
}>();

const page = defineModel<number>('page', { required: true });

const emit = defineEmits<{
  promote: [entry: ImageEntry, serviceId: string];
  recheck: [entry: ImageEntry];
  copy: [entry: ImageEntry];
  remove: [entry: ImageEntry, rows: LinkCheckRow[]];
  'empty-action': [];
}>();

const SECTION_LABEL: Record<ImageKind, string> = {
  fixable: '能改用备份',
  broken: '打不开',
  limited: '可能受限',
  'backup-broken': '备份失效（不影响显示）',
  unchecked: '还没检查',
  ok: '能正常打开',
};

interface ListItem {
  entry: ImageEntry;
  /** 这一行前面要不要先放一个分段标题 */
  section: ImageKind | null;
  description: ImageDescription;
  promoteName: string | null;
  canRetry: boolean;
  rechecking: boolean;
}

function failedRows(entry: ImageEntry): LinkCheckRow[] {
  return entry.rows.filter((r) => {
    const verdict = linkVerdict(effectiveResult(r));
    return verdict === 'gone' || verdict === 'failing';
  });
}

function isRechecking(entry: ImageEntry): boolean {
  return entry.rows.some((r) => r.recheckLoading);
}

/** 只有「可能是暂时的」打不开才值得重试；404 重试多少次也一样 */
function canRetry(entry: ImageEntry, description: ImageDescription): boolean {
  const primary = entry.rows[0];
  return description.kind === 'broken' && !!primary && linkVerdict(effectiveResult(primary)) === 'failing';
}

const items = computed<ListItem[]>(() => {
  let previous: ImageKind | null = null;
  return props.entries.map((entry) => {
    let section: ImageKind | null = null;
    if (props.sectioned) {
      const kind = props.kindOf(entry);
      if (kind !== previous) section = kind;
      previous = kind;
    }
    const description = describeImage(entry, props.nameOf);
    const target = promoteTarget(entry);
    return {
      entry,
      section,
      description,
      promoteName: target ? props.nameOf(target.serviceId) : null,
      canRetry: canRetry(entry, description),
      rechecking: isRechecking(entry),
    };
  });
});

function handlePromote(entry: ImageEntry): void {
  const target = promoteTarget(entry);
  if (target) emit('promote', entry, target.serviceId);
}

// ---- 共用的「⋯」菜单 ----

const menuRef = ref<InstanceType<typeof Menu> | null>(null);
const menuEntry = ref<ImageEntry | null>(null);

const menuItems = computed<MenuItem[]>(() => {
  const entry = menuEntry.value;
  if (!entry) return [];
  const busy = props.isChecking || props.actionLocked || isRechecking(entry);
  const failed = failedRows(entry);
  const menu: MenuItem[] = [
    { label: '复制链接', icon: 'pi pi-copy', command: () => emit('copy', entry) },
    { label: '重新检查', icon: 'pi pi-refresh', disabled: busy, command: () => emit('recheck', entry) },
  ];
  if (failed.length > 0) {
    menu.push({ separator: true });
    menu.push({
      label: failed.length === entry.rows.length ? '从记录中移除这张图' : `移除失效的 ${failed.length} 个链接`,
      icon: 'pi pi-trash',
      class: 'menu-item-danger',
      disabled: busy,
      command: () => emit('remove', entry, failed),
    });
  }
  return menu;
});

function openMenu(entry: ImageEntry, event: MouseEvent): void {
  menuEntry.value = entry;
  menuRef.value?.toggle(event);
}
</script>

<template>
  <div class="image-list">
    <div v-if="entries.length === 0 && emptyState" class="list-empty">
      <i :class="emptyState.icon" class="list-empty-icon" aria-hidden="true"></i>
      <p class="list-empty-title">{{ emptyState.title }}</p>
      <p v-if="emptyState.description" class="list-empty-desc">{{ emptyState.description }}</p>
      <button v-if="emptyState.actionLabel" type="button" class="list-empty-action" @click="emit('empty-action')">
        {{ emptyState.actionLabel }}
      </button>
    </div>

    <template v-else>
      <template v-for="item in items" :key="item.entry.historyId">
        <div v-if="item.section" class="list-section">
          <span>{{ SECTION_LABEL[item.section] }}</span>
          <span class="list-section-count">{{ sectionCounts[item.section].toLocaleString() }}</span>
        </div>
        <CheckImageRow
          :entry="item.entry"
          :description="item.description"
          :thumb-srcs="thumbSrcsOf(item.entry)"
          :promote-name="item.promoteName"
          :can-retry="item.canRetry"
          :rechecking="item.rechecking"
          :copied="copiedId === item.entry.historyId"
          :disabled="isChecking || actionLocked"
          :confirmed-http-hosts="confirmedHttpHosts"
          @promote="handlePromote(item.entry)"
          @recheck="emit('recheck', item.entry)"
          @more="openMenu(item.entry, $event)"
        />
      </template>

      <div v-if="totalPages > 1" class="list-pager">
        <button type="button" class="pager-btn" :disabled="page <= 1" aria-label="上一页" @click="page--">
          <i class="pi pi-chevron-left" aria-hidden="true"></i>
        </button>
        <span class="pager-info">{{ page }} / {{ totalPages }}</span>
        <button type="button" class="pager-btn" :disabled="page >= totalPages" aria-label="下一页" @click="page++">
          <i class="pi pi-chevron-right" aria-hidden="true"></i>
        </button>
      </div>
    </template>

    <Menu ref="menuRef" :model="menuItems" popup append-to="body" />
  </div>
</template>

<style scoped>
.image-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.list-section {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-sm) var(--space-xs);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
}

.list-section:first-child {
  padding-top: var(--space-xs);
}

.list-section-count {
  font-weight: var(--weight-regular);
  color: var(--text-tertiary);
}

.list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-4xl) var(--space-xl);
  text-align: center;
}

.list-empty-icon {
  font-size: var(--text-3xl);
  color: var(--text-disabled);
  margin-bottom: var(--space-xs);
}

.list-empty-title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
}

.list-empty-desc {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.list-empty-action {
  margin-top: var(--space-sm);
  padding: 0;
  border: none;
  background: none;
  color: var(--primary);
  font-family: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.list-empty-action:hover {
  text-decoration: underline;
}

.list-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-md) 0 var(--space-xs);
}

.pager-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm-md);
  background: var(--bg-input);
  color: var(--text-muted);
  cursor: pointer;
}

.pager-btn:hover:not(:disabled) {
  background: var(--hover-overlay);
  color: var(--text-main);
}

.pager-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pager-info {
  min-width: 56px;
  text-align: center;
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
