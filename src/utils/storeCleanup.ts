import { readDir, remove } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { createLogger } from './logger';

const log = createLogger('StoreCleanup');

const KEEP_COUNT = 3;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

// 与 src/store/instances.ts 中所有 Store 实例对应
const STORE_BASENAMES = ['.settings.dat', '.sync-status.dat'];

interface BackupEntry {
  name: string;
  fullPath: string;
  timestamp: number;
}

function parseTimestamp(filename: string, basename: string): number {
  for (const suffix of ['corrupted', 'invalid']) {
    const prefix = `${basename}.${suffix}.`;
    if (filename.startsWith(prefix)) {
      const ts = Number(filename.slice(prefix.length));
      if (Number.isFinite(ts) && ts > 0) return ts;
    }
  }
  return -1;
}

async function cleanupForBasename(appDir: string, basename: string): Promise<void> {
  const entries = await readDir(appDir);
  const backups: BackupEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile) continue;
    const ts = parseTimestamp(entry.name, basename);
    if (ts === -1) continue;
    backups.push({ name: entry.name, fullPath: await join(appDir, entry.name), timestamp: ts });
  }

  if (backups.length === 0) return;

  backups.sort((a, b) => b.timestamp - a.timestamp);

  const now = Date.now();
  const toDelete = backups.filter(
    (entry, index) => index >= KEEP_COUNT && now - entry.timestamp > MAX_AGE_MS
  );

  if (toDelete.length === 0) return;

  log.info(`清理备份 [${basename}]：共 ${backups.length} 个，删除 ${toDelete.length} 个`);
  await Promise.all(
    toDelete.map(async entry => {
      try {
        await remove(entry.fullPath);
      } catch (err) {
        log.warn(`删除失败: ${entry.name}`, err);
      }
    })
  );
}

export async function cleanupStoreBackups(): Promise<void> {
  try {
    const appDir = await appDataDir();
    await Promise.all(STORE_BASENAMES.map(b => cleanupForBasename(appDir, b)));
  } catch (err) {
    log.warn('备份清理失败（非致命）', err);
  }
}
