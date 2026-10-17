// 手动备份（S05「手动备份」）：导出配置、导出上传记录、从文件导入（自动认出是配置还是记录）。
// 导出的配置设了备份密码时加密；导入配置时留本机的同步连接与文档文件夹（同云同步合并的口径）。
// 每次导入导出都记进同步日志，设置页「最近操作」读它。

import { historyDB } from '@/services/database';
import { invalidateCache } from '@/composables/history/useHistory';
import { emitHistoryUpdated } from '@/events/cacheEvents';
import { isValidUserConfig, type UserConfig } from '@/config/types';
import { configStore } from '@/store/instances';
import { secureStorage, isPasswordEncryptedData } from '@/security/crypto';
import { formatCount } from '@/utils/formatters';
import { exportTextFile, importTextFile } from '@/utils/userFiles';
import { writeSyncLog } from './backupSyncUtils';
import { mergeCloudConfig, type DecryptContent } from './ConfigSync';

const JSON_FILTER = [{ name: 'JSON', extensions: ['json'] }];

export const UNRECOGNIZED_FILE = '无法识别这个文件，请选择 PicNexus 导出的配置或上传记录';

export type BackupFile =
  | { kind: 'config'; config: UserConfig }
  | { kind: 'history'; content: string; count: number };

/** 认出文件里是什么：加密的或对象 = 配置，数组 = 上传记录；都不是就报无法识别 */
export async function parseBackupFile(raw: string, decrypt: DecryptContent): Promise<BackupFile> {
  const text = raw.trim();
  if (!text) throw new Error(UNRECOGNIZED_FILE);
  const content = isPasswordEncryptedData(text) ? await decrypt(text) : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(UNRECOGNIZED_FILE);
  }
  if (Array.isArray(parsed)) return { kind: 'history', content, count: parsed.length };
  if (isValidUserConfig(parsed)) return { kind: 'config', config: parsed };
  throw new Error(UNRECOGNIZED_FILE);
}

/** 导出配置；用户取消选文件返回 null，否则返回保存到的路径 */
export async function exportConfigFile(): Promise<string | null> {
  try {
    const config = await configStore.get<UserConfig>('config');
    if (!config || !isValidUserConfig(config)) throw new Error('本机配置读取失败，请重启应用后重试');
    const json = JSON.stringify(config, null, 2);
    const content = secureStorage.isPasswordMode() ? await secureStorage.encrypt(json) : json;
    const path = await exportTextFile('picnexus_settings.json', JSON_FILTER, content);
    if (path) await writeSyncLog('export_settings_local', 'success', path);
    return path;
  } catch (error) {
    await writeSyncLog('export_settings_local', 'failed', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** 导出上传记录；没有记录时抛错，用户取消返回 null */
export async function exportHistoryFile(): Promise<{ path: string; count: number } | null> {
  try {
    const count = await historyDB.getCount();
    if (count === 0) throw new Error('还没有上传记录');
    const path = await exportTextFile('picnexus_history.json', JSON_FILTER, await historyDB.exportToJSON());
    if (!path) return null;
    await writeSyncLog('export_history_local', 'success', path);
    return { path, count };
  } catch (error) {
    await writeSyncLog('export_history_local', 'failed', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** 选一个文件读出来；用户取消返回 null */
export async function pickBackupFile(decrypt: DecryptContent): Promise<BackupFile | null> {
  const raw = await importTextFile(JSON_FILTER);
  if (raw === null) return null;
  return parseBackupFile(raw, decrypt);
}

/** 用文件里的配置替换本机配置（本机的同步连接与文档文件夹保留） */
export async function importConfig(config: UserConfig): Promise<void> {
  try {
    const local = await configStore.get<UserConfig>('config');
    await configStore.set('config', local ? mergeCloudConfig(config, local) : config);
    await configStore.save();
    await writeSyncLog('import_settings_local', 'success');
  } catch (error) {
    await writeSyncLog('import_settings_local', 'failed', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** 把文件里的上传记录合并进本机（已有的不删）；返回新增、跳过（格式无效）与合并后的总数 */
export async function importHistory(content: string): Promise<{ added: number; skipped: number; total: number }> {
  try {
    const imported = await historyDB.importFromJSON(content, 'merge');
    const total = await historyDB.getCount();
    invalidateCache();
    emitHistoryUpdated();
    const skipped = imported.skipped > 0 ? `，跳过 ${formatCount(imported.skipped)} 条格式无效记录` : '';
    await writeSyncLog('import_history_local', 'success', `新增 ${formatCount(imported.added)} 条，共 ${formatCount(total)} 条${skipped}`);
    return { added: imported.added, skipped: imported.skipped, total };
  } catch (error) {
    await writeSyncLog('import_history_local', 'failed', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
