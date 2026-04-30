<script setup lang="ts">
/**
 * 批量迁移 — 高级筛选 Popover
 *
 * 由「从这里」栏目标签右侧的滑块图标触发，聚合两类精细化筛选：
 * - 备份数阈值（segment 4 预设 + 内嵌自定义输入 1-20）
 * - 上传时间范围（segment 4 预设 + 内嵌自定义最近 N 天，N 1-1095）
 *
 * Segment 内最后一项是输入框，视觉和按钮融合；单位（"个" / "天"）紧随 segment 右侧。
 */
import { computed, ref } from 'vue';
import Popover from 'primevue/popover';
import type PopoverType from 'primevue/popover';
import { filterThresholds, timestampRangePresets } from '../utils';
import type { MigrateScope } from '../../../../../types/batchMigrate';

const DAY_MS = 86400_000;
const CUSTOM_COUNT_MAX = 20;
const CUSTOM_DAYS_MAX = 1095; // 3 年
const ALL_SCOPE_LABEL = '所有缺失备份';
const RECOVERY_SCOPE_LABEL = '可恢复图片';
const ALL_SCOPE_TOOLTIP = '为符合条件、但目标图床还没有备份的图片补传一份。';
const RECOVERY_SCOPE_TOOLTIP = '只处理检测到失效链接、且仍有其他可用链接的图片。迁移时会优先使用可用链接。依据最近一次已保存的链接检测结果。';

// 弹层内只显示 4 个预设，为内嵌输入框腾空间。
// 被砍的项（备份数 2、时间 90 天）仍保留在 filterThresholds/timestampRangePresets 里，
// 供徽章反推 label 与 selectedRangeMs 容差匹配使用。
const displayedThresholds = filterThresholds.filter(opt => opt.value !== 2);
const displayedRangePresets = timestampRangePresets.filter(p => p.value !== 90 * DAY_MS);

interface Props {
  maxSuccessCount: number;
  timestampAfterMs: number | null;
  migrateScope: MigrateScope;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:maxSuccessCount': [value: number];
  'update:timestampAfterMs': [value: number | null];
  'update:migrateScope': [value: MigrateScope];
}>();

const popoverRef = ref<InstanceType<typeof PopoverType> | null>(null);

function toggle(event: Event) {
  popoverRef.value?.toggle(event);
}

/**
 * 时间范围按钮绑定的是"距今多少毫秒"（可 null），
 * 与 composable 里的绝对时间戳 timestampAfterMs 解耦，选中后再换算。
 */
const selectedRangeMs = computed<number | null>(() => {
  if (props.timestampAfterMs === null) return null;
  const deltaMs = Date.now() - props.timestampAfterMs;
  // 匹配最近的预设（容差 1 天以内），否则回落 null 表示"自定义"
  const match = timestampRangePresets.find(
    p => p.value !== null && Math.abs(p.value - deltaMs) < DAY_MS,
  );
  return match?.value ?? null;
});

function onRangeChange(value: number | null) {
  emit('update:timestampAfterMs', value === null ? null : Date.now() - value);
}

/**
 * 弹层内按钮标签用短形式（不限/7 天/30 天/1 年），
 * 让按钮均分后密度与数字行接近；徽章仍保留长标签作为完整语境。
 */
function toShortRangeLabel(label: string): string {
  if (label === '全部时间') return '不限';
  return label.replace(/^最近\s*/, '');
}

/**
 * 自定义备份数：当前值不在显示预设里 → 认为是自定义
 * 注意基于 displayedThresholds（4 项），所以 value=2 也会被视作自定义
 */
const isCustomCount = computed(
  () => !displayedThresholds.some(opt => opt.value === props.maxSuccessCount),
);

function onCustomCountInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const raw = target.value.trim();
  if (raw === '') return; // 清空不动作，避免把值改成 1
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return;
  const n = Math.max(1, Math.min(CUSTOM_COUNT_MAX, parsed));
  emit('update:maxSuccessCount', n);
}

/**
 * 自定义时间天数：timestampAfterMs 非 null 且不匹配任何显示预设 → 反推天数
 */
const isCustomRange = computed(() => {
  if (props.timestampAfterMs === null) return false;
  return !displayedRangePresets.some(p => p.value === selectedRangeMs.value);
});

