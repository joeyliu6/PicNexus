<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="dialogTitle"
    :style="{ width: 'var(--dialog-width-md)' }"
    :closable="mode !== 'restore'"
    :draggable="false"
    :pt="{ root: { class: 'app-dialog' }, closeButton: { class: 'app-dialog-close-btn' } }"
    @hide="handleCancel"
  >
    <div class="backup-password-dialog">
      <!-- 恢复模式：检测到加密配置 -->
      <div v-if="mode === 'restore'" class="dialog-description">
        <i class="pi pi-lock" />
        <p>你的配置文件已用备份密码加密。输入当时设置的密码，就能还原配置。</p>
      </div>

      <!-- 密码输入 -->
      <div class="field">
        <label for="backup-password">{{ mode === 'restore' ? '备份密码' : '密码' }}</label>
        <Password
          id="backup-password"
          v-model="password"
          :feedback="false"
          toggleMask
          :inputStyle="{ width: '100%' }"
          :inputProps="{ autocomplete: 'new-password' }"
          :class="{ 'p-invalid': passwordError }"
          :placeholder="mode === 'restore' ? '输入你之前设置的备份密码' : '至少 8 位，包含数字'"
          @keydown.enter="handleSubmit"
        />
        <small v-if="passwordError" class="p-error">{{ passwordError }}</small>

        <!-- 强度提示（设置/修改模式始终显示） -->
        <div v-if="showStrengthHints" class="strength-hints">
          <!-- 必须满足 -->
          <span
            v-for="check in strengthChecks"
            :key="check.label"
            class="strength-check"
            :class="{ passed: check.passed }"
          >
            <i :class="check.passed ? 'pi pi-check-circle' : 'pi pi-circle'" />
            {{ check.label }}
          </span>
          <!-- 建议满足 -->
          <span
            v-for="suggestion in strengthSuggestions"
            :key="suggestion.label"
            class="strength-suggestion"
            :class="{ passed: suggestion.passed }"
          >
            <i :class="suggestion.passed ? 'pi pi-check-circle' : 'pi pi-circle'" />
            {{ suggestion.label }}
          </span>
        </div>
      </div>

      <!-- 确认密码（仅设置/修改模式） -->
      <div v-if="mode === 'set' || mode === 'change'" class="field">
        <label for="backup-password-confirm">确认密码</label>
        <Password
          id="backup-password-confirm"
          v-model="confirmPassword"
          :feedback="false"
          toggleMask
          :inputStyle="{ width: '100%' }"
          :inputProps="{ autocomplete: 'new-password' }"
          :class="{ 'p-invalid': confirmError }"
          placeholder="再次输入密码"
          @keydown.enter="handleSubmit"
        />
        <small v-if="confirmError" class="p-error">{{ confirmError }}</small>
      </div>

      <!-- 警告提示（仅设置/修改模式） -->
      <div v-if="mode === 'set' || mode === 'change'" class="dialog-note-warn">
        <i class="pi pi-info-circle" />
        <span>
          {{ mode === 'change'
            ? '修改后旧备份仍需旧密码打开。请妥善保管密码，忘记后将无法还原。'
            : '请妥善保管密码，忘记后将无法还原。'
          }}
        </span>
      </div>

      <!-- 错误次数提示（恢复模式） -->
      <div v-if="mode === 'restore' && failedAttempts > 0" class="error-box">
        <i class="pi pi-times-circle" />
        <span>密码不正确，剩余尝试次数：{{ MAX_ATTEMPTS - failedAttempts }}</span>
      </div>
    </div>

    <template #footer>
      <Button
        v-if="mode === 'restore'"
        label="跳过，使用默认配置"
        severity="secondary"
        text
        class="dialog-btn-secondary"
        @click="handleSkip"
      />
      <Button
        v-else
        label="取消"
        severity="secondary"
        outlined
        class="dialog-btn-reject"
        @click="handleCancel"
      />
      <Button
        :label="submitLabel"
        :loading="loading"
        class="dialog-btn-accept"
        @click="handleSubmit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import Dialog from 'primevue/dialog';
import Password from 'primevue/password';
import Button from 'primevue/button';
import { validateBackupPassword } from '../../crypto';

type DialogMode = 'set' | 'change' | 'restore';

interface Props {
  modelValue: boolean;
  mode: DialogMode;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'confirm': [password: string];
  'skip': [];
  'cancel': [];
}>();

const MAX_ATTEMPTS = 5;

const password = ref('');
const confirmPassword = ref('');
const passwordError = ref('');
const confirmError = ref('');
const loading = ref(false);
const failedAttempts = ref(0);

const isSetMode = computed(() => props.mode === 'set' || props.mode === 'change');
const showStrengthHints = computed(() => isSetMode.value);

// 必须满足的条件
const strengthChecks = computed(() => {
  const p = password.value;
  return [
    { label: '至少 8 位', passed: p.length >= 8 },
    { label: '包含数字', passed: /\d/.test(p) },
  ];
});

