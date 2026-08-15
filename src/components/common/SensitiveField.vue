<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';

const REVEAL_DURATION_MS = 15_000;

/**
 * 已保存态展示的假圆点
 *
 * Why 固定个数：迁移前这些框绑的是真值 + `type="password"`，浏览器原生遮蔽——
 * 圆点个数就等于密码长度，等于把长度泄露在界面上。这里的圆点是纯装饰，
 * 6 位密码和 64 位 token 长得完全一样。
 *
 * Why 多行要铺满：Cookie 那种 4 行高的框里只放一行圆点，看着像内容被截断了，
 * 用户会以为数据丢了。
 *
 * Why 多行**不写死换行**：曾经拼的是「3 行 × 32 个」，三行一样长，一看就是生成的。
 * 交给浏览器自然折行后，宽度跟着框走，观感自然得多。
 *
 * Why 个数取到明显溢出（单行 32、多行 512）：这两个数是「铺满并有富余」，不是精确
 * 排版。框宽随窗口和 grid 列数变，多行还能被用户拖高（resize: vertical），算得再准
 * 也会在某个宽度上露出空白——而空白正是本设计要消灭的那个信号。
 * placeholder 不是内容、不驱动滚动条，超出可视区的部分直接裁掉，不会冒出滚动条，
 * 所以富余的代价是零。
 *
 * ⚠️ 多行铺满依赖调用方给 `input-class` 带 `word-break: break-all`（见
 * CookieServiceGroup 的 .cookie-field）。`•` 的断行属性是 AL，整串圆点在浏览器眼里
 * 是一个不可断的长单词——没有 break-all 就不折行，512 个会摊成横向溢出的一行。
 */
const FAKE_DOTS_SINGLE = '•'.repeat(32);
const FAKE_DOTS_MULTILINE = '•'.repeat(512);

