<script setup lang="ts">
// 单选模板列表（HostsScreen.dc.html 的微博「链接前缀」、GitHub「加速」）：每项名称 + 模板 + 预览，选中即保存；
// 「添加…」弹窗填名称与模板，自己加的那几项悬停可删，「恢复默认」回到出厂列表。
import { ref } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';
import PnInput from '@/components/pn/PnInput.vue';

export interface TemplateItem {
  name: string;
  template: string;
  /** 「效果：…」（微博有，GitHub 没有） */
  preview?: string;
  /** 自己加的：可删除 */
  removable?: boolean;
}

defineProps<{
  title: string;
  note: string;
  items: readonly TemplateItem[];
  selected: number;
  addLabel: string;
  /** 右下角的变量说明 */
  variables?: string;
  /** 添加弹窗里模板框的占位 */
  templatePlaceholder: string;
}>();

const emit = defineEmits<{ select: [index: number]; add: [item: { name: string; template: string }]; remove: [index: number]; restore: [] }>();

const adding = ref(false);
const name = ref('');
const template = ref('');

function openAdd(): void {
  name.value = '';
  template.value = '';
  adding.value = true;
}

function submit(): void {
  if (!name.value.trim() || !template.value.trim()) return;
  emit('add', { name: name.value.trim(), template: template.value.trim() });
  adding.value = false;
}
</script>

<template>
  <section class="host-templates">
    <div class="host-templates__head">
      <span class="host-templates__title">{{ title }}</span>
      <span class="host-templates__note">{{ note }}</span>
    </div>
    <div class="host-templates__list" role="radiogroup" :aria-label="title">
      <div
        v-for="(item, index) in items"
        :key="`${index}-${item.name}`"
        class="host-templates__row"
        :class="{ 'host-templates__row--on': index === selected }"
        role="radio"
        :aria-checked="index === selected"
        tabindex="0"
        @click="emit('select', index)"
        @keydown.enter.prevent="emit('select', index)"
        @keydown.space.prevent="emit('select', index)"
      >
        <span class="host-templates__radio" aria-hidden="true"><span class="host-templates__dot" /></span>
        <span class="host-templates__text">
          <span class="host-templates__name">{{ item.name }}</span>
          <span class="host-templates__tpl">{{ item.template }}</span>
          <span v-if="item.preview" class="host-templates__preview">{{ item.preview }}</span>
        </span>
        <button v-if="item.removable" type="button" class="host-templates__remove" @click.stop="emit('remove', index)">删除</button>
      </div>
    </div>
    <div class="host-templates__foot">
      <button type="button" class="host-templates__text-button host-templates__text-button--first" @click="openAdd">{{ addLabel }}…</button>
      <button type="button" class="host-templates__text-button" @click="emit('restore')">恢复默认</button>
      <span class="host-templates__spacer" />
      <span v-if="variables" class="host-templates__vars">可用变量 <span class="host-templates__mono">{{ variables }}</span></span>
    </div>
    <PnDialog v-model:open="adding" :title="addLabel" icon="info">
      <div class="host-templates__form">
        <label class="host-templates__label" for="host-template-name">名称</label>
        <PnInput id="host-template-name" v-model="name" size="dialog" placeholder="我的反代" />
        <label class="host-templates__label" for="host-template-tpl">模板</label>
        <PnInput id="host-template-tpl" v-model="template" size="dialog" mono :placeholder="templatePlaceholder" />
      </div>
      <template #footer>
        <PnButton variant="secondary" size="dialog" @click="adding = false">取消</PnButton>
        <PnButton variant="primary" size="dialog" :disabled="!name.trim() || !template.trim()" @click="submit">添加</PnButton>
      </template>
    </PnDialog>
  </section>
</template>

<style scoped>
.host-templates {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-host-section);
}

.host-templates__head {
  display: flex;
  align-items: baseline;
  gap: var(--pn-space-8);
}

.host-templates__title { font-weight: var(--pn-weight-semibold); }

.host-templates__note {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
}

.host-templates__list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--pn-radius-host-head-icon);
  box-shadow: 0 0 0 1px var(--pn-border);
}

.host-templates__row {
  display: flex;
  align-items: flex-start;
  gap: var(--pn-space-host-row-gap);
  padding: var(--pn-space-host-template);
  cursor: pointer;
  outline-offset: -2px;
  transition: background-color var(--pn-dur-fast) var(--pn-ease-in);
}

.host-templates__row + .host-templates__row { border-top: 1px solid var(--pn-border); }
.host-templates__row--on { background: var(--pn-brand-soft); }

.host-templates__radio {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-check);
  height: var(--pn-size-check);
  margin-top: var(--pn-space-2);
  box-sizing: border-box;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px var(--pn-check-border);
  transition: background-color var(--pn-dur-fast) var(--pn-ease-in), box-shadow var(--pn-dur-fast) var(--pn-ease-in);
}

.host-templates__dot {
  width: var(--pn-size-radio-dot);
  height: var(--pn-size-radio-dot);
  border-radius: 50%;
  transition: background-color var(--pn-dur-fast) var(--pn-ease-in);
}

.host-templates__row--on .host-templates__radio { background: var(--pn-brand); box-shadow: none; }
.host-templates__row--on .host-templates__dot { background: var(--pn-on-fill); }

.host-templates__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-2);
  min-width: 0;
}

.host-templates__name { font-weight: var(--pn-weight-medium); }

.host-templates__tpl,
.host-templates__preview {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.host-templates__tpl {
  color: var(--pn-text2);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-caption);
}

.host-templates__preview {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

/* 悬停才浮出的「删除」：一直占着位置，只是看不见；淡入淡出 */
.host-templates__remove {
  flex: none;
  align-self: center;
  height: var(--pn-size-host-field-action);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-danger);
  font: inherit;
  font-size: var(--pn-text-footnote);
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--pn-dur-instant) var(--pn-ease-in), visibility var(--pn-dur-instant), background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.host-templates__row:hover .host-templates__remove,
.host-templates__row:focus-within .host-templates__remove { opacity: 1; visibility: visible; }

.host-templates__remove:hover { background: var(--pn-danger-soft); }
.host-templates__remove:active { background: var(--pn-danger-soft-press); }

.host-templates__foot {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
}

.host-templates__spacer { flex: 1; }

.host-templates__text-button {
  height: var(--pn-size-button-sm);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  font: inherit;
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.host-templates__text-button:hover { background: var(--pn-ghost-hover); }
.host-templates__text-button:active { background: var(--pn-ghost-press); }
.host-templates__text-button--first { margin-left: calc(var(--pn-space-8) * -1); }

.host-templates__vars {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.host-templates__mono { font-family: var(--pn-font-mono); }

.host-templates__form {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--pn-space-12);
}

.host-templates__label {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
}
</style>
