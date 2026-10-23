<script setup lang="ts">
// 备份密码弹窗（Dialogs.dc.html D01–D05）：启动时还原（阻塞，左侧低调的「跳过，使用默认配置」）、
// 设置（强度提示四条，满足前两条且两次一致才可提交）、修改（写清新旧密码各管哪些文件）、关闭（危险按钮写动作）。
// 「解锁」= 设置页里同步 / 导入时遇到加密文件，输入密码后继续；取消即放弃这一次。
// 提交后由调用方验证：成功调 onPasswordSuccess 关闭，失败调 onPasswordFailed 计次（还原最多 5 次）。
import { computed, ref, watch } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';
import { validateBackupPassword } from '@/security/crypto';
import PasswordField from './PasswordField.vue';
import type { BackupPasswordConfirmPayload, BackupPasswordDialogMode } from './backupPasswordDialogTypes';

const MAX_ATTEMPTS = 5;

const props = defineProps<{
  modelValue: boolean;
  mode: BackupPasswordDialogMode;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [payload: BackupPasswordConfirmPayload];
  skip: [];
  cancel: [];
}>();

const COPY: Record<BackupPasswordDialogMode, { title: string; eyebrow: string; body: string; ok: string }> = {
  restore: { title: '还原备份配置', eyebrow: '在新设备上首次启动', body: '配置文件已使用备份密码加密。输入密码以还原全部图床账号与设置。', ok: '确认恢复' },
  unlock: { title: '输入备份密码', eyebrow: '设置 › 备份与同步', body: '这份配置已使用备份密码加密。输入密码后继续。', ok: '继续' },
  set: { title: '设置备份密码', eyebrow: '设置 › 备份与同步', body: '设置后，导出的配置将加密；在新设备上还原时需输入此密码。', ok: '设置' },
  change: { title: '修改备份密码', eyebrow: '设置 › 备份与同步', body: '此后的导出使用新密码加密；此前导出的文件仍需旧密码还原。', ok: '修改' },
  disable: { title: '关闭备份密码？', eyebrow: '设置 › 备份与同步', body: '关闭后，新导出的文件不再加密，图床密钥将以明文保存。此前的加密备份仍需原密码还原。', ok: '关闭密码' },
};

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});
const copy = computed(() => COPY[props.mode]);
const askingOld = computed(() => props.mode !== 'set');
const settingNew = computed(() => props.mode === 'set' || props.mode === 'change');
const oldLabel = computed(() => (props.mode === 'restore' || props.mode === 'unlock' ? '备份密码' : '当前密码'));

const current = ref('');
const next = ref('');
const confirmNext = ref('');
const currentError = ref('');
const loading = ref(false);
const failedAttempts = ref(0);
const exhausted = computed(() => props.mode === 'restore' && failedAttempts.value >= MAX_ATTEMPTS);

const rules = computed(() => [
  { text: '至少 8 位', met: next.value.length >= 8 },
  { text: '包含数字', met: /\d/.test(next.value) },
  { text: '大小写字母', met: /[a-z]/.test(next.value) && /[A-Z]/.test(next.value) },
  { text: '特殊符号', met: /[^a-zA-Z0-9]/.test(next.value) },
]);
const strength = computed(() => rules.value.filter((r) => r.met).length);
/** 修改模式不画强度条：新密码不合要求时在它下面说原因，免得「修改」变灰却不知为何 */
const newHint = computed(() => (props.mode === 'change' && next.value ? validateBackupPassword(next.value).message : ''));
const matches = computed(() => !!confirmNext.value && confirmNext.value === next.value);
const confirmMessage = computed(() => {
  if (!confirmNext.value) return null;
  return matches.value ? { text: '✓ 两次输入一致', tone: 'success' as const } : { text: '两次输入的密码不一致', tone: 'danger' as const };
});

const canSubmit = computed(() => {
  if (loading.value || exhausted.value) return false;
  if (askingOld.value && !current.value) return false;
  if (settingNew.value) return validateBackupPassword(next.value).valid && matches.value;
  return true;
});

watch(() => props.modelValue, (value) => { if (value) reset(); });

function reset(): void {
  current.value = '';
  next.value = '';
  confirmNext.value = '';
  currentError.value = '';
  loading.value = false;
}

function payload(): BackupPasswordConfirmPayload {
  switch (props.mode) {
    case 'set': return { mode: 'set', password: next.value };
    case 'change': return { mode: 'change', currentPassword: current.value, newPassword: next.value, confirmPassword: confirmNext.value };
    case 'disable': return { mode: 'disable', currentPassword: current.value };
    default: return { mode: props.mode, password: current.value };
  }
}

function submit(): void {
  if (!canSubmit.value) return;
  loading.value = true;
  currentError.value = '';
  emit('confirm', payload());
}

function skip(): void {
  reset();
  failedAttempts.value = 0;
  emit('skip');
  open.value = false;
}

function cancel(): void {
  reset();
  emit('cancel');
  open.value = false;
}

