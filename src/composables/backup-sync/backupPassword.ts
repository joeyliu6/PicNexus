// 备份密码的设置 / 修改 / 关闭：都是「换钥匙」——内层密文先用旧钥匙解开、换钥匙、再用新钥匙锁上，
// 外层配置文件用新钥匙重写；任一步失败都回滚到旧钥匙，免得配置永久解不开。
// 换完广播 SECURE_KEY_ROTATED_EVENT：托盘是独立 webview，有自己一份 secureStorage，不通知它会拿旧钥匙把配置整份覆盖。

import { invoke } from '@tauri-apps/api/core';
import { emit as emitTauriEvent } from '@tauri-apps/api/event';
import type { UserConfig } from '@/config/types';
import { secureStorage, SECURE_KEY_ROTATED_EVENT } from '@/security/crypto';
import { rekeyFieldSecrets, type RekeyReport } from '@/security/fieldSecrets';
import { configStore, syncStatusStore } from '@/store/instances';
import type { StoreData } from '@/store/types';
import { createLogger } from '@/utils/logger';
import { writeSyncLog } from './backupSyncUtils';

const log = createLogger('BackupPassword');

export type PasswordChange =
  | { mode: 'set'; password: string }
  | { mode: 'change'; currentPassword: string; newPassword: string }
  | { mode: 'disable'; currentPassword: string };

/** 当前密码不对（调用方据此在弹窗里标红，不关弹窗） */
export class WrongPasswordError extends Error {
  constructor() {
    super('密码不正确');
    this.name = 'WrongPasswordError';
  }
}

async function rollbackKey(oldKeyB64: string): Promise<void> {
  await invoke('set_secure_key', { key: oldKeyB64 });
  await secureStorage.forceReinit();
}

/** 读配置 → 记下旧钥匙 → 换钥匙（含内层密文搬运）→ 用新钥匙重写；任一步失败回滚 */
async function swapKeyAndReencrypt(swap: () => Promise<void>): Promise<RekeyReport> {
  const configRaw = await configStore.readRawAll();
  const config = configRaw?.config as UserConfig | undefined;
  const syncStatusRaw = await syncStatusStore.readRawAll().catch(() => null);
  const oldKeyB64 = await invoke<string>('get_or_create_secure_key');

  const snapshots = [configRaw, syncStatusRaw].filter((s): s is StoreData => !!s);
  let report: RekeyReport;
  try {
    report = await rekeyFieldSecrets(snapshots, swap);
  } catch (error) {
    // swap 抛在写钥匙串之前时回滚是同值重写、无副作用；之后才是必须的。分不清就一律回滚
    log.error('换密钥或内层密文搬运失败，回滚密钥', error);
    await rollbackKey(oldKeyB64);
    throw error;
  }

  if (config) {
    try {
      await configStore.setDirect({ ...(configRaw ?? {}), config });
    } catch (error) {
      log.error('迁移密码重新加密写回失败，回滚密钥', error);
      await rollbackKey(oldKeyB64);
      throw error;
    }
  }

  if (syncStatusRaw && Object.keys(syncStatusRaw).length > 0) {
    await syncStatusStore.setDirect(syncStatusRaw).catch((error) => log.warn('syncStatusStore 重新加密失败（非致命）', error));
  }
  return report;
}

/**
 * 设置 / 修改 / 关闭备份密码。当前密码不对抛 WrongPasswordError；
 * 返回的 orphans 是用旧钥匙就已经解不开的密文（不是这次弄坏的），调用方要说清楚。
 */
export async function changeBackupPassword(change: PasswordChange): Promise<RekeyReport> {
  if (change.mode !== 'set' && !(await secureStorage.verifyBackupPassword(change.currentPassword))) {
    throw new WrongPasswordError();
  }
  const report = await swapKeyAndReencrypt(() => (change.mode === 'disable'
    ? secureStorage.clearBackupPassword()
    : secureStorage.setBackupPassword(change.mode === 'set' ? change.password : change.newPassword)));
  await emitTauriEvent(SECURE_KEY_ROTATED_EVENT);
  await writeSyncLog(change.mode === 'set' ? 'password_set' : change.mode === 'change' ? 'password_change' : 'password_disable', 'success');
  return report;
}

export function hasBackupPassword(): boolean {
  return secureStorage.isPasswordMode();
}
