<script setup lang="ts">
/**
 * 补充备份的「更多选项」：默认收起，大多数人用不到
 *
 * 只备份某些图床上的图 / 最近上传的 / 备份少的，以及「只补已经坏了一份的」。
 * 设过任何一项时，标题上写出「已设：……」，免得用户忘了自己设过、对着数字发懵。
 */
import { computed, ref } from 'vue';
import ServiceLogo from '@/components/common/ServiceLogo.vue';
import type { MigrateScope } from '@/types/batchMigrate';

const DAY_MS = 86_400_000;

const props = defineProps<{
  sources: Array<{ id: string; displayName: string; count: number }>;
  selectedSources: string[];
  timestampAfterMs: number | null;
  maxSuccessCount: number;
  scope: MigrateScope;
  /** 已设条件的白话（migrateFilterNote）；没设为 null */
  note: string | null;
}>();

const emit = defineEmits<{
  'update:selectedSources': [ids: string[]];
  'update:timestampAfterMs': [value: number | null];
  'update:maxSuccessCount': [value: number];
  'update:scope': [value: MigrateScope];
}>();

const open = ref(false);

const TIME_OPTIONS: Array<{ days: number | null; label: string }> = [
  { days: null, label: '不限' },
  { days: 7, label: '最近 7 天' },
  { days: 30, label: '最近 30 天' },
  { days: 90, label: '最近 3 个月' },
  { days: 365, label: '最近 1 年' },
];

/** 数据库条件是「图片目前存在的图床数 ≤ N」 */
const COPY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 999, label: '不限' },
  { value: 1, label: '只有 1 份的' },
  { value: 2, label: '不超过 2 份的' },
  { value: 3, label: '不超过 3 份的' },
];

const SCOPE_OPTIONS: Array<{ value: MigrateScope; label: string; tooltip: string }> = [
  { value: 'all-backups', label: '所有还没存过去的', tooltip: '目标图床上还没有的图片都复制一份' },
  {
    value: 'broken-with-valid-source',
    label: '只补已经坏了一份的',
    tooltip: '只处理链接检测发现某一份已经打不开、但别的图床还有好的那些：从好的那份复制过去。依据最近一次链接检测的结果',
  },
];

const selectedDays = computed<number | null>(() => {
  if (props.timestampAfterMs === null) return null;
  const days = Math.round((Date.now() - props.timestampAfterMs) / DAY_MS);
  return TIME_OPTIONS.find((o) => o.days === days)?.days ?? null;
});

const allSelected = computed(() => props.sources.length > 0 && props.selectedSources.length === props.sources.length);

function toggleSource(id: string): void {
  const next = props.selectedSources.includes(id)
    ? props.selectedSources.filter((s) => s !== id)
    : [...props.selectedSources, id];
  emit('update:selectedSources', next);
}

function toggleAllSources(): void {
  emit('update:selectedSources', allSelected.value ? [] : props.sources.map((s) => s.id));
}

function pickDays(days: number | null): void {
  emit('update:timestampAfterMs', days === null ? null : Date.now() - days * DAY_MS);
}

function resetAll(): void {
  emit('update:selectedSources', props.sources.map((s) => s.id));
  emit('update:timestampAfterMs', null);
  emit('update:maxSuccessCount', 999);
  emit('update:scope', 'all-backups');
}
</script>