/** 调用方：密码不对 */
function onPasswordFailed(): void {
  loading.value = false;
  current.value = '';
  if (props.mode !== 'restore') {
    currentError.value = '密码不正确，请重新输入';
    return;
  }
  failedAttempts.value += 1;
  currentError.value = exhausted.value
    ? '已达尝试次数上限。跳过后加密的配置会另存在数据文件夹，可稍后在「备份与同步」中还原'
    : `密码不正确，剩余尝试次数：${MAX_ATTEMPTS - failedAttempts.value}`;
}

/** 调用方：验证通过 */
function onPasswordSuccess(): void {
  reset();
  failedAttempts.value = 0;
  open.value = false;
}

function resetLoading(): void {
  loading.value = false;
}

defineExpose({ onPasswordFailed, onPasswordSuccess, resetLoading });
</script>

<template>
  <PnDialog
    v-model:open="open"
    :title="copy.title"
    :eyebrow="copy.eyebrow"
    icon="lock"
    :tone="mode === 'disable' ? 'danger' : 'brand'"
    :blocking="mode === 'restore'"
    @dismiss="cancel"
  >
    <div class="backup-password">
      <span class="backup-password__body">{{ copy.body }}</span>
      <PasswordField
        v-if="askingOld"
        id="backup-password-current"
        v-model="current"
        :label="oldLabel"
        :message="currentError"
        :tone="currentError ? 'danger' : 'muted'"
        :disabled="exhausted"
      />
      <template v-if="settingNew">
        <PasswordField id="backup-password-new" v-model="next" label="新密码" autocomplete="new-password" :message="newHint" />
        <PasswordField
          id="backup-password-confirm"
          v-model="confirmNext"
          label="确认密码"
          autocomplete="new-password"
          :message="confirmMessage?.text"
          :tone="confirmMessage?.tone"
        />
      </template>
      <div v-if="mode === 'set'" class="backup-password__strength" aria-label="密码强度">
        <div class="backup-password__bars" aria-hidden="true">
          <span v-for="i in 4" :key="i" class="backup-password__bar" :class="{ 'backup-password__bar--on': i <= strength, 'backup-password__bar--good': strength >= 3 }" />
        </div>
        <div class="backup-password__rules">
          <span v-for="rule in rules" :key="rule.text" class="backup-password__rule" :class="{ 'backup-password__rule--met': rule.met }">
            <span class="backup-password__mark" aria-hidden="true">{{ rule.met ? '✓' : '·' }}</span>{{ rule.text }}
          </span>
        </div>
      </div>
      <span v-if="mode === 'set'" class="backup-password__note">密码遗失后将无法还原加密备份，PicNexus 无法找回。</span>
    </div>
    <template v-if="mode === 'restore' && !exhausted" #footer-left>
      <PnButton variant="ghost" size="lg" class="backup-password__skip" @click="skip">跳过，使用默认配置</PnButton>
    </template>
    <template #footer>
      <PnButton v-if="mode !== 'restore'" variant="secondary" size="dialog" @click="cancel">取消</PnButton>
      <PnButton v-if="exhausted" variant="primary" size="dialog" @click="skip">跳过，使用默认配置</PnButton>
      <PnButton v-else :variant="mode === 'disable' ? 'danger' : 'primary'" size="dialog" :disabled="!canSubmit" :loading="loading" @click="submit">{{ copy.ok }}</PnButton>
    </template>
  </PnDialog>
</template>

<style scoped>
.backup-password {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-dialog-gap);
}

.backup-password__body { color: var(--pn-text2); }

.backup-password__strength {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-8);
  padding: var(--pn-space-backup-strength);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-subtle);
}

.backup-password__bars {
  display: flex;
  gap: var(--pn-space-4);
}

/* 每多满足一条，一段条和那条规则一起变色，带过渡 */
.backup-password__bar {
  flex: 1;
  height: var(--pn-size-backup-strength-bar);
  border-radius: var(--pn-radius-backup-strength-bar);
  background: var(--pn-backup-strength-track);
  transition: background-color var(--pn-dur-fast) var(--pn-ease-in);
}

.backup-password__bar--on { background: var(--pn-warning-fill); }
.backup-password__bar--on.backup-password__bar--good { background: var(--pn-brand); }

.backup-password__rules {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--pn-space-4) var(--pn-space-12);
  font-size: var(--pn-text-footnote);
}

.backup-password__rule {
  display: flex;
  align-items: center;
  gap: var(--pn-space-6);
  color: var(--pn-text3);
  transition: color var(--pn-dur-fast) var(--pn-ease-in);
}

.backup-password__rule--met { color: var(--pn-success); }

.backup-password__mark {
  width: var(--pn-space-12);
  font-weight: var(--pn-weight-semibold);
}

.backup-password__note {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.backup-password__skip {
  margin-left: calc(-1 * var(--pn-space-6));
  padding: 0 var(--pn-space-6);
  color: var(--pn-text2);
}
</style>
