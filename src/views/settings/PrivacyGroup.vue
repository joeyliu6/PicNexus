<script setup lang="ts">
// 数据与隐私（S06）：统计开关；数据位置与应用缓存；不能撤销的操作单独成组，红字按钮 + 省略号（会再确认）。
// 缓存大小拿不到（缩略图在 WebView 自己的缓存里），说明只写「缩略图与临时文件」。
import { computed, onActivated, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import PnButton from '@/components/pn/PnButton.vue';
import PnSwitch from '@/components/pn/PnSwitch.vue';
import { useHistoryManager } from '@/composables/history/useHistory';
import { useConfirm } from '@/composables/useConfirm';
import { useToast } from '@/composables/useToast';
import { historyDB } from '@/services/database';
import { getErrorMessage } from '@/types/errors';
import { formatCount } from '@/utils/formatters';
import SettingRow from './SettingRow.vue';
import SettingsCard from './SettingsCard.vue';
import SettingsSection from './SettingsSection.vue';
import { useSettingsConfig } from './useSettingsConfig';
import { useSettingsEffects } from './settingsEffects';

const settings = useSettingsConfig();
const effects = useSettingsEffects();
const toast = useToast();
const { confirm } = useConfirm();
const history = useHistoryManager();

const dataDir = ref('');
const recordCount = ref<number | null>(null);
const clearingCache = ref(false);
const resetting = ref(false);

const analyticsOn = computed(() => settings.config.value.analytics?.enabled !== false);

async function load(): Promise<void> {
  dataDir.value = await invoke<string>('get_user_data_dir').catch(() => '');
  recordCount.value = await historyDB.getCount().catch(() => null);
}

onMounted(load);
onActivated(load);

async function openDataDir(): Promise<void> {
  try {
    await invoke('open_path', { path: dataDir.value });
  } catch (error) {
    toast.error('未能打开数据位置', `${getErrorMessage(error) || '文件夹不存在'}，请重试`);
  }
}

async function clearCache(): Promise<void> {
  clearingCache.value = true;
  try {
    await getCurrentWebview().clearAllBrowsingData();
    toast.success('已清理应用缓存');
  } catch (error) {
    toast.error('未能清理缓存', `${getErrorMessage(error)}，请重试`);
  } finally {
    clearingCache.value = false;
  }
}

async function clearRecords(): Promise<void> {
  // 确认与 5 秒撤销都在 clearHistory 里
  await history.clearHistory();
  await load();
}

async function resetDefaults(): Promise<void> {
  const ok = await confirm('外观、启动、快捷键、链接格式、压缩、编辑器等偏好将恢复默认值，无法撤销。图床账号、云同步连接与上传记录保留。', {
    header: '恢复默认设置？', acceptLabel: '恢复', rejectLabel: '取消', acceptClass: 'p-button-danger',
  });
  if (!ok) return;
  resetting.value = true;
  try {
    if (await effects.resetAll()) toast.success('已恢复默认设置');
  } finally {
    resetting.value = false;
  }
}

const recordsDesc = computed(() => (recordCount.value === null
  ? '删除本机的上传记录；图床上的文件不受影响'
  : `删除本机 ${formatCount(recordCount.value)} 条记录；图床上的文件不受影响`));
</script>

<template>
  <div class="privacy">
    <SettingsSection title="隐私" note="PicNexus 不设账号。图片、链接与密钥仅保存在本机、你的图床和你的云同步服务中。">
      <SettingsCard>
        <SettingRow row-id="analytics" title="匿名使用统计" desc="仅统计功能使用次数，用于改进产品" truncate>
          <PnSwitch :model-value="analyticsOn" label="匿名使用统计" @update:model-value="effects.changeAnalytics" />
        </SettingRow>
      </SettingsCard>
    </SettingsSection>

    <SettingsSection title="存储" note="清理缓存不影响上传记录，缩略图将在需要时重新下载。">
      <SettingsCard>
        <SettingRow row-id="dataDir" title="数据位置" truncate>
          <template #desc><span class="privacy__path" :title="dataDir">{{ dataDir }}</span></template>
          <PnButton variant="secondary" size="sm" class="privacy__btn" :disabled="!dataDir" @click="openDataDir">打开</PnButton>
        </SettingRow>
        <SettingRow row-id="cache" title="应用缓存" desc="缩略图与临时文件" truncate>
          <PnButton variant="secondary" size="sm" class="privacy__btn" :loading="clearingCache" @click="clearCache">清理</PnButton>
        </SettingRow>
      </SettingsCard>
    </SettingsSection>

    <SettingsSection title="重置" note="以上操作无法撤销，建议先在「备份与同步」中导出配置。">
      <SettingsCard>
        <SettingRow row-id="clearRecords" title="清空全部记录" :desc="recordsDesc" truncate>
          <PnButton variant="secondary" size="sm" class="privacy__btn privacy__btn--danger" :disabled="recordCount === 0" @click="clearRecords">清空…</PnButton>
        </SettingRow>
        <SettingRow row-id="resetDefaults" title="恢复默认设置" desc="偏好恢复默认值；保留图床账号与记录" truncate>
          <PnButton variant="secondary" size="sm" class="privacy__btn privacy__btn--danger" :loading="resetting" @click="resetDefaults">恢复…</PnButton>
        </SettingRow>
      </SettingsCard>
    </SettingsSection>
  </div>
</template>

<style scoped>
.privacy {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-settings-groups);
}

.privacy__path { font-family: var(--pn-font-mono); }
.privacy__btn { padding: 0 var(--pn-space-12); }
.privacy__btn--danger { color: var(--pn-danger); }
</style>