const customDays = computed<number | null>(() => {
  if (!isCustomRange.value || props.timestampAfterMs === null) return null;
  const delta = Date.now() - props.timestampAfterMs;
  return Math.max(1, Math.round(delta / DAY_MS));
});

function onCustomDaysInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const raw = target.value.trim();
  if (raw === '') return;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return;
  const n = Math.max(1, Math.min(CUSTOM_DAYS_MAX, parsed));
  emit('update:timestampAfterMs', Date.now() - n * DAY_MS);
}

/**
 * 徽章文案：仅当任一维度非默认时显示
 * - maxSuccessCount ≠ 999
 * - timestampAfterMs ≠ null
 * 被砍的预设（"2"、"最近 3 个月"）仍走完整 filterThresholds/timestampRangePresets 反推 label
 */
const badgeTokens = computed<string[]>(() => {
  const tokens: string[] = [];
  if (props.migrateScope === 'broken-with-valid-source') tokens.push(RECOVERY_SCOPE_LABEL);
  if (props.maxSuccessCount !== 999) tokens.push(`<${props.maxSuccessCount}`);
  if (props.timestampAfterMs !== null) {
    if (selectedRangeMs.value !== null) {
      const preset = timestampRangePresets.find(p => p.value === selectedRangeMs.value);
      tokens.push(preset?.label ?? '限时');
    } else if (customDays.value !== null) {
      tokens.push(`最近 ${customDays.value} 天`);
    }
  }
  return tokens;
});

const hasActiveFilter = computed(() => badgeTokens.value.length > 0);
const badgeText = computed(() => badgeTokens.value.join(' · '));
const triggerTooltip = computed(() =>
  hasActiveFilter.value ? `当前筛选：${badgeText.value}` : '设置处理范围、备份数量和上传时间',
);
</script>

<template>
  <button
    type="button"
    class="filter-trigger"
    :class="{ 'filter-trigger--active': hasActiveFilter }"
    :aria-label="hasActiveFilter ? `迁移筛选：${badgeText}` : '迁移筛选'"
    v-tooltip.top="triggerTooltip"
    @click="toggle"
  >
    <i class="pi pi-sliders-h filter-trigger-icon" />
    <span v-if="hasActiveFilter" class="filter-trigger-badge">{{ badgeText }}</span>
  </button>

  <Popover ref="popoverRef">
    <div class="filter-popover">
      <section class="filter-section">
        <label class="filter-label">处理范围</label>
        <div class="filter-segment filter-segment--scope" role="radiogroup" aria-label="处理范围">
          <button
            type="button"
            class="filter-segment-item"
            :class="{ 'is-active': migrateScope === 'all-backups' }"
            role="radio"
            :aria-checked="migrateScope === 'all-backups'"
            v-tooltip.top="ALL_SCOPE_TOOLTIP"
            @click="emit('update:migrateScope', 'all-backups')"
          >
            {{ ALL_SCOPE_LABEL }}
          </button>
          <button
            type="button"
            class="filter-segment-item"
            :class="{ 'is-active': migrateScope === 'broken-with-valid-source' }"
            role="radio"
            :aria-checked="migrateScope === 'broken-with-valid-source'"
            v-tooltip.top="RECOVERY_SCOPE_TOOLTIP"
            @click="emit('update:migrateScope', 'broken-with-valid-source')"
          >
            {{ RECOVERY_SCOPE_LABEL }}
          </button>
        </div>
      </section>

      <section class="filter-section">
        <label class="filter-label">备份数少于</label>
        <div class="filter-row">
          <div class="filter-segment" role="radiogroup" aria-label="备份数阈值">
            <button
              v-for="opt in displayedThresholds"
              :key="opt.value"
              type="button"
              class="filter-segment-item"
              :class="{ 'is-active': maxSuccessCount === opt.value }"
              role="radio"
              :aria-checked="maxSuccessCount === opt.value"
              @click="emit('update:maxSuccessCount', opt.value)"
            >
              {{ opt.label }}
            </button>
            <input
              type="number"
              class="filter-segment-input"
              :class="{ 'is-active': isCustomCount }"
              inputmode="numeric"
              :min="1"
              :max="CUSTOM_COUNT_MAX"
              :value="isCustomCount ? maxSuccessCount : ''"
              placeholder="自定义"
              aria-label="自定义备份数阈值（1–20）"
              @input="onCustomCountInput"
            />
          </div>
          <span class="filter-unit">个</span>
        </div>
      </section>

      <section class="filter-section">
        <label class="filter-label">上传时间范围</label>
        <div class="filter-row">
          <div class="filter-segment" role="radiogroup" aria-label="上传时间范围">
            <button
              v-for="preset in displayedRangePresets"
              :key="String(preset.value)"
              type="button"
              class="filter-segment-item"
              :class="{ 'is-active': selectedRangeMs === preset.value }"
              role="radio"
              :aria-checked="selectedRangeMs === preset.value"
              @click="onRangeChange(preset.value)"
            >
              {{ toShortRangeLabel(preset.label) }}
            </button>
            <input
              type="number"
              class="filter-segment-input"
              :class="{ 'is-active': isCustomRange }"
              inputmode="numeric"
              :min="1"
              :max="CUSTOM_DAYS_MAX"
              :value="customDays ?? ''"
              placeholder="自定义"
              aria-label="自定义上传时间天数（1–1095）"
              @input="onCustomDaysInput"
            />
          </div>
          <span class="filter-unit">天</span>
        </div>
      </section>
    </div>
  </Popover>
