// 文档读写（交接说明 13.4）：修复时先把原文件备份到 <文档文件夹>/.picnexus-backup/<时间戳>/，再整份替换；
// 撤销按备份还原，修复后又被改过的文档不还原；写不成的给出具体原因。
//
// 沿用旧「文档修复」踩过的坑：非 UTF-8 一律不碰（读进来就是乱码，写回去会永久损坏原文）；
// 原文件的 BOM 写回时补回；备份路径一文件一路径（同名文件互不覆盖）；还原限并发，免得一次打开上千个文件。

import { copyFile, mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { basename, dirname, join } from '@tauri-apps/api/path';
import pLimit from 'p-limit';
import { NonUtf8FileError, readUtf8TextFile, writeUtf8TextFile } from './mdTextIo';
import { formatTimestampCompact } from '@/utils/formatters';
import { createLogger } from '@/utils/logger';
import { replaceImageLinks } from '@/utils/mdParser';
import type { DocWrite } from './docIndex';

const log = createLogger('HealthDocs');

/**
 * 备份目录名。必须与 Rust 侧 `src-tauri/src/commands/md_scanner.rs` 的 `BACKUP_DIR_NAME` 一致
 * （`scripts/check-cross-language-constants.mjs` 守着）：扫描靠它跳过备份目录。
 */
const BACKUP_DIR_NAME = '.picnexus-backup';

/** 每个文档文件夹保留最近几次修复的备份 */
const KEEP_BACKUPS = 5;
/** 还原时同时打开的文件数上限（上千个文档时防 EMFILE） */
const RESTORE_CONCURRENCY = 8;

/** 写入成功的一个文档：撤销要用 */
export interface WrittenDoc {
  path: string;
  backup: string;
  /** 写进去的内容（不含 BOM）：撤销前比对，修复后又被改过就不还原 */
  content: string;
  places: number;
}

export interface FailedDoc {
  path: string;
  name: string;
  /** 「README.md 被其他程序占用，请关闭后重试」：原因 + 处理办法 */
  message: string;
  write: DocWrite;
}

export interface WriteOutcome {
  written: WrittenDoc[];
  failed: FailedDoc[];
}

/** 写入 / 还原失败 → 原因 + 处理办法 */
export function describeDocError(name: string, error: unknown): string {
  if (error instanceof NonUtf8FileError) return `${name} 编码不受支持（非 UTF-8），已跳过`;
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (/os error 32|os error 33|being used by another process|resource busy|ebusy|locked/.test(text)) {
    return `${name} 被其他程序占用，请关闭后重试`;
  }
  if (/os error 5\b|access is denied|permission denied|eacces|eperm|forbidden path|not allowed|read-only/.test(text)) {
    return `${name} 没有写入权限，请检查文件权限后重试`;
  }
  if (/os error 2\b|os error 3\b|no such file|not found|cannot find|enoent/.test(text)) {
    return `${name} 找不到了，可能已被移动或删除`;
  }
  return `${name} 写入失败，请稍后重试`;
}

/** `\\?\C:\x` → `C:\x`，`\\?\UNC\srv\share` → `\\srv\share`（Rust 扫描已剥过，这里是第二道防线） */
function stripVerbatimPrefix(path: string): string {
  if (path.startsWith('\\\\?\\UNC\\')) return '\\\\' + path.slice(8);
  if (path.startsWith('\\\\?\\')) return path.slice(4);
  return path;
}

/**
 * 文件相对文件夹的路径；算不出来返回 null。Windows 上对话框与 Rust canonicalize 给的大小写可能不同，
 * 所以前缀比对不分大小写。
 */
export function relativeToFolder(folder: string, file: string): string | null {
  const normFolder = stripVerbatimPrefix(folder).replace(/\\/g, '/').replace(/\/+$/, '');
  const normFile = stripVerbatimPrefix(file).replace(/\\/g, '/');
  if (!normFolder) return null;
  return normFile.toLowerCase().startsWith(normFolder.toLowerCase() + '/') ? normFile.slice(normFolder.length + 1) : null;
}

/** 路径的短 hash（FNV-1a 32 位）：相对路径算不出时给备份文件名防撞 */
function hashPath(path: string): string {
  let h = 0x811c9dc5;
  const normalized = path.replace(/\\/g, '/');
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function backupPathFor(backupDir: string, folder: string, file: string): Promise<string> {
  const relative = relativeToFolder(folder, file);
  if (relative) {
    const path = await join(backupDir, relative);
    await mkdir(await dirname(path), { recursive: true });
    return path;
  }
  return join(backupDir, `${hashPath(file)}_${await basename(file)}`);
}

/** 每个文件夹只留最近 KEEP_BACKUPS 次备份；清理失败不影响修复 */
async function pruneBackups(folder: string): Promise<void> {
  try {
    const base = await join(folder, BACKUP_DIR_NAME);
    const dirs = (await readDir(base))
      .filter((e) => e.isDirectory && /^\d{8}_\d{6}(_\d{3})?$/.test(e.name))
      .map((e) => e.name)
      .sort();
    await Promise.allSettled(dirs.slice(0, Math.max(0, dirs.length - KEEP_BACKUPS)).map(async (dir) => remove(await join(base, dir), { recursive: true })));
  } catch (error) {
    log.warn('清理旧备份失败', error);
  }
}

/** 逐个文档：读（严格 UTF-8）→ 换 → 没变就跳过 → 备份 → 写回 */
export async function writeDocs(writes: readonly DocWrite[], now: Date = new Date()): Promise<WriteOutcome> {
  const outcome: WriteOutcome = { written: [], failed: [] };
  if (writes.length === 0) return outcome;
  // 精确到毫秒：同一秒里连着修两次（两行「改用」引用了同一个文档），第二次的备份不能盖掉第一次的原文
  const stamp = `${formatTimestampCompact(now)}_${String(now.getMilliseconds()).padStart(3, '0')}`;
  const backupDirs = new Map<string, string>();
  for (const write of writes) {
    try {
      // 先读：非 UTF-8 在这里就抛，既不留备份也不写回
      const { content, hasBom } = await readUtf8TextFile(write.path);
      const next = replaceImageLinks(content, write.replacements);
      if (next === content) continue;
      let backupDir = backupDirs.get(write.folder);
      if (!backupDir) {
        backupDir = await join(write.folder, BACKUP_DIR_NAME, stamp);
        await mkdir(backupDir, { recursive: true });
        backupDirs.set(write.folder, backupDir);
      }
      const backup = await backupPathFor(backupDir, write.folder, write.path);
      await copyFile(write.path, backup);
      await writeUtf8TextFile(write.path, next, hasBom);
      outcome.written.push({ path: write.path, backup, content: next, places: write.places });
    } catch (error) {
      log.warn(`文档写入失败: ${write.name}`, error);
      outcome.failed.push({ path: write.path, name: write.name, message: describeDocError(write.name, error), write });
    }
  }
  await Promise.all([...backupDirs.keys()].map(pruneBackups));
  return outcome;
}

export interface RestoreOutcome {
  restored: string[];
  /** 修复后又被改过：不还原，备份留着 */
  modified: string[];
  failed: Array<{ path: string; message: string }>;
}

/** 撤销：按备份还原；当前内容已不是我们写进去的那份就跳过 */
export async function restoreDocs(docs: readonly WrittenDoc[]): Promise<RestoreOutcome> {
  const outcome: RestoreOutcome = { restored: [], modified: [], failed: [] };
  const limit = pLimit(RESTORE_CONCURRENCY);
  await Promise.all(docs.map((doc) => limit(async () => {
    const name = doc.path.split(/[/\\]/).pop() ?? doc.path;
    try {
      const { content } = await readUtf8TextFile(doc.path);
      if (content !== doc.content) {
        outcome.modified.push(doc.path);
        return;
      }
      await copyFile(doc.backup, doc.path);
      outcome.restored.push(doc.path);
    } catch (error) {
      log.warn(`文档还原失败: ${name}`, error);
      outcome.failed.push({ path: doc.path, message: describeDocError(name, error) });
    }
  })));
  return outcome;
}
