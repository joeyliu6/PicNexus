<script setup lang="ts">
// 备份与同步 › 最近操作（S05）：最近 3 条同步 / 导入导出 / 备份密码记录；一条都没有时整组不显示。
// 失败的那条用红点 + 「失败」，其余灰点（正常不打绿点，交接说明第 4 节规则 4）。
import { onMounted, ref, watch } from 'vue';
import { historyDB, type SyncLogEntry, type SyncLogOperation } from '@/services/database';
import { formatRelativeTime } from '@/utils/formatters';
import { createLogger } from '@/utils/logger';
import SettingsCard from './SettingsCard.vue';
import SettingsSection from './SettingsSection.vue';

const props = defineProps<{ refreshKey: number }>();

const log = createLogger('BackupRecent');
const SHOWN = 3;

const LABELS: Record<SyncLogOperation, (details?: string) => string> = {
  sync_settings: () => '同步配置',
  sync_history: (d) => (d ? `同步上传记录 · ${d}` : '同步上传记录'),
  upload_settings_cloud: () => '用本机覆盖云端配置',
  upload_history_cloud: () => '用本机覆盖云端记录',
  download_settings_cloud: () => '用云端覆盖本机配置',
  download_history_cloud: () => '用云端覆盖本机记录',
  export_settings_local: (d) => (d ? `导出配置到 ${d}` : '导出配置'),
  export_history_local: (d) => (d ? `导出上传记录到 ${d}` : '导出上传记录'),
  import_settings_local: () => '从文件导入配置',
  import_history_local: (d) => (d ? `从文件导入上传记录 · ${d}` : '从文件导入上传记录'),
  password_set: () => '设置备份密码',
  password_change: () => '修改备份密码',
  password_disable: () => '关闭备份密码',
};

const entries = ref<SyncLogEntry[]>([]);

async function load(): Promise<void> {
  try {
    entries.value = await historyDB.getSyncLogs(SHOWN);
  } catch (error) {
    log.warn('读取最近操作失败', error);
  }
}

function what(entry: SyncLogEntry): string {
  const label = LABELS[entry.operation] ?? (() => entry.operation);
  // 失败的明细是错误原因，不往标签里拼路径 / 条数
  return entry.result === 'success' ? label(entry.details) : `${label()} · 失败`;
}

onMounted(load);
watch(() => props.refreshKey, load);
</script>

<template>
  <SettingsSection v-if="entries.length" title="最近操作">
    <SettingsCard large>
      <div v-for="entry in entries" :key="entry.id" class="recent" :title="entry.result === 'success' ? undefined : entry.details">
        <span class="recent__dot" :class="{ 'recent__dot--failed': entry.result !== 'success' }" aria-hidden="true" />
        <span class="recent__what">{{ what(entry) }}</span>
        <span class="recent__when">{{ formatRelativeTime(entry.timestamp) }}</span>
      </div>
    </SettingsCard>
  </SettingsSection>
</template>

<style scoped>
.recent {
  display: flex;
  align-items: center;
  gap: var(--pn-space-sidebar-x);
  height: var(--pn-size-settings-log-row);
  padding: 0 var(--pn-space-16);
}

.recent + .recent { border-top: 1px solid var(--pn-border); }

.recent__dot {
  flex: none;
  width: var(--pn-size-status-dot);
  height: var(--pn-size-status-dot);
  border-radius: 50%;
  background: var(--pn-unknown-fill);
}

.recent__dot--failed { background: var(--pn-danger-fill); }

.recent__what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent__when {
  flex: none;
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}
</style>
