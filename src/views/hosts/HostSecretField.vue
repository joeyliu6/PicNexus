<script setup lang="ts">
// 敏感字段（P09 / P10）：默认密文；「查看」显示明文 30 秒后自动收回；点进字段即清空等待粘贴（旧值不回显），
// 离开即保存（父组件保存后自动测试）；「取消」恢复原值。没输入就离开 = 取消；输入过又删空再离开 = 清空（先确认）。
// 明文只在「查看」时临时取，从不写进输入框的值里——「看一眼」不会变成「改一次」。
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { useConfirm } from '@/composables/useConfirm';
import { createLogger } from '@/utils/logger';
import { useToast } from '@/composables/useToast';
import { openTrustedExternalUrl } from '@/security/shellOpen';
import { joinCjk } from '@/utils/cjkSpacing';

const log = createLogger('HostSecretField');

/** 明文显示多久（交接说明 8.4） */
const REVEAL_MS = 30_000;
const MASK = '••••••••••••••••••••••••';

const props = withDefaults(defineProps<{
  label: string;
  /** 已存过值（决定显示密文还是空框） */
  hasValue: boolean;
  /** 按需取明文 */
  reveal: () => Promise<string>;
  invalid?: boolean;
  /** 字段下面的一行（红字原因 / 帮助） */
  help?: string;
  placeholder?: string;
  id?: string;
  /** 标 *（Token 类必填） */
  required?: boolean;
  /** 框里的链接（「在 GitHub 生成」） */
  link?: { label: string; url: string };
  /** 圆点前露出的一段（Cookie 的第一项名字「SUB=」，HostsScreen.dc.html） */
  maskPrefix?: string;
}>(), { invalid: false, help: undefined, placeholder: '', id: undefined, required: false, link: undefined, maskPrefix: '' });

const emit = defineEmits<{ commit: [value: string] }>();

const { confirm } = useConfirm();
const toast = useToast();

type Mode = 'masked' | 'revealed' | 'editing';
const mode = ref<Mode>('masked');
const plain = ref('');
const draft = ref('');
const typed = ref(false);
const input = ref<HTMLInputElement>();
let timer: ReturnType<typeof setTimeout> | undefined;

const empty = computed(() => !props.hasValue && mode.value !== 'editing');

async function toggleReveal(): Promise<void> {
  if (mode.value === 'revealed') { hide(); return; }
  try {
    plain.value = await props.reveal();
    mode.value = 'revealed';
    clearTimeout(timer);
    timer = setTimeout(hide, REVEAL_MS);
  } catch (error) {
    log.warn(`${props.label} 取明文失败`, error);
    toast.error(`无法查看${props.label}`, '请重新填写后再试');
  }
}

function hide(): void {
  clearTimeout(timer);
  plain.value = '';
  if (mode.value === 'revealed') mode.value = 'masked';
}

/** 点进字段：清空等待粘贴 */
function beginEdit(): void {
  if (mode.value === 'editing') return;
  hide();
  draft.value = '';
  typed.value = false;
  mode.value = 'editing';
  void nextTick(() => input.value?.focus());
}

function cancel(): void {
  draft.value = '';
  typed.value = false;
  mode.value = 'masked';
}

async function finish(): Promise<void> {
  if (mode.value !== 'editing') return;
  const value = draft.value.trim();
  if (value) {
    mode.value = 'masked';
    emit('commit', value);
    return;
  }
  if (!typed.value || !props.hasValue) { cancel(); return; }
  // 输入过又删空：要清掉这一项，先确认（很多服务商的密钥只在生成时显示一次）
  mode.value = 'masked';
  const ok = await confirm('清空后需重新填写，否则无法上传到这个图床。', { header: `清空 ${props.label}？`, acceptLabel: '清空', rejectLabel: '取消', tone: 'danger' });
  if (ok) emit('commit', '');
}

function onInput(): void {
  typed.value = true;
}

