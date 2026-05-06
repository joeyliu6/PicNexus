// MD 文档救援 — 文件备份与替换
// 负责：执行链接替换、撤销替换、清理旧备份

import { readTextFile, writeTextFile, copyFile, readDir, mkdir, remove } from '@tauri-apps/plugin-fs';
import { join, dirname, basename } from '@tauri-apps/api/path';
import pLimit from 'p-limit';
import { useToast } from '../useToast';
import { createLogger } from '../../utils/logger';
import { formatTimestampCompact } from '../../utils/formatters';
import { replaceImageLinks } from '../../utils/mdParser';
import { saveLastRepair, clearLastRepair, readLastRepair } from './useMdRescueLastRepair';
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
  mdFiles,
  imageLinks,
  includeCodeBlocks,
  fileContent,
} from './shared';

const log = createLogger('MdRescue:Backup');

/**
 * 撤销时的 copyFile 并发上限。
 * Why: folder 模式批量修复后，fileBackupMap 可能上千项，一次性 fan-out
 * Promise.all 会同时打开同等数量的文件描述符，Windows 上易触发 EMFILE 或资源争用。
 * 8 是经验值，足够吃满 SSD IO 又不至于压垮系统。
 */
const UNDO_COPY_CONCURRENCY = 8;

function formatFailureReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 计算文件相对于文件夹的路径。
 * Windows 上 selectFolder 与 Rust canonicalize 可能返回不同大小写（如 `C:\Users\Foo`
 * vs `c:\users\foo`），直接 string.replace 会匹配失败导致 relativePath = 完整绝对路径，
 * 进而 backup 拼出含驱动器盘符的非法目录名。这里做大小写不敏感前缀比对。
 *
 * Linux 大小写敏感 FS 上不会出现伪命中：file 路径全部来自扫描同一 folder 子树，
 * 与 folder 的大小写天然一致。
 */
function computeRelativePath(folder: string, file: string): string {
  const normFolder = folder.replace(/\\/g, '/').replace(/\/+$/, '');
  const normFile = file.replace(/\\/g, '/');
  const folderPrefix = normFolder.toLowerCase() + '/';
  if (normFile.toLowerCase().startsWith(folderPrefix)) {
    return normFile.slice(normFolder.length + 1);
  }
  // 兜底：file 不在 folder 下时退化为 basename，避免备份目录构造异常
  return normFile.split('/').pop() || normFile;
}

/** 对路径计算短 hash（8 字符），用于多文件拖入时做备份文件名防撞前缀 */
function hashPath(path: string): string {
  let h = 0x811c9dc5; // FNV-1a 32bit seed
  const normalized = path.replace(/\\/g, '/');
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 8 字符 = 32 bit 全输出（FNV-1a 32 上限）。原 6 字符在 4096 文件量级即有 ~50% 碰撞概率
  return (h >>> 0).toString(16).padStart(8, '0');
}

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
      failedFiles: [],
    };
    return { success: 0, skipped: imageLinks.value.length, failed: 0 };
  }

  fixingProgress.value = { current: 0, total: fileReplacements.size };

  try {
    let totalSuccess = 0;
    let totalFailed = 0;
    const fileBackupMap: RepairReceipt['fileBackupMap'] = [];
    const failedFiles: RepairReceipt['failedFiles'] = [];

    const ts = formatTimestampCompact();

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
          const relativePath = computeRelativePath(folderPath.value, file);
          bakPath = await join(backupDir, relativePath);
          const bakParent = await dirname(bakPath);
          await mkdir(bakParent, { recursive: true });
        } else if (mdFiles.value.length > 1) {
          // 多文件拖入：不同目录下的同名文件不能共用 basename，否则 undo 会互相覆盖
          // 用 path hash 前缀 + basename 保留可读性
          const fileName = await basename(file);
          bakPath = await join(backupDir, `${hashPath(file)}_${fileName}`);
        } else {
          const fileName = await basename(file);
          bakPath = await join(backupDir, fileName);
        }
        await copyFile(file, bakPath);
        fileBackupMap.push({ original: file, backup: bakPath });

        const newContent = replaceImageLinks(content, replacements, {
          includeCodeBlocks: includeCodeBlocks.value,
        });
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
        failedFiles.push({
          file,
          links: replacements.size,
          error: formatFailureReason(err),
        });
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
      failedFiles,
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

  const receipt = repairReceipt.value;
  if (!receipt?.fileBackupMap.length) return;

  // 半失败语义：单文件 copyFile 失败不应中断其余文件的恢复，也不应整体回滚 receipt
  // 原 try/for-await 实现里，第 N 个失败会丢失前 N-1 个已恢复文件的可见性，
  // 且 resetFn() 仍执行 → 用户失去重试入口
  // 用 p-limit 限并发，避免 fileBackupMap 上千项时同时打开等量文件描述符
  const limit = pLimit(UNDO_COPY_CONCURRENCY);
  const results = await Promise.allSettled(
    receipt.fileBackupMap.map(({ backup, original }) =>
      limit(() => copyFile(backup, original)),
    ),
  );

  let restored = 0;
  const failedPairs: RepairReceipt['fileBackupMap'] = [];
  results.forEach((r, i) => {
    const pair = receipt.fileBackupMap[i];
    if (r.status === 'fulfilled') {
      restored++;
      log.info(`已恢复: ${pair.original}`);
    } else {
      log.error(`恢复失败: ${pair.original}`, r.reason);
      failedPairs.push(pair);
    }
  });

  if (failedPairs.length === 0) {
    clearLastRepair();
    toast.success('已撤销', '已恢复所有文件至修复前状态');
    resetFn();
    return;
  }

  if (restored === 0) {
    // 全失败：保留 receipt，让用户能再次点击撤销重试
    toast.error('撤销失败', `${failedPairs.length} 个文件恢复失败`);
    return;
  }

  // 半成功：把 receipt 收窄到失败项，用户可针对性重试
  repairReceipt.value = { ...receipt, fileBackupMap: failedPairs };
  const persisted = readLastRepair();
  if (persisted?.backupPath === receipt.backupPath) {
    saveLastRepair({
      ...persisted,
      filesFixed: failedPairs.length,
      fileBackupMap: failedPairs,
    });
  }
  toast.error(
    '部分撤销失败',
    `已恢复 ${restored} 个，${failedPairs.length} 个失败（保留以便重试）`,
  );
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
    // 并行清理：旧目录互不依赖，且单目录被外部锁定也不阻塞其余
    await Promise.allSettled(toRemove.map(async (dir) => {
      const dirPath = await join(backupBase, dir);
      try {
        await remove(dirPath, { recursive: true });
        log.info(`已清理旧备份: ${dirPath}`);
      } catch (err) {
        log.warn(`清理旧备份失败，跳过: ${dirPath}`, err);
      }
    }));
  } catch {
    // 清理失败不影响主流程
  }
}
