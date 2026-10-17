<script setup lang="ts">
// 图床详情头部（HostsScreen.dc.html）：48 图标块、名字（多份图床旁边铅笔可重命名）+ 状态标签、说明；
// 右侧一个状态按钮（启用时浅蓝「✓ 已启用」点一下停用；停用时蓝色实心「启用」）和检测按钮（检测中原地「正在检测…」并禁用）。
// 正常时不显示状态标签；出问题、刚检测通过、未连接时才出现。
import { nextTick, ref } from 'vue';
import HostIcon from '@/components/biz/HostIcon.vue';
import PnIcon from '@/components/pn/PnIcon.vue';

export interface HostPill {
  text: string;
  tone: 'ok' | 'bad' | 'off';
}

const props = defineProps<{
  hostId: string;
  name: string;
  intro: string;
  renamable: boolean;
  pill: HostPill | null;
  /** 已连接：才有状态按钮 */
  connected: boolean;
  enabled: boolean;
  testLabel: string;
  testing: boolean;
}>();

const emit = defineEmits<{ toggle: []; test: []; rename: [name: string] }>();

const editing = ref(false);
const draft = ref('');
const input = ref<HTMLInputElement>();

function beginRename(): void {
  draft.value = props.name;
  editing.value = true;
  void nextTick(() => input.value?.select());
}

function finishRename(): void {
  if (!editing.value) return;
  editing.value = false;
  if (draft.value.trim() && draft.value.trim() !== props.name) emit('rename', draft.value.trim());
}
</script>

<template>
  <div class="host-head">
    <span class="host-head__icon"><HostIcon :host="hostId" :name="name" :size="28" /></span>
    <div class="host-head__text">
      <span class="host-head__line">
        <input
          v-if="editing"
          ref="input"
          v-model="draft"
          class="host-head__rename"
          aria-label="名称"
          spellcheck="false"
          @blur="finishRename"
          @keydown.enter.prevent="input?.blur()"
          @keydown.esc.prevent="editing = false"
        >
        <span v-else class="host-head__name">{{ name }}</span>
        <button v-if="renamable && !editing" type="button" class="host-head__pencil" aria-label="重命名" @click="beginRename">
          <PnIcon name="pencil" :size="13" :stroke="1.8" />
        </button>
        <span v-if="pill" class="host-head__pill" :class="`host-head__pill--${pill.tone}`"><span class="host-head__dot" />{{ pill.text }}</span>
      </span>
      <span class="host-head__intro">{{ intro }}</span>
    </div>
    <button
      v-if="connected"
      type="button"
      class="host-head__use"
      :class="{ 'host-head__use--on': enabled }"
      :aria-pressed="enabled"
      :title="enabled ? `上传图片时会同时传一份到${name}；点击停用` : `启用后，上传图片时也会传一份到${name}`"
      @click="emit('toggle')"
    >
      <PnIcon v-if="enabled" name="check" :size="13" :stroke="2.8" />{{ enabled ? '已启用' : '启用' }}
    </button>
    <button type="button" class="host-head__test" :disabled="testing" @click="emit('test')">
      <svg v-if="testing" width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" class="host-head__spinner">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity="0.25" stroke-width="2" />
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="12 37.7" stroke-linecap="round" transform="rotate(-90 8 8)" />
      </svg>
      <PnIcon v-else name="recheck" :size="13" :stroke="1.9" />
      {{ testing ? '正在检测…' : testLabel }}
    </button>
  </div>
</template>

<style scoped>
.host-head {
  display: flex;
  align-items: center;
  gap: var(--pn-space-host-head-gap);
  padding-top: var(--pn-space-4);
}

.host-head__icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-host-head-icon);
  height: var(--pn-size-host-head-icon);
  border-radius: var(--pn-radius-host-head-icon);
  background: var(--pn-canvas);
  box-shadow: 0 0 0 1px var(--pn-border);
  color: var(--pn-text1);
}

.host-head__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-2);
  min-width: 0;
}

.host-head__line {
  display: flex;
  align-items: center;
  gap: var(--pn-space-host-section);
  min-width: 0;
}

.host-head__name,
.host-head__rename {
  min-width: 0;
  overflow: hidden;
  font-size: var(--pn-text-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-title);
  letter-spacing: var(--pn-tracking-title);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.host-head__rename {
  flex: 1;
  padding: 0 var(--pn-space-4);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: var(--pn-field);
  box-shadow: inset 0 0 0 1px var(--pn-brand), 0 0 0 var(--pn-ring-soft-width) var(--pn-ring-soft);
  color: var(--pn-text1);
  font-family: inherit;
  outline: none;
}

.host-head__pencil {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-host-field-action);
  height: var(--pn-size-host-field-action);
  margin-left: calc(var(--pn-space-6) * -1);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-text3);
  cursor: pointer;
}

.host-head__pencil:hover { background: var(--pn-host-row-hover); }

.host-head__pill {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-6);
  height: var(--pn-size-host-pill);
  padding: var(--pn-space-host-pill);
  border-radius: var(--pn-radius-host-pill);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
}

.host-head__dot {
  width: var(--pn-size-status-dot);
  height: var(--pn-size-status-dot);
  border-radius: 50%;
}

.host-head__pill--ok { background: var(--pn-host-pill-ok); color: var(--pn-success); }
.host-head__pill--ok .host-head__dot { background: var(--pn-success-fill); }
.host-head__pill--bad { background: var(--pn-host-pill-bad); color: var(--pn-warning); }
.host-head__pill--bad .host-head__dot { background: var(--pn-warning-fill); }
.host-head__pill--off { background: var(--pn-subtle); color: var(--pn-text3); }
.host-head__pill--off .host-head__dot { background: var(--pn-unknown-fill); }

.host-head__intro { color: var(--pn-text2); }

.host-head__use,
.host-head__test {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--pn-space-6);
  height: var(--pn-size-button-lg);
  border: 0;
  border-radius: var(--pn-radius-md);
  font: inherit;
  font-weight: var(--pn-weight-medium);
  cursor: pointer;
}

.host-head__use {
  padding: var(--pn-space-host-button);
  background: var(--pn-button);
  color: var(--pn-on-fill);
}

.host-head__use--on {
  background: var(--pn-brand-soft);
  color: var(--pn-brand-text);
}

.host-head__test {
  padding: 0 var(--pn-space-12);
  background: var(--pn-secondary-bg);
  box-shadow: var(--pn-secondary-ring);
  color: var(--pn-text1);
}

.host-head__test:disabled {
  color: var(--pn-text2);
  cursor: default;
}

.host-head__spinner { animation: k-spin var(--pn-dur-spin) linear infinite; }
</style>
