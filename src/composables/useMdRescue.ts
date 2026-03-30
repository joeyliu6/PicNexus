// MD 文档救援 Composable
// 负责解析 MD 文件、检测失效图片链接、匹配备用链接、执行替换
// 支持单文件和文件夹（递归扫描所有 MD 文件）

import { ref, shallowRef, computed, type Ref } from 'vue';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, copyFile, readDir } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import type { UserConfig } from '../config/types';
import { useConfigManager } from './useConfig';
import { applyLinkPrefix } from './useCopyLink';
import { historyDB } from '../services/HistoryDatabase';
import { useLinkCheckManager } from './useLinkCheck';
import { useToast } from './useToast';
import { createLogger } from '../utils/logger';
import { extractImageLinks, stripKnownPrefixes, replaceImageLinks } from '../utils/mdParser';
import type {
  MdImageLink,
  MdBackupLink,
  BatchCheckRequestItem,
  CheckLinkResult,
} from '../types/linkCheck';

const log = createLogger('MdRescue');

/** 带文件路径信息的图片链接 */
export interface MdImageLinkWithFile extends MdImageLink {
  /** 所属文件路径 */
  sourceFile: string;
  /** 所属文件显示名 */
  sourceFileName: string;
}

// ============================================
// 单例共享状态
// ============================================

/** 选择模式：单文件 or 文件夹 */
const mode: Ref<'file' | 'folder' | null> = ref(null);
const filePath: Ref<string | null> = ref(null);
const folderPath: Ref<string | null> = ref(null);
/** 文件夹模式下扫描到的 MD 文件列表 */
const mdFiles: Ref<string[]> = shallowRef([]);
const fileContent: Ref<string | null> = ref(null);
const imageLinks: Ref<MdImageLinkWithFile[]> = shallowRef([]);
const isAnalyzing = ref(false);
const isReplacing = ref(false);
/** 用户排除的 URL 集合（不参与检测） */
const excludedUrls: Ref<Set<string>> = ref(new Set());

// URL → historyId 内存索引（延迟建立）
let urlIndex: Map<string, { historyId: string; serviceId: string }[]> | null = null;

const MD_EXTENSIONS = ['.md', '.markdown'];

