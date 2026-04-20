// MD 文档救援 — 上次修复记录（跨会话持久化）
// 数据存在 localStorage，用于 idle 态展示"上次修复摘要 + 一键撤销"

import { ref, onMounted, onActivated } from 'vue';
import { copyFile, exists } from '@tauri-apps/plugin-fs';
import { createLogger } from '../../utils/logger';

const log = createLogger('MdRescue:LastRepair');

export interface FileBackupPair {
  original: string;
  backup: string;
}

export interface LastRepairRecord {
  date: number;
  filesFixed: number;
  linksFixed: number;
  backupPath: string;
  fileBackupMap: FileBackupPair[];
}

const STORAGE_KEY = 'lastRepair.md-rescue';

function isRecord(value: unknown): value is LastRepairRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<LastRepairRecord>;
  return (
    typeof v.date === 'number'
    && typeof v.filesFixed === 'number'
    && typeof v.linksFixed === 'number'
    && typeof v.backupPath === 'string'
    && Array.isArray(v.fileBackupMap)
  );
}

// 模块级共享 ref：所有 useLastRepair() 调用共享同一引用
// 否则 RescueLastRepairCard 撤销后无法通知其他消费方（如 RescueIdleZone 的空态分支）
const sharedRecord = ref<LastRepairRecord | null>(null);
let sharedInitialized = false;

function refreshShared(): void {
  sharedRecord.value = readLastRepair();
}

export function readLastRepair(): LastRepairRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch (err) {
    log.warn('读取上次修复记录失败', err);
    return null;
  }
}

export function saveLastRepair(record: LastRepairRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (err) {
    log.warn('写入上次修复记录失败', err);
  }
  refreshShared();
}

export function clearLastRepair(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    log.warn('清除上次修复记录失败', err);
  }
  refreshShared();
}

/**
 * 从备份恢复所有文件（用于 idle 态"撤销上次修复"）
 * 与 useFileBackup.undoReplace 不同：不依赖运行时 repairReceipt，直接从持久化记录恢复
 * 并发恢复：单文件耗时极短，文件数量通常几到几十，串行浪费 I/O 等待
 */
export async function undoLastRepair(record: LastRepairRecord): Promise<{ restored: number; failed: number }> {
  const results = await Promise.allSettled(
    record.fileBackupMap.map((pair) => copyFile(pair.backup, pair.original)),
  );
  let restored = 0;
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      restored++;
    } else {
      log.error(`恢复失败: ${record.fileBackupMap[i]?.original}`, r.reason);
      failed++;
    }
  });
  return { restored, failed };
}

/**
 * 检查备份目录是否仍存在（供 UI 决定撤销按钮是否可用）
 */
export async function isLastRepairRestorable(record: LastRepairRecord): Promise<boolean> {
  try {
    return await exists(record.backupPath);
  } catch {
    return false;
  }
}

/**
 * 组件内使用：挂载 / 激活时读取 lastRepair
 */
export function useLastRepair() {
  if (!sharedInitialized) {
    refreshShared();
    sharedInitialized = true;
  }

  onMounted(refreshShared);
  onActivated(refreshShared);

  return { record: sharedRecord, refresh: refreshShared };
}