<template>
  <section class="migrate-options" :class="{ 'is-open': open }">
    <button type="button" class="options-toggle" :aria-expanded="open" @click="open = !open">
      <i class="pi pi-chevron-right options-caret" aria-hidden="true"></i>
      <span class="options-title">更多选项</span>
      <span v-if="note" class="options-note">已设：{{ note }}</span>
      <span v-else class="options-hint">只备份某些图床上的图、最近上传的、备份少的</span>
    </button>

    <div v-if="open" class="options-body">
      <div class="option-row">
        <span class="option-label">来源图床</span>
        <div class="option-choices">
          <button
            v-for="src in sources"
            :key="src.id"
            type="button"
            class="choice choice--source"
            :class="{ active: selectedSources.includes(src.id) }"
            :aria-pressed="selectedSources.includes(src.id)"
            @click="toggleSource(src.id)"
          >
            <ServiceLogo :service-id="src.id" class="choice-logo" />
            <span class="choice-name">{{ src.displayName }}</span>
            <span class="choice-count">{{ src.count.toLocaleString() }}</span>
          </button>
          <button v-if="sources.length > 1" type="button" class="link-btn" @click="toggleAllSources">
            {{ allSelected ? '清空' : '全选' }}
          </button>
        </div>
      </div>

      <div class="option-row">
        <span class="option-label">上传时间</span>
        <div class="option-choices">
          <button
            v-for="o in TIME_OPTIONS"
            :key="String(o.days)"
            type="button"
            class="choice"
            :class="{ active: selectedDays === o.days }"
            :aria-pressed="selectedDays === o.days"
            @click="pickDays(o.days)"
          >
            {{ o.label }}
          </button>
        </div>
      </div>

      <div class="option-row">
        <span class="option-label">备份情况</span>
        <div class="option-choices">
          <button
            v-for="o in COPY_OPTIONS"
            :key="o.value"
            type="button"
            class="choice"
            :class="{ active: maxSuccessCount === o.value }"
            :aria-pressed="maxSuccessCount === o.value"
            @click="emit('update:maxSuccessCount', o.value)"
          >
            {{ o.label }}
          </button>
        </div>
      </div>

      <div class="option-row">
        <span class="option-label">补哪些</span>
        <div class="option-choices">
          <button
            v-for="o in SCOPE_OPTIONS"
            :key="o.value"
            type="button"
            class="choice"
            :class="{ active: scope === o.value }"
            :aria-pressed="scope === o.value"
            v-tooltip.top="o.tooltip"
            @click="emit('update:scope', o.value)"
          >
            {{ o.label }}
          </button>
        </div>
      </div>

      <button v-if="note" type="button" class="link-btn options-reset" @click="resetAll">恢复默认</button>
    </div>
  </section>
</template>

<style scoped>
.migrate-options {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-sm);
}

.options-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  min-width: 0;
  padding: var(--space-xs) 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}

.options-toggle:hover .options-title {
  color: var(--text-main);
}

.options-caret {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
  transition: transform var(--duration-fast) var(--ease-standard);
}

.is-open .options-caret {
  transform: rotate(90deg);
}

.options-title {
  flex-shrink: 0;
  font-weight: var(--weight-medium);
}

.options-hint,
.options-note {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.options-note {
  color: var(--primary);
}

.options-body {
  /* 左边标签列的宽度：选项与「恢复默认」都按它对齐 */
  --option-label-width: 64px;

  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-sm) 0 var(--space-xs) var(--space-lg);
}

.option-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-md);
}

.option-label {
  flex: 0 0 var(--option-label-width);
  padding-top: var(--space-xs);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.option-choices {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs-sm);
  min-width: 0;
}

.choice {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  height: 26px;
  padding: 0 var(--space-sm-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  transition: background var(--duration-fast), border-color var(--duration-fast), color var(--duration-fast);
}

.choice:hover {
  border-color: var(--primary-alpha-30);
}

.choice.active {
  border-color: var(--primary-alpha-30);
  background: var(--primary-alpha-10);
  color: var(--primary);
}

.choice-logo {
  display: inline-flex;
  width: 12px;
  height: 12px;
  font-size: var(--text-2xs);
}

/* 120px 见 docs/design/tokens.md#service-name-truncation */
.choice-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-count {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.link-btn {
  padding: 0 var(--space-xs);
  border: none;
  background: none;
  color: var(--primary);
  font-family: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}

.link-btn:hover {
  text-decoration: underline;
}

.options-reset {
  align-self: flex-start;
  margin-left: calc(var(--option-label-width) + var(--space-md) - var(--space-xs));
}
</style>
