// 云同步卡的状态机（S05 / S11–S15）：空闲 → 同步中 → 成功 / 失败；「⋯」里的两个覆盖操作走同一条路。
// 同步中 / 成功 / 失败都写在状态行，不弹通知；状态是应用级的：同步中离开设置页照常跑完，回来看到结果。
// 下载过云端配置（合并改了本机、或覆盖本机）后出现刷新横幅，直到刷新为止。
import { computed, ref } from 'vue';
import type { WebDAVProfile } from '@/config/types';
import { decryptWithPassword, secureStorage } from '@/security/crypto';
import { createLogger } from '@/utils/logger';
import { formatCount } from '@/utils/formatters';
import { pullConfig, pushConfig, syncConfig, type DecryptContent } from '@/composables/backup-sync/ConfigSync';
import { pushHistory, syncHistory } from '@/composables/backup-sync/HistorySync';
import { SyncFailure } from '@/composables/backup-sync/backupSyncUtils';

const log = createLogger('CloudSync');

export interface SyncItems { config: boolean; history: boolean }

type Phase = 'idle' | 'syncing' | 'done' | 'failed';

const phase = ref<Phase>('idle');
const stage = ref<'config' | 'history' | null>(null);
/** 成功 / 失败时状态行写的那句 */
const message = ref('');
/** 别处的配置已写进本机、刷新后生效（S15 横幅）：cloud = 云端下载的，file = 从文件导入的 */
const needsReload = ref<'cloud' | 'file' | null>(null);
/** 遇到加密的云端配置 / 导入文件：设置页弹「输入备份密码」，验证通过才继续 */
const unlockRequest = ref<{ verify: (password: string) => Promise<boolean>; cancel: () => void } | null>(null);

const busy = computed(() => phase.value === 'syncing');

/** 本机设过同一个备份密码时钥匙串里的密钥就能解开，不问；解不开（新设备、别的密码）才弹「输入备份密码」 */
const decrypt: DecryptContent = (encrypted) => secureStorage.decrypt(encrypted).catch(() => askPassword(encrypted));

const askPassword = (encrypted: string) => new Promise<string>((resolve, reject) => {
  unlockRequest.value = {
    verify: async (password) => {
      try {
        const plain = await decryptWithPassword(encrypted, password);
        unlockRequest.value = null;
        resolve(plain);
        return true;
      } catch {
        return false;
      }
    },
    cancel: () => {
      unlockRequest.value = null;
      reject(new Error('user_cancelled'));
    },
  };
});

function isCancel(error: unknown): boolean {
  return error instanceof Error && error.message === 'user_cancelled';
}

/** 「已同步 · 上传 3 条 · 下载 5 条」；两边都没变化写「已是最新」 */
export function describeSync(result: { uploaded: number; downloaded: number; configChanged: boolean }): string {
  const parts: string[] = [];
  if (result.uploaded > 0) parts.push(`上传 ${formatCount(result.uploaded)} 条`);
  if (result.downloaded > 0) parts.push(`下载 ${formatCount(result.downloaded)} 条`);
  if (parts.length) return `已同步 · ${parts.join(' · ')}`;
  return result.configChanged ? '已同步 · 配置已更新' : '已是最新';
}

/** 失败的那句：原因 + 处理办法；云端已经合并进本机、只是回传失败时说清本机已经变了 */
export function describeFailure(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  if (error instanceof SyncFailure && error.partial) return `同步未完成：云端改动已合并到本机，回传失败（${reason}）`;
  return `同步失败：${reason}`;
}

async function run(task: () => Promise<string>): Promise<void> {
  if (busy.value) return;
  phase.value = 'syncing';
  message.value = '';
  try {
    message.value = await task();
    phase.value = 'done';
  } catch (error) {
    if (isCancel(error)) {
      phase.value = 'idle';
      return;
    }
    log.warn('云同步失败', error);
    if (error instanceof SyncFailure && error.partial && error.stage === 'config') needsReload.value = 'cloud';
    message.value = describeFailure(error);
    phase.value = 'failed';
  } finally {
    stage.value = null;
  }
}

/** 同步勾选的内容：先配置后记录，一步失败就停（已完成的照旧算数） */
function sync(profile: WebDAVProfile, items: SyncItems): Promise<void> {
  return run(async () => {
    let configChanged = false;
    let uploaded = 0;
    let downloaded = 0;
    if (items.config) {
      stage.value = 'config';
      configChanged = (await syncConfig(profile, decrypt)).changed;
      if (configChanged) needsReload.value = 'cloud';
    }
    if (items.history) {
      stage.value = 'history';
      ({ uploaded, downloaded } = await syncHistory(profile));
    }
    return describeSync({ uploaded, downloaded, configChanged });
  });
}

/** ⋯ › 用本机覆盖云端：勾选的配置与记录都以这台电脑为准（云端记录文件损坏、合并被中止时的出路） */
function overwriteCloud(profile: WebDAVProfile, items: SyncItems): Promise<void> {
  return run(async () => {
    if (items.config) { stage.value = 'config'; await pushConfig(profile); }
    if (items.history) { stage.value = 'history'; await pushHistory(profile); }
    return '已用本机覆盖云端';
  });
}

/** ⋯ › 用云端覆盖本机：只动配置（S14：上传记录不受影响） */
function overwriteLocal(profile: WebDAVProfile): Promise<void> {
  return run(async () => {
    stage.value = 'config';
    await pullConfig(profile, decrypt);
    needsReload.value = 'cloud';
    return '已用云端覆盖本机配置';
  });
}

export function useCloudSync() {
  return { phase, stage, message, busy, needsReload, unlockRequest, decrypt, sync, overwriteCloud, overwriteLocal };
}

/** 测试用 */
export function __resetCloudSyncForTests(): void {
  phase.value = 'idle';
  stage.value = null;
  message.value = '';
  needsReload.value = null;
  unlockRequest.value = null;
}