export function useMdRescueManager() {
  const toast = useToast();
  const { loadConfig } = useConfigManager();
  const { checkUrls, isChecking, progress } = useLinkCheckManager();

  // 统计
  const stats = computed(() => {
    const links = imageLinks.value;
    const total = links.length;
    const checked = links.filter((l) => l.checkResult).length;
    const valid = links.filter((l) => l.checkResult?.is_valid).length;
    const broken = links.filter((l) => l.checkResult && !l.checkResult.is_valid).length;
    const rescuable = links.filter(
      (l) => l.checkResult && !l.checkResult.is_valid && l.backupLinks && l.backupLinks.length > 0,
    ).length;
    const unresolvable = broken - rescuable;

    return { total, checked, valid, broken, rescuable, unresolvable };
  });

  /** 显示路径（单文件 or 文件夹） */
  const displayPath = computed(() => {
    if (mode.value === 'folder' && folderPath.value) {
      return folderPath.value;
    }
    return filePath.value;
  });

  /** 显示标签（文件夹模式下显示文件数） */
  const displayLabel = computed(() => {
    if (mode.value === 'folder' && mdFiles.value.length > 0) {
      return `${mdFiles.value.length} 个 MD 文件`;
    }
    return null;
  });

  /**
   * 递归扫描目录下所有 MD 文件
   */
  async function scanMdFiles(dirPath: string): Promise<string[]> {
    const results: string[] = [];

    try {
      const entries = await readDir(dirPath);
      for (const entry of entries) {
        const fullPath = await join(dirPath, entry.name);
        if (entry.isDirectory) {
          const subFiles = await scanMdFiles(fullPath);
          results.push(...subFiles);
        } else if (entry.isFile) {
          const lower = entry.name.toLowerCase();
          if (MD_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
            results.push(fullPath);
          }
        }
      }
    } catch (err) {
      log.warn(`扫描目录失败: ${dirPath}`, err);
    }

    return results;
  }

  /**
   * 从文件路径提取文件名
   */
  function getFileName(path: string): string {
    return path.replace(/\\/g, '/').split('/').pop() || path;
  }

  /**
   * 选择单个 MD 文件
   */
  async function selectMdFile(): Promise<boolean> {
    try {
      const selected = await dialogOpen({
        multiple: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
      });

      if (!selected) return false;
      const path = typeof selected === 'string' ? selected : (selected as string[])[0];
      if (!path) return false;

      mode.value = 'file';
      filePath.value = path;
      folderPath.value = null;
      mdFiles.value = [];
      const content = await readTextFile(path);
      fileContent.value = content;

      // 解析图片链接
      const links = extractImageLinks(content);
      imageLinks.value = links.map((l) => ({
        ...l,
        sourceFile: path,
        sourceFileName: getFileName(path),
      }));

      if (imageLinks.value.length === 0) {
        toast.info('未找到图片链接', '该文件中没有图片链接');
      }

      return true;
    } catch (err) {
      log.error('选择文件失败', err);
      toast.error('文件打开失败', String(err));
      return false;
    }
  }

  /**
   * 选择文件夹，递归扫描所有 MD 文件
   */
  async function selectFolder(): Promise<boolean> {
    try {
      const selected = await dialogOpen({
        directory: true,
        recursive: true,
      });

      if (!selected) return false;
      const dir = typeof selected === 'string' ? selected : (selected as string[])[0];
      if (!dir) return false;

      mode.value = 'folder';
      folderPath.value = dir;
      filePath.value = null;
      fileContent.value = null;

      // 递归扫描 MD 文件
      const files = await scanMdFiles(dir);
      mdFiles.value = files;

      if (files.length === 0) {
        toast.info('未找到 MD 文件', '该文件夹中没有 Markdown 文件');
        imageLinks.value = [];
        return false;
      }

      // 逐文件解析图片链接
      const allLinks: MdImageLinkWithFile[] = [];
      for (const file of files) {
        try {
          const content = await readTextFile(file);
          const links = extractImageLinks(content);
          for (const link of links) {
            allLinks.push({
              ...link,
              sourceFile: file,
              sourceFileName: getFileName(file),
            });
          }
        } catch (err) {
          log.warn(`读取文件失败: ${file}`, err);
        }
      }

      imageLinks.value = allLinks;

      if (allLinks.length === 0) {
        toast.info('未找到图片链接', `扫描了 ${files.length} 个文件，均无图片链接`);
      } else {
        toast.info('扫描完成', `${files.length} 个文件中找到 ${allLinks.length} 个图片链接`);
      }

      return true;
    } catch (err) {
      log.error('选择文件夹失败', err);
      toast.error('文件夹打开失败', String(err));
      return false;
    }
  }

  /**
   * 解析并检测所有图片链接
   */
  async function analyzeFile(): Promise<void> {
    if (imageLinks.value.length === 0) return;
    if (isAnalyzing.value) return;

    isAnalyzing.value = true;

    try {
      // 去重 URL（多个文件可能引用同一张图），排除用户标记的链接
      const uniqueUrls = [...new Set(imageLinks.value.map((l) => l.url))]
        .filter((url) => !excludedUrls.value.has(url));
      const items: BatchCheckRequestItem[] = uniqueUrls.map((url) => ({ url }));

      // 批量检测
      const result = await checkUrls(items);
      if (!result) return;

      // 建立 URL → 检测结果映射
      const resultMap = new Map<string, CheckLinkResult>();
      for (const r of result.results) {
        resultMap.set(r.link, r as CheckLinkResult);
      }

      // 关联检测结果（不可变更新）
      let updatedLinks = imageLinks.value.map((link) => {
        const r = resultMap.get(link.url);
        return r ? { ...link, checkResult: r } : link;
      });

      // 为失效链接查找备用链接（不可变更新）
      const config = await loadConfig();
      await buildUrlIndex(config);

      updatedLinks = await Promise.all(
        updatedLinks.map(async (link) => {
          if (link.checkResult && !link.checkResult.is_valid) {
            const backupLinks = await findBackupLinks(link.url, config);
            return { ...link, backupLinks };
          }
          return link;
        }),
      );

      imageLinks.value = updatedLinks;

      const s = stats.value;
      toast.success(
        '分析完成',
        `${s.total} 张图片: ${s.valid} 正常, ${s.broken} 失效 (${s.rescuable} 可替换)`,
      );
    } catch (err) {
      log.error('分析失败', err);
      toast.error('分析失败', String(err));
    } finally {
      isAnalyzing.value = false;
    }
  }

  /**
   * 建立 URL → HistoryItem 内存索引
   */
  async function buildUrlIndex(config: UserConfig): Promise<void> {
    if (urlIndex) return;

    urlIndex = new Map();
    await historyDB.open();
    const allItems: Array<{ id: string; results: any[]; [key: string]: any }> = [];
    for await (const batch of historyDB.getAllStream(1000)) {
      allItems.push(...batch);
    }

    for (const item of allItems) {
      if (!item.results) continue;
      for (const r of item.results) {
        if (r.status !== 'success' || !r.result?.url) continue;

        const rawUrl = r.result.url;
        const finalUrl = applyLinkPrefix(rawUrl, r.serviceId, config);
        const entry = { historyId: item.id, serviceId: r.serviceId };

        for (const url of [rawUrl, finalUrl]) {
          const list = urlIndex.get(url) || [];
          list.push(entry);
          urlIndex.set(url, list);
        }
      }
    }

    log.info(`URL 索引建立完成: ${urlIndex.size} 条`);
  }

  /**
   * 为失效 URL 查找同一图片的其他图床备用链接
   */
  async function findBackupLinks(brokenUrl: string, config: UserConfig): Promise<MdBackupLink[]> {
    if (!urlIndex) return [];

    let entries = urlIndex.get(brokenUrl);
    if (!entries || entries.length === 0) {
      const stripped = stripKnownPrefixes(brokenUrl, config);
      if (stripped !== brokenUrl) {
        entries = urlIndex.get(stripped);
      }
    }

    if (!entries || entries.length === 0) return [];

    const backups: MdBackupLink[] = [];
    const seenUrls = new Set<string>();
    seenUrls.add(brokenUrl);

    for (const entry of entries) {
      const item = await historyDB.getById(entry.historyId);
      if (!item || !item.results) continue;

      for (const r of item.results) {
        if (r.status !== 'success' || !r.result?.url) continue;

        const rawUrl = r.result.url;
        const finalUrl = applyLinkPrefix(rawUrl, r.serviceId, config);

        if (seenUrls.has(finalUrl)) continue;
        seenUrls.add(finalUrl);

        backups.push({ url: finalUrl, serviceId: r.serviceId });
      }
    }

    if (backups.length > 0) {
      const checkItems: BatchCheckRequestItem[] = backups.map((b) => ({ url: b.url }));
      const result = await checkUrls(checkItems);
      if (result) {
        for (const r of result.results) {
          const backup = backups.find((b) => b.url === r.link);
          if (backup) {
            backup.checkResult = r as CheckLinkResult;
          }
        }
      }
    }

    return backups.sort((a, b) => {
      const aValid = a.checkResult?.is_valid ? 1 : 0;
      const bValid = b.checkResult?.is_valid ? 1 : 0;
      if (aValid !== bValid) return bValid - aValid;
      return (a.checkResult?.response_time || 99999) - (b.checkResult?.response_time || 99999);
    });
  }

  /**
   * 执行链接替换（支持多文件）
   */
  async function executeReplace(): Promise<{
    success: number;
    skipped: number;
    failed: number;
  }> {
    isReplacing.value = true;

    try {
      // 按文件分组收集替换映射
      const fileReplacements = new Map<string, Map<string, string>>();
      let skipped = 0;

      for (const link of imageLinks.value) {
        if (!link.checkResult || link.checkResult.is_valid) {
          skipped++;
          continue;
        }
        if (link.selectedBackup) {
          let replacements = fileReplacements.get(link.sourceFile);
          if (!replacements) {
            replacements = new Map();
            fileReplacements.set(link.sourceFile, replacements);
          }
          replacements.set(link.url, link.selectedBackup);
        } else {
          skipped++;
        }
      }

      if (fileReplacements.size === 0) {
        toast.info('无需替换', '没有选中的替换项');
        return { success: 0, skipped: imageLinks.value.length, failed: 0 };
      }

      let totalSuccess = 0;
      let totalFailed = 0;
      const now = new Date();
      const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 15);

      // 逐文件执行替换
      for (const [file, replacements] of fileReplacements) {
        try {
          const content = await readTextFile(file);

          // 备份
          const bakPath = `${file}.${ts}.bak`;
          await copyFile(file, bakPath);

          // 替换并写入
          const newContent = replaceImageLinks(content, replacements);
          await writeTextFile(file, newContent);

          // 如果是当前单文件模式，更新内存中的内容
          if (mode.value === 'file' && file === filePath.value) {
            fileContent.value = newContent;
          }

          totalSuccess += replacements.size;
          log.info(`替换完成: ${file} (${replacements.size} 条，备份: ${bakPath})`);
        } catch (err) {
          log.error(`替换失败: ${file}`, err);
          totalFailed += replacements.size;
        }
      }

      const filesCount = fileReplacements.size;
      toast.success(
        '替换完成',
        `${filesCount} 个文件中替换 ${totalSuccess} 条链接，跳过 ${skipped} 条`,
      );

      return { success: totalSuccess, skipped, failed: totalFailed };
    } catch (err) {
      log.error('替换失败', err);
      toast.error('替换失败', String(err));
      return { success: 0, skipped: 0, failed: 1 };
    } finally {
      isReplacing.value = false;
    }
  }

  /**
   * 生成简单的 diff 预览（变更行高亮）
   * 文件夹模式下合并所有文件的 diff
   */
  function generateDiff(): Array<{ line: number; type: 'unchanged' | 'removed' | 'added'; text: string; file?: string }> {
    const allDiff: Array<{ line: number; type: 'unchanged' | 'removed' | 'added'; text: string; file?: string }> = [];

    // 按文件分组
    const fileLinks = new Map<string, MdImageLinkWithFile[]>();
    for (const link of imageLinks.value) {
      if (link.selectedBackup && link.checkResult && !link.checkResult.is_valid) {
        const list = fileLinks.get(link.sourceFile) || [];
        list.push(link);
        fileLinks.set(link.sourceFile, list);
      }
    }

    if (fileLinks.size === 0) return [];

    // 单文件模式可以直接用内存内容
    if (mode.value === 'file' && fileContent.value && fileLinks.size === 1) {
      const replacements = new Map<string, string>();
      for (const link of imageLinks.value) {
        if (link.selectedBackup && link.checkResult && !link.checkResult.is_valid) {
          replacements.set(link.url, link.selectedBackup);
        }
      }

      const oldLines = fileContent.value.split('\n');
      const newContent = replaceImageLinks(fileContent.value, replacements);
      const newLines = newContent.split('\n');

      const maxLen = Math.max(oldLines.length, newLines.length);
      for (let i = 0; i < maxLen; i++) {
        const oldLine = oldLines[i] ?? '';
        const newLine = newLines[i] ?? '';

        if (oldLine === newLine) {
          allDiff.push({ line: i + 1, type: 'unchanged', text: oldLine });
        } else {
          allDiff.push({ line: i + 1, type: 'removed', text: oldLine });
          allDiff.push({ line: i + 1, type: 'added', text: newLine });
        }
      }
    }

    return allDiff;
  }

  // ============================================
  // 步骤追踪和筛选
  // ============================================

  type RescueStep = 1 | 2 | 3 | 4;
  type DisplayFilter = 'broken' | 'healthy' | 'all';

  const currentStep: Ref<RescueStep> = ref(1);
  const displayFilter: Ref<DisplayFilter> = ref('broken');

  /** 仅失效的图片链接 */
  const brokenLinks = computed(() =>
    imageLinks.value.filter((l) => l.checkResult && !l.checkResult.is_valid),
  );

  /** 仅正常的图片链接 */
  const healthyLinks = computed(() =>
    imageLinks.value.filter((l) => l.checkResult?.is_valid),
  );

  /** 根据当前筛选返回对应列表 */
  const filteredLinks = computed(() => {
    switch (displayFilter.value) {
      case 'broken': return brokenLinks.value;
      case 'healthy': return healthyLinks.value;
      default: return imageLinks.value;
    }
  });

  /**
   * 自动选择最佳备用链接并返回替换摘要（用于确认弹窗）
   */
  function autoSelectAndGetSummary(): {
    files: Array<{
      path: string;
      fileName: string;
      replacements: Array<{ lineNumber: number; oldUrl: string; newUrl: string; serviceId: string }>;
    }>;
    totalReplacements: number;
    totalFiles: number;
  } {
    const links = [...imageLinks.value];

    // 自动选择最佳备用链接
    for (const link of links) {
      if (!link.checkResult?.is_valid && link.backupLinks && link.backupLinks.length > 0) {
        const best = link.backupLinks.find((b) => b.checkResult?.is_valid);
        if (best) link.selectedBackup = best.url;
      }
    }
    imageLinks.value = links;

    // 构建摘要
    const fileMap = new Map<string, {
      path: string;
      fileName: string;
      replacements: Array<{ lineNumber: number; oldUrl: string; newUrl: string; serviceId: string }>;
    }>();

    for (const link of links) {
      if (!link.selectedBackup) continue;
      const backup = link.backupLinks?.find((b) => b.url === link.selectedBackup);
      if (!backup) continue;

      let entry = fileMap.get(link.sourceFile);
      if (!entry) {
        entry = { path: link.sourceFile, fileName: link.sourceFileName, replacements: [] };
        fileMap.set(link.sourceFile, entry);
      }
      entry.replacements.push({
        lineNumber: link.lineNumber,
        oldUrl: link.url,
        newUrl: link.selectedBackup,
        serviceId: backup.serviceId,
      });
    }

    const files = Array.from(fileMap.values());
    const totalReplacements = files.reduce((sum, f) => sum + f.replacements.length, 0);
    return { files, totalReplacements, totalFiles: files.length };
  }

  /**
   * 重置状态
   */
  /** 切换单个链接的排除状态 */
  function toggleExclude(url: string): void {
    const next = new Set(excludedUrls.value);
    if (next.has(url)) {
      next.delete(url);
    } else {
      next.add(url);
    }
    excludedUrls.value = next;
  }

  /** 排除全部链接 */
  function excludeAll(): void {
    excludedUrls.value = new Set(imageLinks.value.map((l) => l.url));
  }

  /** 取消排除全部链接 */
  function includeAll(): void {
    excludedUrls.value = new Set();
  }

  function reset(): void {
    mode.value = null;
    filePath.value = null;
    folderPath.value = null;
    mdFiles.value = [];
    fileContent.value = null;
    imageLinks.value = [];
    urlIndex = null;
    excludedUrls.value = new Set();
    currentStep.value = 1;
    displayFilter.value = 'broken';
  }

  return {
    // 状态
    mode,
    filePath,
    folderPath,
    mdFiles,
    fileContent,
    imageLinks,
    isAnalyzing,
    isReplacing,
    isChecking,
    progress,
    stats,
    displayPath,
    displayLabel,
    currentStep,
    displayFilter,
    brokenLinks,
    healthyLinks,
    filteredLinks,
    excludedUrls,
    // 方法
    selectMdFile,
    selectFolder,
    analyzeFile,
    executeReplace,
    generateDiff,
    autoSelectAndGetSummary,
    toggleExclude,
    excludeAll,
    includeAll,
    reset,
  };
}
