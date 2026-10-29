<script setup lang="ts">
// 云同步连接（设计只画了「更换同步方式…」入口）：名称、服务器地址、用户名、密码、远程目录，「测试并保存」。
// 测试通过才保存，失败把原因写在弹窗里、不关；已保存过密码时密码框留空 = 不改。
// 外部 WebDAV 只收 HTTPS（明文 HTTP 只留给本机服务）。已存多份连接时顶部可以换；「停用云同步」只取消选中，连接本身留着。
import { computed, ref, watch } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';
import PnInput from '@/components/pn/PnInput.vue';
import PnSelect from '@/components/pn/PnSelect.vue';
import PasswordField from '@/components/dialogs/PasswordField.vue';
import type { WebDAVProfile } from '@/config/types';
import { useConfigManager } from '@/composables/useConfig';
import { WebDAVClient } from '@/utils/webdav';
import { useSettingsConfig } from './useSettingsConfig';

const open = defineModel<boolean>('open', { default: false });

const NEW = '__new__';
const DEFAULT_PATH = '/PicNexus/';
const JIANGUOYUN = { name: '坚果云', url: 'https://dav.jianguoyun.com/dav/' };
const LOOPBACK_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i;

const settings = useSettingsConfig();
const profiles = computed<WebDAVProfile[]>(() => settings.config.value.webdav?.profiles ?? []);
const activeId = computed(() => settings.config.value.webdav?.activeId ?? null);

const editingId = ref<string>(NEW);
const name = ref('');
const url = ref('');
const username = ref('');
const password = ref('');
const remotePath = ref(DEFAULT_PATH);
const error = ref('');
const testing = ref(false);

const editing = computed(() => profiles.value.find((p) => p.id === editingId.value) ?? null);
const hasSavedPassword = computed(() => !!(editing.value?.passwordEncrypted || editing.value?.password));
const profileOptions = computed(() => [...profiles.value.map((p) => ({ value: p.id, label: p.name })), { value: NEW, label: '新建连接' }]);

function load(id: string): void {
  editingId.value = id;
  const profile = profiles.value.find((p) => p.id === id);
  // 第一份连接按坚果云预填：名称与地址都是真值（只放占位字的话，灰色地址像已经填好，点了才说「请填写服务器地址」）
  name.value = profile?.name ?? (profiles.value.length ? `WebDAV ${profiles.value.length + 1}` : JIANGUOYUN.name);
  url.value = profile?.url ?? (profiles.value.length ? '' : JIANGUOYUN.url);
  username.value = profile?.username ?? '';
  password.value = '';
  remotePath.value = profile?.remotePath || DEFAULT_PATH;
  error.value = '';
}

watch(open, (value) => { if (value) load(activeId.value ?? profiles.value[0]?.id ?? NEW); });

/** 填写有误时的说法；没问题返回空串 */
function problem(): string {
  const address = url.value.trim();
  if (!address) return '请填写服务器地址';
  if (!/^https?:\/\//i.test(address)) return '服务器地址要以 https:// 开头';
  if (/^http:\/\//i.test(address) && !LOOPBACK_HTTP.test(address)) return '外部 WebDAV 请使用 HTTPS 地址（明文 HTTP 只留给本机服务）';
  if (!username.value.trim()) return '请填写用户名';
  if (!password.value && !hasSavedPassword.value) return '请填写密码';
  return '';
}

async function plainPassword(): Promise<string> {
  if (password.value) return password.value;
  const profile = editing.value!;
  if (!profile.passwordEncrypted) return profile.password ?? '';
  const plain = await WebDAVClient.decryptPassword(profile.passwordEncrypted);
  if (!plain) throw new Error('已保存的密码无法解开，请重新填写密码');
  return plain;
}

async function testAndSave(): Promise<void> {
  error.value = problem();
  if (error.value) return;
  testing.value = true;
  try {
    const plain = await plainPassword();
    const target = { url: url.value.trim(), username: username.value.trim(), password: plain, remotePath: remotePath.value.trim() || DEFAULT_PATH };
    const result = await useConfigManager().testWebDAVConnection(target);
    if (!result.success) {
      error.value = `连接失败：${result.message}`;
      return;
    }
    const passwordEncrypted = password.value ? await WebDAVClient.encryptPassword(password.value) : editing.value?.passwordEncrypted;
    const id = editing.value?.id ?? crypto.randomUUID();
    const profile: WebDAVProfile = {
      id,
      name: name.value.trim() || 'WebDAV',
      url: target.url,
      username: target.username,
      passwordEncrypted,
      remotePath: target.remotePath,
      connectionStatus: 'success',
      lastTestedAt: Date.now(),
    };
    const ok = await settings.patch('cloudSync', (c) => {
      const webdav = c.webdav ?? { profiles: [], activeId: null };
      const others = webdav.profiles.filter((p) => p.id !== id);
      const index = webdav.profiles.findIndex((p) => p.id === id);
      const next = [...others];
      next.splice(index < 0 ? next.length : index, 0, profile);
      c.webdav = { ...webdav, profiles: next, activeId: id };
    });
    if (ok) open.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    testing.value = false;
  }
}

async function disable(): Promise<void> {
  const ok = await settings.patch('cloudSync', (c) => { if (c.webdav) c.webdav = { ...c.webdav, activeId: null }; });
  if (ok) open.value = false;
}
</script>

<template>
  <PnDialog v-model:open="open" title="同步方式" eyebrow="设置 › 备份与同步" icon="cloud">
    <div class="target">
      <label v-if="profiles.length > 1" class="target__field">
        <span class="target__label">连接</span>
        <PnSelect :model-value="editingId" :options="profileOptions" label="连接" @update:model-value="load" />
      </label>
      <div class="target__grid">
        <label class="target__field">
          <span class="target__label">名称</span>
          <PnInput v-model="name" size="dialog" :placeholder="JIANGUOYUN.name" />
        </label>
        <label class="target__field">
          <span class="target__label">远程目录</span>
          <PnInput v-model="remotePath" size="dialog" mono :placeholder="DEFAULT_PATH" />
        </label>
      </div>
      <label class="target__field">
        <span class="target__label">服务器地址</span>
        <PnInput v-model="url" size="dialog" mono type="url" :placeholder="JIANGUOYUN.url" />
      </label>
      <label class="target__field">
        <span class="target__label">用户名</span>
        <PnInput v-model="username" size="dialog" autocomplete="username" />
      </label>
      <PasswordField
        id="sync-target-password"
        v-model="password"
        :label="hasSavedPassword ? '密码（留空 = 不修改）' : '密码'"
        message="坚果云请填写「应用密码」，不是登录密码"
      />
      <p v-if="error" class="target__error" role="alert">{{ error }}</p>
    </div>
    <template v-if="activeId" #footer-left>
      <PnButton variant="ghost" size="dialog" class="target__off" @click="disable">停用云同步</PnButton>
    </template>
    <template #footer>
      <PnButton variant="secondary" size="dialog" @click="open = false">取消</PnButton>
      <PnButton variant="primary" size="dialog" :loading="testing" @click="testAndSave">{{ testing ? '正在测试…' : '测试并保存' }}</PnButton>
    </template>
  </PnDialog>
</template>

<style scoped>
.target {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-12);
}

.target__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--pn-space-host-fields);
}

.target__field {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-6);
}

.target__label {
  color: var(--pn-text2);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
}

.target__error {
  margin: 0;
  color: var(--pn-danger);
  font-size: var(--pn-text-footnote);
  line-height: var(--pn-leading-footnote);
}

.target__off { color: var(--pn-text2); }
</style>
