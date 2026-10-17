// 每份云同步连接的同步记录（.sync-status.dat 的 syncByProfile）：上次同步时间、结果、失败原因。
// 写的时候读最新的整份、只改这一份连接的记录：同一个文件里还有京东 / 七鱼的检测状态（useServiceAvailability 写），
// 拿手里的旧副本整份写回会把它们盖掉。
import { ref } from 'vue';
import type { ProfileSyncRecord, SyncStatus, WebDAVProfile } from '@/config/types';
import { syncStatusStore } from '@/store/instances';
import { createLogger } from '@/utils/logger';
import { getFullTimestamp } from './backupSyncUtils';

const log = createLogger('SyncRecords');

export type SyncKind = 'config' | 'history';
export type SyncResult = 'success' | 'failed' | 'partial';

/** 界面读的那份（按连接 id） */
const records = ref<Record<string, ProfileSyncRecord>>({});

/** 很早的版本是平铺的一份记录（没有按连接分），读到时搬成 __legacy__ 并写回 */
function migrate(saved: Record<string, unknown>): SyncStatus {
  if ('syncByProfile' in saved) return saved as unknown as SyncStatus;
  const legacy = saved as {
    configLastSync?: string | null; configSyncResult?: 'success' | 'failed' | null; configSyncError?: string;
    historyLastSync?: string | null; historySyncResult?: 'success' | 'failed' | null; historySyncError?: string;
    lastJdCheck?: number; qiyuCheckStatus?: SyncStatus['qiyuCheckStatus'];
  };
  const migrated: SyncStatus = { syncByProfile: {}, lastJdCheck: legacy.lastJdCheck, qiyuCheckStatus: legacy.qiyuCheckStatus };
  if (legacy.configLastSync || legacy.historyLastSync) {
    migrated.syncByProfile.__legacy__ = {
      providerName: '未知服务',
      configLastSync: legacy.configLastSync ?? null,
      configSyncResult: legacy.configSyncResult ?? null,
      configSyncError: legacy.configSyncError,
      historyLastSync: legacy.historyLastSync ?? null,
      historySyncResult: legacy.historySyncResult ?? null,
      historySyncError: legacy.historySyncError,
    };
  }
  return migrated;
}

async function readStatus(): Promise<SyncStatus> {
  const saved = await syncStatusStore.get<Record<string, unknown>>('status');
  return saved ? migrate(saved) : { syncByProfile: {} };
}

export async function loadSyncRecords(): Promise<void> {
  try {
    const saved = await syncStatusStore.get<Record<string, unknown>>('status');
    const status = saved ? migrate(saved) : { syncByProfile: {} };
    if (saved && !('syncByProfile' in saved)) {
      await syncStatusStore.set('status', status);
      await syncStatusStore.save();
    }
    records.value = status.syncByProfile;
  } catch (error) {
    log.error('读取同步记录失败', error);
  }
}

/** 记一次同步结果（失败也记，状态行要写原因） */
export async function recordSync(profile: WebDAVProfile, kind: SyncKind, result: SyncResult, error?: string): Promise<void> {
  try {
    const status = await readStatus();
    const record: ProfileSyncRecord = status.syncByProfile[profile.id] ?? {
      providerName: profile.name, configLastSync: null, configSyncResult: null, historyLastSync: null, historySyncResult: null,
    };
    record.providerName = profile.name;
    if (kind === 'config') {
      record.configLastSync = getFullTimestamp();
      record.configSyncResult = result;
      record.configSyncError = error;
    } else {
      record.historyLastSync = getFullTimestamp();
      record.historySyncResult = result;
      record.historySyncError = error;
    }
    if (result === 'success') record.lastSyncAt = Date.now();
    status.syncByProfile[profile.id] = record;
    await syncStatusStore.set('status', status);
    await syncStatusStore.save();
    records.value = status.syncByProfile;
  } catch (e) {
    log.error('保存同步记录失败', e);
  }
}

export function useSyncRecords() {
  return {
    records,
    /** 这份连接最近一次成功同步的时间（毫秒）；旧记录没有这个字段 */
    lastSyncAt: (profileId: string): number | null => records.value[profileId]?.lastSyncAt ?? null,
  };
}

/** 测试用 */
export function __resetSyncRecordsForTests(): void {
  records.value = {};
}
