<script setup lang="ts">
// 编辑器与命令行的一张卡（S04，三张同一结构）：状态 → 要复制的东西 → 用哪些图床。
// 状态正常时不打标记（交接说明第 4 节规则 4）：出问题才是琥珀色 ⚠ + 原因；还没配置用浅灰字。
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import CopyButton from '@/components/biz/CopyButton.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import { useCopyBadgeFeedback } from '@/composables/useCopyBadgeFeedback';
import { useToast } from '@/composables/useToast';
import SettingsCard from './SettingsCard.vue';
import type { SettingRowId } from './settingsGroups';

export interface EditorStatus {
  text: string;
  tone: 'muted' | 'normal' | 'warning' | 'danger';
}

const props = defineProps<{
  rowId: SettingRowId;
  mark: string;
  name: string;
  status: EditorStatus;
  action?: { label: string; busy?: boolean; busyLabel?: string } | null;
  label: string;
  code: string;
}>();

defineEmits<{ action: [] }>();

const toast = useToast();
const { isCopied, markCopied } = useCopyBadgeFeedback(1500);

async function copy(): Promise<void> {
  try {
    await writeText(props.code);
    markCopied(props.rowId);
  } catch {
    toast.error('未能复制', '请手动选中后复制');
  }
}
</script>

<template>
  <SettingsCard class="editor-card" :data-setting-row="rowId">
    <div class="editor-card__head">
      <span class="editor-card__mark" aria-hidden="true">{{ mark }}</span>
      <div class="editor-card__info">
        <span class="editor-card__name">{{ name }}</span>
        <span class="editor-card__status" :class="`editor-card__status--${status.tone}`" :role="status.tone === 'warning' || status.tone === 'danger' ? 'alert' : undefined">
          <PnIcon v-if="status.tone === 'warning'" name="warning" :size="12" :stroke="2" />{{ status.text }}
        </span>
      </div>
      <PnButton v-if="action" variant="secondary" size="sm" class="editor-card__action" :loading="action.busy" @click="$emit('action')">
        {{ action.busy && action.busyLabel ? action.busyLabel : action.label }}
      </PnButton>
    </div>
    <div class="editor-card__body">
      <span class="editor-card__label">{{ label }}</span>
      <div class="editor-card__code">
        <code class="editor-card__text pn-selectable" :title="code">{{ code }}</code>
        <CopyButton class="editor-card__copy" :copied="isCopied(rowId)" @click="copy" />
      </div>
      <div class="editor-card__foot"><slot /></div>
    </div>
  </SettingsCard>
</template>

<style scoped>
.editor-card__head {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
  min-height: var(--pn-size-settings-editor-head);
  box-sizing: border-box;
  padding: var(--pn-space-settings-row);
}

.editor-card__mark {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-settings-editor-mark);
  height: var(--pn-size-settings-editor-mark);
  border-radius: var(--pn-radius-md);
  background: var(--pn-subtle);
  box-shadow: 0 0 0 1px var(--pn-hairline);
  color: var(--pn-text2);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
  font-weight: var(--pn-weight-semibold);
}

.editor-card__info {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.editor-card__name { font-weight: var(--pn-weight-semibold); }

.editor-card__status {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.editor-card__status--muted { color: var(--pn-text3); }
.editor-card__status--normal { color: var(--pn-text2); }
.editor-card__status--warning { color: var(--pn-warning); }
.editor-card__status--danger { color: var(--pn-danger); }

.editor-card__action { padding: 0 var(--pn-space-12); }

.editor-card__body {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-8);
  padding: var(--pn-space-settings-editor-body);
  border-top: 1px solid var(--pn-border);
}

.editor-card__label {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
}

.editor-card__code {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  height: var(--pn-size-control-dialog);
  padding: var(--pn-space-settings-editor-code);
  border-radius: var(--pn-radius-md);
  background: var(--pn-subtle);
}

.editor-card__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 命令框里的「复制」是透明底（设计稿），盖掉 CopyButton 自带的白底描边；悬停 / 按下照文字按钮的两级
   （半透明，叠在命令框的浅灰底上照样深一级）；「✓ 已复制」留着 CopyButton 自己的绿，不盖 */
.editor-card__code .editor-card__copy {
  height: var(--pn-size-settings-preset-edit);
  padding: 0 var(--pn-space-8);
  box-shadow: none;
}

.editor-card__code .editor-card__copy:not(.copy-button--done) { background: transparent; color: var(--pn-text2); }
.editor-card__code .editor-card__copy:not(.copy-button--done):hover { background: var(--pn-ghost-hover); color: var(--pn-text1); }
.editor-card__code .editor-card__copy:not(.copy-button--done):active { background: var(--pn-ghost-press); color: var(--pn-text1); }

.editor-card__foot {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}
</style>