const props = withDefaults(defineProps<{
  modelValue?: string | null;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  autocomplete?: string;
  readonly?: boolean;
  disabled?: boolean;
  inputClass?: string;
  /**
   * 输入框为空、但后台存着密文时置 true
   *
   * Why 需要这个标记：图床 WebDAV 这类"密文常驻、明文按需"的字段，`modelValue`
   * 永远是空的（明文不进 formData），单看值分不清「存着呢」还是「没填过」。
   * 少了它，眼睛按钮会因为 `!value` 一直禁用，用户连确认一下的路都没有。
   */
  hasStoredValue?: boolean;
  /** 正在把已存的值取出来（异步解密）。期间只读，免得覆盖用户抢先敲的内容 */
  loadingValue?: boolean;
  /** 点眼睛时按需取明文；不提供则 `hasStoredValue` 只用于展示，不可查看 */
  revealStored?: (() => Promise<string>) | null;
}>(), {
  modelValue: '',
  multiline: false,
  rows: 4,
  placeholder: '',
  autocomplete: 'new-password',
  readonly: false,
  disabled: false,
  inputClass: '',
  hasStoredValue: false,
  loadingValue: false,
  revealStored: null,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  blur: [event: FocusEvent];
  revealError: [error: unknown];
  /**
   * 用户要开始改这个字段了：请父组件把真值填进草稿
   *
   * 带 `knownPlaintext` 的场合是「刚点过眼睛、明文已经在手上」——直接交出去，
   * 省一次解密，也避免再解一次带来的竞态。
   */
  editStart: [knownPlaintext?: string];
}>();

const revealed = ref(false);
/**
 * 临时揭示的已保存明文
 *
 * Why 不塞进 modelValue：那会让"查看"变成"输入"——父组件失焦时会把它当成用户
 * 新填的密码重新加密写回。这里单独存，且展示态是只读的，明文只进 DOM 不进数据流。
 */
const storedPlaintext = ref<string | null>(null);
let revealTimer: ReturnType<typeof setTimeout> | null = null;

const value = computed({
  get: () => props.modelValue ?? '',
  set: (next: string) => emit('update:modelValue', next),
});

/** 展示已保存明文的只读态：此时输入框不可编辑，再点一次眼睛回到可编辑空态 */
const showingStored = computed(() => storedPlaintext.value !== null);
const isRevealed = computed(() => revealed.value || showingStored.value);
const canToggle = computed(() =>
  !props.disabled && (!!value.value || (props.hasStoredValue && !!props.revealStored))
);

const toggleLabel = computed(() => isRevealed.value ? '隐藏敏感内容' : '显示敏感内容');
const toggleIcon = computed(() => isRevealed.value ? 'pi pi-eye-slash' : 'pi pi-eye');

const focused = ref(false);
/** 可编辑输入框（单行/多行只会渲染其中一个），从只读展示态切回来时要把焦点交给它 */
const editableRef = ref<{ $el?: HTMLInputElement | HTMLTextAreaElement } | null>(null);

/**
 * 已存过值、框里又没有草稿、且没在编辑时，用圆点表示「里面有东西」
 *
 * Why 走 placeholder 而不是绝对定位一个覆盖层：覆盖层要跟输入框的内边距对齐，
 * 而这个内边距来自 PrimeVue 主题、项目里没有覆写，只能猜——猜错就是文字错位。
 * placeholder 由浏览器渲染在正确位置上，还自带「一开始打字就消失」。
 */
const showsFakeDots = computed(() =>
  props.hasStoredValue && !value.value && !showingStored.value && !focused.value
);

/**
 * 不聚焦时显示圆点（里面有东西），聚焦时换成真正的占位提示（你现在可能要改它）。
 * 两条信息各自在最相关的时机出现，不互相挤占。
 */
const effectivePlaceholder = computed(() => {
  if (!showsFakeDots.value) return props.placeholder;
  return props.multiline ? FAKE_DOTS_MULTILINE : FAKE_DOTS_SINGLE;
});

function clearRevealTimer(): void {
  if (revealTimer) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
}

function conceal(): void {
  clearRevealTimer();
  revealed.value = false;
  storedPlaintext.value = null;
}

function startConcealTimer(): void {
  clearRevealTimer();
  revealTimer = setTimeout(conceal, REVEAL_DURATION_MS);
}

function revealTemporarily(): void {
  revealed.value = true;
  startConcealTimer();
}

async function revealStoredTemporarily(): Promise<void> {
  if (!props.revealStored) return;
  try {
    storedPlaintext.value = await props.revealStored();
    startConcealTimer();
  } catch (error) {
    storedPlaintext.value = null;
    emit('revealError', error);
  }
}

function toggleReveal(): void {
  if (isRevealed.value) {
    conceal();
    return;
  }
  // 框里有用户正在输入的内容 → 切明文；框是空的但存着密文 → 按需解密
  if (value.value) {
    revealTemporarily();
    return;
  }
  void revealStoredTemporarily();
}

/**
 * 聚焦 = 我要改它
 *
 * 已存过值而框里是空的 → 请父组件把真值取出来填进来，让这个框变回一个普通密码框：
 * 想改一个字符就改一个字符，不用整串重打。
 */
function handleFocus(): void {
  focused.value = true;
  if (props.hasStoredValue && !value.value && !showingStored.value) {
    emit('editStart');
  }
}

/**
 * 从「看」切到「改」
 *
 * 点了眼睛之后是只读展示态，再点进输入框本来什么也做不了——只能干等 15 秒或者
 * 再点一次眼睛。而「看一眼然后顺手改一下」恰恰是最自然的动作，这里把它接上。
 *
 * 明文已经在 storedPlaintext 里了，直接随 editStart 交给父组件，不重新解密。
 */
function switchToEditing(): void {
  // 真正只读的字段（如纳米那个派生出来的 Auth-Token）没什么可改的，保持只读查看
  if (props.readonly || props.disabled) return;

  const seen = storedPlaintext.value;
  if (seen === null) return;

  storedPlaintext.value = null;  // 离开只读展示态
  revealed.value = true;         // 继续保持明文可见，别闪一下变回圆点
  focused.value = true;
  emit('editStart', seen);

  // 展示态那个元素已经被移除，焦点得手动交给接替它的可编辑框
  void nextTick(() => {
    editableRef.value?.$el?.focus();
  });
}

function handleBlur(event: FocusEvent): void {
  focused.value = false;
  conceal();
  emit('blur', event);
}

onBeforeUnmount(conceal);

defineExpose({
  conceal,
});
</script>

<template>
  <div
    class="sensitive-field"
    :class="{ 'is-multiline': multiline, 'has-fake-dots': showsFakeDots }"
  >
    <!-- 已保存明文的只读展示态（多行）：不绑 v-model，明文只进 DOM 不进数据流 -->
    <Textarea
      v-if="multiline && showingStored"
      :modelValue="storedPlaintext ?? ''"
      :rows="rows"
      readonly
      :disabled="disabled"
      :class="['sensitive-control', inputClass]"
      @mousedown.prevent="switchToEditing"
      @keydown.esc="conceal"
    />
    <Textarea
      v-else-if="multiline"
      ref="editableRef"
      v-model="value"
      :rows="rows"
      :placeholder="effectivePlaceholder"
      :readonly="readonly || loadingValue"
      :disabled="disabled"
      :class="['sensitive-control', inputClass, { 'is-concealed': !revealed }]"
      @focus="handleFocus"
      @blur="handleBlur"
      @keydown.esc="conceal"
    />
    <!-- 已保存明文的只读展示态（单行）：同样不绑 v-model、不挂 blur -->
    <InputText
      v-else-if="showingStored"
      :modelValue="storedPlaintext ?? ''"
      type="text"
      readonly
      :disabled="disabled"
      :class="['sensitive-control', inputClass]"
      @mousedown.prevent="switchToEditing"
      @keydown.esc="conceal"
    />
    <InputText
      v-else
      ref="editableRef"
      v-model="value"
      :type="revealed ? 'text' : 'password'"
      :placeholder="effectivePlaceholder"
      :autocomplete="autocomplete"
      :readonly="readonly || loadingValue"
      :disabled="disabled"
      :class="['sensitive-control', inputClass]"
      @focus="handleFocus"
      @blur="handleBlur"
      @keydown.esc="conceal"
    />
    <button
      type="button"
      class="sensitive-toggle"
      :aria-label="toggleLabel"
      :aria-pressed="isRevealed"
      :title="toggleLabel"
      :disabled="!canToggle"
      @mousedown.prevent
      @click="toggleReveal"
    >
      <i :class="toggleIcon" aria-hidden="true"></i>
    </button>
  </div>
</template>

<style scoped>
.sensitive-field {
  position: relative;
  width: 100%;
}

.sensitive-control {
  width: 100%;
  padding-right: var(--space-3xl);
}

.sensitive-control::-ms-reveal,
.sensitive-control::-ms-clear {
  display: none;
}

.is-multiline .sensitive-control {
  min-height: 92px;
  resize: vertical;
}

.is-concealed {
  -webkit-text-security: disc;
}

/*
 * 已保存态的圆点
 *
 * 它走的是 placeholder，但要读起来像"框里有内容"而不是"一句灰提示"——
 * 所以盖掉 app.css 的全局 `::placeholder { opacity: .5 }` 和主题的 --text-muted，
 * 换成正常文字色。用户反馈的就是"空框看起来像没东西"。
 *
 * 圆点个数固定，不随真实长度变化：迁移前绑真值 + type=password 时，
 * 圆点个数就等于密码长度，等于把长度泄露在界面上。
 */
.has-fake-dots .sensitive-control::placeholder {
  color: var(--text-main);
  opacity: 1;
  letter-spacing: 0.12em;
}

.sensitive-toggle {
  position: absolute;
  top: 50%;
  right: var(--space-xs-sm);
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.is-multiline .sensitive-toggle {
  top: var(--space-xs-sm);
  transform: none;
}

.sensitive-toggle:hover:not(:disabled),
.sensitive-toggle:focus-visible:not(:disabled) {
  background: var(--hover-overlay-subtle);
  color: var(--text-primary);
}

.sensitive-toggle:disabled {
  cursor: default;
  opacity: 0.45;
}

.sensitive-toggle i {
  font-size: var(--text-sm);
}
</style>