// 建议满足的条件（不影响验证通过，仅引导）
const strengthSuggestions = computed(() => {
  const p = password.value;
  return [
    { label: '大小写字母', passed: /[a-z]/.test(p) && /[A-Z]/.test(p) },
    { label: '特殊符号', passed: /[^a-zA-Z0-9]/.test(p) },
  ];
});

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const dialogTitle = computed(() => {
  switch (props.mode) {
    case 'restore': return '还原备份配置';
    case 'change': return '修改备份密码';
    default: return '设置备份密码';
  }
});

const submitLabel = computed(() => {
  switch (props.mode) {
    case 'restore': return '确认恢复';
    case 'change': return '确认修改';
    default: return '确认设置';
  }
});

function resetForm() {
  password.value = '';
  confirmPassword.value = '';
  passwordError.value = '';
  confirmError.value = '';
  loading.value = false;
}

function validate(): boolean {
  passwordError.value = '';
  confirmError.value = '';

  if (!password.value) {
    passwordError.value = '请输入密码';
    return false;
  }

  if (props.mode !== 'restore') {
    const result = validateBackupPassword(password.value);
    if (!result.valid) {
      passwordError.value = result.message;
      return false;
    }

    if (password.value !== confirmPassword.value) {
      confirmError.value = '两次输入的密码不一致';
      return false;
    }
  }

  return true;
}

async function handleSubmit() {
  if (!validate()) return;

  loading.value = true;
  emit('confirm', password.value);
}

function handleSkip() {
  resetForm();
  emit('skip');
  visible.value = false;
}

function handleCancel() {
  resetForm();
  emit('cancel');
  visible.value = false;
}

/** 外部调用：密码验证失败时增加计数 */
function onPasswordFailed() {
  loading.value = false;
  failedAttempts.value++;
  passwordError.value = '密码不正确';
  password.value = '';

  if (failedAttempts.value >= MAX_ATTEMPTS) {
    handleSkip();
  }
}

/** 外部调用：仅重置 loading 状态（用于非密码错误的系统失败场景） */
function resetLoading() {
  loading.value = false;
}

/** 外部调用：密码验证成功后关闭 */
function onPasswordSuccess() {
  loading.value = false;
  resetForm();
  failedAttempts.value = 0;
  visible.value = false;
}

defineExpose({
  onPasswordFailed,
  onPasswordSuccess,
  resetLoading
});
</script>

<style scoped>
.backup-password-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.dialog-description {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm-md);
  padding: var(--space-md) var(--space-md-lg);
  border-radius: var(--radius-md);
  background: var(--primary-alpha-15);
  color: var(--primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  line-height: 1.5;
}

.dialog-description i {
  font-size: var(--text-xl);
  flex-shrink: 0;
  color: var(--primary);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- 1px 微调对齐，无对应 spacing token */
  margin-top: 1px;
}

.dialog-description p {
  margin: 0;
  color: var(--text-secondary);
}

.dialog-note-warn {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.6;
}

.dialog-note-warn i {
  font-size: var(--text-xs);
  flex-shrink: 0;
  margin-top: var(--space-2xs);
  opacity: 0.7;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs-sm);
}

.field label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
}

.field :deep(.p-password) {
  width: 100%;
}

.field :deep(.p-password input) {
  width: 100%;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  border: none;
  padding: var(--space-md) var(--space-lg);
  color: var(--text-primary);
}

.field :deep(.p-password input:focus) {
  box-shadow: none;
}

.strength-hints {
  display: flex;
  gap: var(--space-sm-md);
  flex-wrap: wrap;
  margin-top: var(--space-2xs);
}

.strength-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-xs);
  color: var(--text-muted);
  transition: color var(--duration-fast);
}

.strength-check i {
  font-size: var(--text-xs);
}

.strength-check.passed {
  color: var(--success);
}

/* 建议项：默认更浅，通过后变绿 */
.strength-suggestion {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-xs);
  color: var(--text-muted);
  opacity: 0.6;
  transition: color var(--duration-fast), opacity var(--duration-fast);
}

.strength-suggestion i {
  font-size: var(--text-xs);
}

.strength-suggestion.passed {
  color: var(--success);
  opacity: 1;
}

.error-box {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm-md) var(--space-md-lg);
  border-radius: var(--radius-md);
  background: var(--error-alpha-8);
  border: 1px solid var(--error-alpha-15);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--error);
}

.error-box i {
  font-size: var(--text-base);
  flex-shrink: 0;
}

:deep(.dialog-btn-reject) {
  flex: 1;
  border-radius: var(--radius-md) !important;
  padding: var(--space-md) var(--space-lg-xl) !important;
  font-size: var(--text-base) !important;
  font-weight: var(--weight-semibold) !important;
  background: var(--bg-button-secondary) !important;
  border: none !important;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 按钮文字白色为固定设计值 */
  color: white !important;
}

:deep(.dialog-btn-reject:hover) {
  background: var(--bg-button-secondary-hover) !important;
}

:deep(.dialog-btn-accept) {
  flex: 1;
  border-radius: var(--radius-md) !important;
  padding: var(--space-md) var(--space-lg-xl) !important;
  font-size: var(--text-base) !important;
  font-weight: var(--weight-semibold) !important;
}

:deep(.dialog-btn-secondary) {
  border-radius: var(--radius-md) !important;
  font-weight: var(--weight-semibold) !important;
}
</style>
