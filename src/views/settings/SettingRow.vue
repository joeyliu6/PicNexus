<script setup lang="ts">
// 设置的一行（SettingsScreen.dc.html）：最小高 48，左边名称 + 一句说明，右边控件；行与行之间一条分隔线。
// 改动保存成功后控件左边闪一下绿色「✓ 已保存」（交接说明第 4 节规则 10）；命令面板跳来的那一行浅蓝高亮一下。
import { computed, inject, type Ref } from 'vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import { useSettingsConfig } from './useSettingsConfig';
import type { SettingRowId } from './settingsGroups';

const props = withDefaults(defineProps<{
  title?: string;
  desc?: string;
  /** 「已保存」与跳转高亮认的 id */
  rowId?: SettingRowId;
  /** 说明放不下时一行截断（数据位置这类长路径） */
  truncate?: boolean;
  disabled?: boolean;
}>(), { title: undefined, desc: undefined, rowId: undefined, truncate: false, disabled: false });

const settings = useSettingsConfig();
const highlight = inject<Ref<string | null> | null>('settingsHighlight', null);
const saved = computed(() => !!props.rowId && settings.isSaved(props.rowId));
const highlighted = computed(() => !!props.rowId && highlight?.value === props.rowId);
</script>

<template>
  <div
    class="setting-row"
    :class="{ 'setting-row--highlight': highlighted, 'setting-row--disabled': disabled }"
    :data-setting-row="rowId"
  >
    <slot name="lead" />
    <div class="setting-row__text">
      <slot name="title"><span class="setting-row__title">{{ title }}</span></slot>
      <span v-if="desc || $slots.desc" class="setting-row__desc" :class="{ 'setting-row__desc--truncate': truncate }">
        <slot name="desc">{{ desc }}</slot>
      </span>
    </div>
    <span v-if="saved" class="setting-row__saved" role="status">
      <PnIcon name="check" :size="12" :stroke="2.4" />已保存
    </span>
    <slot />
  </div>
</template>

<style scoped>
.setting-row {
  display: flex;
  align-items: center;
  gap: var(--pn-space-16);
  min-height: var(--pn-size-settings-row);
  box-sizing: border-box;
  padding: var(--pn-space-settings-row);
  transition: background-color var(--pn-dur-standard) var(--pn-ease-in);
}

.setting-row + .setting-row { border-top: 1px solid var(--pn-border); }

.setting-row:first-child { border-top-left-radius: inherit; border-top-right-radius: inherit; }
.setting-row:last-child { border-bottom-left-radius: inherit; border-bottom-right-radius: inherit; }

.setting-row--highlight { background: var(--pn-brand-soft); }

.setting-row__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.setting-row--disabled .setting-row__text { opacity: var(--pn-opacity-disabled); }

.setting-row__title { color: var(--pn-text1); }

.setting-row__desc {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.setting-row__desc--truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setting-row__saved {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-4);
  color: var(--pn-success);
  font-size: var(--pn-text-footnote);
}
</style>