</template>

<style scoped>
.filter-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  height: 24px;
  padding: 0 var(--space-xs-sm);
  border: none;
  border-radius: var(--radius-sm-md);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--text-xs);
  cursor: pointer;
  transition:
    background var(--duration-normal) var(--ease-decelerate),
    color var(--duration-normal) var(--ease-decelerate);
}

.filter-trigger:hover {
  background: var(--hover-overlay-subtle);
  color: var(--text-secondary);
}

.filter-trigger:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 1px;
}

.filter-trigger--active {
  background: var(--primary-alpha-8);
  color: var(--primary);
}

.filter-trigger--active:hover {
  background: var(--primary-alpha-15);
  color: var(--primary);
}

.filter-trigger-icon {
  font-size: var(--text-sm);
  line-height: 1;
}

.filter-trigger-badge {
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}

.filter-popover {
  display: flex;
  flex-direction: column;
  gap: var(--space-md-lg);
  min-width: 300px;
  max-width: 340px;
  padding: var(--space-sm) var(--space-sm-md);
}

.filter-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.filter-label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
}

.filter-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.filter-segment {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: var(--space-2xs);
  padding: var(--space-2xs);
  border-radius: var(--radius-sm-md);
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
}

.filter-segment-item {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 var(--space-xs-sm);
  border: none;
  border-radius: calc(var(--radius-sm-md) - var(--space-2xs));
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--weight-normal);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.filter-segment-item:hover:not(.is-active) {
  background: var(--hover-overlay-subtle);
  color: var(--text-primary);
}

.filter-segment-item:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 1px;
}

.filter-segment-item.is-active {
  background: var(--primary-alpha-10);
  color: var(--primary);
  font-weight: var(--weight-medium);
}

.filter-segment-input {
  flex: 1.3;
  min-width: 0;
  height: 26px;
  padding: 0 var(--space-xs-sm);
  border: none;
  border-radius: calc(var(--radius-sm-md) - var(--space-2xs));
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  text-align: center;
  cursor: text;
  transition:
    background var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard);
}

.filter-segment-input::placeholder {
  color: var(--text-muted);
}

/* focus 后隐藏 placeholder，避免 caret 和"自定义"字样重叠 */
.filter-segment-input:focus::placeholder {
  color: transparent;
}

.filter-segment-input::-webkit-inner-spin-button,
.filter-segment-input::-webkit-outer-spin-button {
  display: none;
  margin: 0;
}

.filter-segment-input:hover:not(.is-active, :focus) {
  background: var(--hover-overlay-subtle);
  color: var(--text-primary);
}

.filter-segment-input:focus {
  outline: none;
  background: var(--primary-alpha-10);
  color: var(--primary);
  font-weight: var(--weight-medium);
}

.filter-segment-input.is-active {
  background: var(--primary-alpha-10);
  color: var(--primary);
  font-weight: var(--weight-medium);
}

.filter-unit {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
}
</style>