defineExpose({ beginEdit });
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="host-secret">
    <label class="host-secret__label" :for="id">{{ label }}<span v-if="required" class="host-secret__required"> *</span></label>
    <div class="host-secret__row">
      <div class="host-secret__box" :class="{ 'host-secret__box--invalid': invalid, 'host-secret__box--editing': mode === 'editing' }">
        <input
          v-if="mode === 'editing'"
          :id="id"
          ref="input"
          v-model="draft"
          class="host-secret__input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :placeholder="placeholder"
          @input="onInput"
          @blur="finish"
          @keydown.enter.prevent="input?.blur()"
          @keydown.esc.prevent="cancel"
        >
        <button
          v-else
          :id="id"
          type="button"
          class="host-secret__value"
          :class="{ 'host-secret__value--empty': empty }"
          :aria-label="`修改${label}`"
          @click="beginEdit"
        >
          {{ mode === 'revealed' ? plain : hasValue ? maskPrefix + MASK : placeholder }}
        </button>
        <a v-if="link && mode !== 'editing'" class="host-secret__link" href="#" @click.prevent="openTrustedExternalUrl(link.url)">{{ link.label }}</a>
        <button v-if="mode === 'editing'" type="button" class="host-secret__action host-secret__action--muted" @mousedown.prevent @click="cancel">取消</button>
        <button v-else-if="hasValue" type="button" class="host-secret__action" @click="toggleReveal">{{ mode === 'revealed' ? '隐藏' : '查看' }}</button>
      </div>
      <!-- 框右边的按钮（Cookie 的「重新登录…」）：和框同一行，下面的说明文字变化不会带着它上下跳 -->
      <slot name="aside" />
    </div>
    <span v-if="invalid && help" class="host-secret__help host-secret__help--error">{{ help }}</span>
    <span v-else-if="mode === 'editing'" class="host-secret__help">{{ joinCjk('粘贴新的', label, '，失焦后自动保存并测试') }}</span>
    <span v-else-if="mode === 'revealed'" class="host-secret__help">30 秒后自动隐藏</span>
    <span v-else-if="help" class="host-secret__help">{{ help }}</span>
  </div>
</template>

<style scoped>
.host-secret {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-6);
  min-width: 0;
}

.host-secret__label {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
}

.host-secret__row {
  display: flex;
  align-items: center;
  gap: var(--pn-space-8);
  min-width: 0;
}

.host-secret__box {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: var(--pn-space-8);
  height: var(--pn-size-control);
  box-sizing: border-box;
  padding: 0 var(--pn-space-4) 0 var(--pn-space-input-x);
  border-radius: var(--pn-radius-md);
  background: var(--pn-field);
  box-shadow: inset 0 0 0 1px var(--pn-border-strong);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
  transition: box-shadow var(--pn-dur-instant) var(--pn-ease-in);
}

.host-secret__box--editing { box-shadow: inset 0 0 0 1px var(--pn-brand), 0 0 0 var(--pn-ring-soft-width) var(--pn-ring-soft); }
.host-secret__box--invalid { box-shadow: inset 0 0 0 1px var(--pn-danger-fill); }

.host-secret__value,
.host-secret__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  outline: none;
}

.host-secret__value { cursor: text; }
.host-secret__value--empty { color: var(--pn-text3); }
.host-secret__input::placeholder { color: var(--pn-text3); }

.host-secret__action {
  flex: none;
  height: var(--pn-size-host-field-action);
  padding: 0 var(--pn-space-8);
  border: 0;
  border-radius: var(--pn-radius-sm);
  background: transparent;
  color: var(--pn-brand-text);
  font-family: var(--pn-font-ui);
  font-size: var(--pn-text-footnote);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.host-secret__action:hover { background: var(--pn-ghost-hover); }
.host-secret__action:active { background: var(--pn-ghost-press); }
.host-secret__action--muted { color: var(--pn-text2); }

.host-secret__required { color: var(--pn-danger); }

.host-secret__link {
  flex: none;
  color: var(--pn-brand-text);
  font-family: var(--pn-font-ui);
  font-size: var(--pn-text-footnote);
  text-decoration: none;
  white-space: nowrap;
}

.host-secret__help {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.host-secret__help--error { color: var(--pn-danger); }
</style>
