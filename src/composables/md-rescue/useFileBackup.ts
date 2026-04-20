// MD 文档救援 — 文件备份与替换
// 负责：执行链接替换、撤销替换、清理旧备份

import { readTextFile, writeTextFile, copyFile, readDir, mkdir, remove } from '@tauri-apps/plugin-fs';
import { join, dirname, basename } from '@tauri-apps/api/path';
import { useToast } from '../useToast';
import { createLogger } from '../../utils/logger';
import { replaceImageLinks } from '../../utils/mdParser';
import { saveLastRepair, clearLastRepair } from './useMdRescueLastRepair';
import {
  type RepairReceipt,
  isReplacing,
  isCancelled,
  phase,
  healedFiles,
  fixingProgress,
  repairReceipt,
  mode,
  filePath,
  folderPath,
  imageLinks,
  fileContent,
} from './shared';

const log = createLogger('MdRescue:Backup');

/**
 * 执行链接替换（支持多文件），推进 fixing → done 阶段
 * @param unrescuableCount 无法自动修复的链接数（由调用方传入）
 */
export async function executeReplace(unrescuableCount: number): Promise<{
  success: number;
  skipped: number;
  failed: number;
}> {
  const toast = useToast();

  isReplacing.value = true;
  isCancelled.value = false;
  phase.value = 'fixing';
  healedFiles.value = new Set();

  const fileReplacements = new Map<string, Map<string, string>>();
  let skipped = 0;

  for (const link of imageLinks.value) {
    if (!link.checkResult || link.checkResult.is_valid || !link.selectedBackup) {
      skipped++;
      continue;
    }
    if (!fileReplacements.has(link.sourceFile)) {
      fileReplacements.set(link.sourceFile, new Map());
    }
    fileReplacements.get(link.sourceFile)!.set(link.url, link.selectedBackup);
  }

  if (fileReplacements.size === 0) {
    isReplacing.value = false;
    phase.value = 'done';
    repairReceipt.value = {
      filesFixed: 0,
      linksFixed: 0,
      unrescuableCount,
      backupPath: '',
      fileBackupMap: [],
    };
    return { success: 0, skipped: imageLinks.value.length, failed: 0 };
  }

  fixingProgress.value = { current: 0, total: fileReplacements.size };

  try {
    let totalSuccess = 0;
    let totalFailed = 0;
    const fileBackupMap: RepairReceipt['fileBackupMap'] = [];

    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

    const backupRoot = mode.value === 'folder' && folderPath.value
      ? folderPath.value
      : (filePath.value ? await dirname(filePath.value) : null);

    if (!backupRoot) {
      toast.error('备份失败', '无法确定备份路径');
      isReplacing.value = false;
      phase.value = 'scanning';
      return { success: 0, skipped: 0, failed: 1 };
    }

    const backupDir = await join(backupRoot, '.picnexus-backup', ts);
    await mkdir(backupDir, { recursive: true });

    let filesProcessed = 0;
    for (const [file, replacements] of fileReplacements) {
      if (isCancelled.value) {
        log.info('修复被取消，已完成部分文件');
        break;
      }
      try {
        const content = await readTextFile(file);

        let bakPath: string;
        if (mode.value === 'folder' && folderPath.value) {
          // 确保 folderPath 以 / 结尾，避免 /foo 错误匹配 /foobar
          const normalizedFolder = folderPath.value.replace(/\\/g, '/').replace(/\/?$/, '/');
          const relativePath = file.replace(/\\/g, '/').replace(normalizedFolder, '');
          bakPath = await join(backupDir, relativePath);
          const bakParent = await dirname(bakPath);
          await mkdir(bakParent, { recursive: true });
        } else {
          const fileName = await basename(file);
          bakPath = await join(backupDir, fileName);
        }
        await copyFile(file, bakPath);
        fileBackupMap.push({ original: file, backup: bakPath });

        const newContent = replaceImageLinks(content, replacements);
        await writeTextFile(file, newContent);

        if (mode.value === 'file' && file === filePath.value) {
          fileContent.value = newContent;
        }

        filesProcessed++;
        totalSuccess += replacements.size;
        // 实时更新已治愈文件集合（触发 fileHealthList 响应式更新）
        const next = new Set(healedFiles.value);
        next.add(file);
        healedFiles.value = next;
        fixingProgress.value = { ...fixingProgress.value, current: fixingProgress.value.current + 1 };

        log.info(`替换完成: ${file} (${replacements.size} 条，备份: ${bakPath})`);
      } catch (err) {
        log.error(`替换失败: ${file}`, err);
        totalFailed += replacements.size;
        fixingProgress.value = { ...fixingProgress.value, current: fixingProgress.value.current + 1 };
      }
    }

    await cleanupOldBackups(backupRoot, 5);

    repairReceipt.value = {
      filesFixed: filesProcessed,
      linksFixed: totalSuccess,
      unrescuableCount,
      backupPath: backupDir,
      fileBackupMap,
    };

    if (totalSuccess > 0 && fileBackupMap.length > 0) {
      saveLastRepair({
        date: Date.now(),
        filesFixed: filesProcessed,
        linksFixed: totalSuccess,
        backupPath: backupDir,
        fileBackupMap,
      });
    }

    phase.value = 'done';
    return { success: totalSuccess, skipped, failed: totalFailed };
  } catch (err) {
    log.error('替换失败', err);
    toast.error('替换失败', String(err));
    phase.value = 'scanning';
    return { success: 0, skipped: 0, failed: 1 };
  } finally {
    isReplacing.value = false;
  }
}

/**
 * 撤销所有替换，从备份恢复原始文件
 * @param resetFn 重置函数（由主模块传入）
 */
export async function undoReplace(resetFn: () => void): Promise<void> {
  const toast = useToast();

  if (!repairReceipt.value?.fileBackupMap.length) return;

  try {
    for (const { original, backup } of repairReceipt.value.fileBackupMap) {
      await copyFile(backup, original);
      log.info(`已恢复: ${original}`);
    }
    clearLastRepair();
    toast.success('撤销完成', '已恢复所有文件至修复前状态');
  } catch (err) {
    log.error('撤销失败', err);
    toast.error('撤销失败', String(err));
  }

  resetFn();
}

/**
 * 清理旧备份目录，保留最近 N 次
 */
export async function cleanupOldBackups(rootDir: string, keepCount: number): Promise<void> {
  try {
    const backupBase = await join(rootDir, '.picnexus-backup');
    const entries = await readDir(backupBase);
    const dirs = entries
      .filter((e) => e.isDirectory && /^\d{8}_\d{6}$/.test(e.name))
      .map((e) => e.name)
      .sort();

    if (dirs.length <= keepCount) return;

    const toRemove = dirs.slice(0, dirs.length - keepCount);
    for (const dir of toRemove) {
      const dirPath = await join(backupBase, dir);
      await remove(dirPath, { recursive: true });
      log.info(`已清理旧备份: ${dirPath}`);
    }
  } catch {
    // 清理失败不影响主流程
  }
}
