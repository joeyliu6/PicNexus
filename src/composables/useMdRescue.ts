// MD 文档救援 Composable
// 负责解析 MD 文件、检测失效图片链接、匹配备用链接、执行替换
// 支持单文件和文件夹（递归扫描所有 MD 文件）

import { ref, shallowRef, computed, watch, type Ref } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, copyFile, readDir, mkdir, remove, stat } from '@tauri-apps/plugin-fs';
import { join, dirname, basename } from '@tauri-apps/api/path';
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

/** 流程阶段（scanning 涵盖原 report） */
export type RescuePhase = 'idle' | 'scanning' | 'fixing' | 'done';

/** 单个文件的健康状态 */
export interface FileHealth {
  path: string;
  name: string;
  totalCount: number;
  brokenCount: number;
  timeoutCount: number;
  /** suspicious 或 browser_might_work 的链接数 */
  suspiciousCount: number;
  rescuableCount: number;
  unrescuableCount: number;
  /** broken = 有失效链接, warning = 仅超时/可疑, healthy = 全部正常或未检测 */
  status: 'broken' | 'warning' | 'healthy';
  /** 该文件的完整管道（URL检测+备用链接查找）是否完成 */
  ready: boolean;
  /** fixing 阶段实时更新：该文件是否已完成修复 */
  healed: boolean;
}

/** 修复策略 */
export type RepairStrategy =
  | { type: 'priority'; order: string[] }
  | { type: 'fastest' }
  | { type: 'manual'; selections: Map<string, string> };

/** 修复完成后的收据 */
export interface RepairReceipt {
  filesFixed: number;
  linksFixed: number;
  unrescuableCount: number;
  backupPath: string;
  /** 用于撤销：original → backup 的映射 */
  fileBackupMap: Array<{ original: string; backup: string }>;
}

// ============================================
// 单例共享状态
// ============================================

/** 当前阶段 */
const phase: Ref<RescuePhase> = ref('idle');

/** 选择模式：单文件 or 文件夹 */
const mode: Ref<'file' | 'folder' | null> = ref(null);
const filePath: Ref<string | null> = ref(null);
const folderPath: Ref<string | null> = ref(null);
/** 文件夹模式下扫描到的 MD 文件列表 */
const mdFiles: Ref<string[]> = shallowRef([]);
const fileContent: Ref<string | null> = ref(null);
const imageLinks: Ref<MdImageLinkWithFile[]> = shallowRef([]);
const isAnalyzing = ref(false);
/** 正在读取 MD 文件、收集图片链接（selectFolder/loadFolderPath 读文件时为 true） */
const isCollecting = ref(false);
const isReplacing = ref(false);
/** 用户排除的 URL 集合（不参与检测） */
const excludedUrls: Ref<Set<string>> = ref(new Set());
/** 文件夹模式下是否递归扫描子文件夹 */
const includeSubfolders = ref(true);

/** fixing 阶段进度 */
const fixingProgress: Ref<{ current: number; total: number }> = ref({ current: 0, total: 0 });
/** 修复完成后的收据 */
const repairReceipt: Ref<RepairReceipt | null> = ref(null);
/** fixing 阶段已完成修复的文件路径集合（用于动画） */
const healedFiles: Ref<Set<string>> = ref(new Set());
/** 图床偏好（serviceId 列表，顺序即优先级；空数组 = 不限） */
const hostPreference: Ref<string[]> = ref([]);
/** 扫描子阶段：checking=URL检测中, backups=备用链接查找中, complete=全部完成 */
const scanStage = ref<'checking' | 'backups' | 'complete'>('checking');
/** 已完成完整管道（URL检测+备用链接）的文件路径集合 */
const readyFiles: Ref<Set<string>> = shallowRef(new Set());
/** 映射后的扫描进度（以图片数为单位，而非去重 URL 数） */
const scanProgress = ref<{ checked: number; total: number } | null>(null);

// URL → historyId 内存索引（延迟建立）
let urlIndex: Map<string, { historyId: string; serviceId: string }[]> | null = null;

const MD_EXTENSIONS = ['.md', '.markdown'];

export function useMdRescueManager() {
  const toast = useToast();
  const { loadConfig, saveConfig } = useConfigManager();
  const { checkUrls, isChecking, progress, cancelCheck } = useLinkCheckManager();

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

  /** 按文件汇总的健康状态列表（scanning / fixing 阶段使用） */
  const fileHealthList = computed<FileHealth[]>(() => {
    const readySet = readyFiles.value;
    const map = new Map<string, FileHealth>();

    for (const link of imageLinks.value) {
      if (!map.has(link.sourceFile)) {
        map.set(link.sourceFile, {
          path: link.sourceFile,
          name: link.sourceFileName,
          totalCount: 0,
          brokenCount: 0,
          timeoutCount: 0,
          suspiciousCount: 0,
          rescuableCount: 0,
          unrescuableCount: 0,
          status: 'healthy',
          ready: readySet.has(link.sourceFile),
          healed: healedFiles.value.has(link.sourceFile),
        });
      }
      const entry = map.get(link.sourceFile)!;
      entry.totalCount++;

      const cr = link.checkResult;
      if (cr && !cr.is_valid) {
        if (cr.error_type === 'timeout') {
          entry.timeoutCount++;
        } else if (cr.error_type === 'suspicious' || cr.browser_might_work) {
          entry.suspiciousCount++;
        } else {
          entry.brokenCount++;
        }
        const hasValidBackup = link.backupLinks?.some((b) => b.checkResult?.is_valid) ?? false;
        if (hasValidBackup) {
          entry.rescuableCount++;
        } else {
          entry.unrescuableCount++;
        }
      }
    }

    for (const entry of map.values()) {
      if (entry.brokenCount > 0) entry.status = 'broken';
      else if (entry.timeoutCount > 0 || entry.suspiciousCount > 0) entry.status = 'warning';
      else entry.status = 'healthy';
    }

    const statusOrder: Record<string, number> = { broken: 0, warning: 1, healthy: 2 };
    return Array.from(map.values()).sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
  });

  /** 无法自动修复的图片链接（无有效备用链接） */
  const unrescuableLinks = computed(() =>
    imageLinks.value.filter(
      (l) =>
        l.checkResult
        && !l.checkResult.is_valid
        && (!l.backupLinks || !l.backupLinks.some((b) => b.checkResult?.is_valid)),
    ),
  );

  /** 扫描结果中可用的备用图床列表（供配置偏好 Sheet 使用） */
  const availableBackupServices = computed<string[]>(() => {
    const services = new Set<string>();
    for (const link of imageLinks.value) {
      for (const b of link.backupLinks ?? []) {
        if (b.checkResult?.is_valid) services.add(b.serviceId);
      }
    }
    return Array.from(services);
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
        if (entry.isDirectory && includeSubfolders.value) {
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

      const links = extractImageLinks(content);
      imageLinks.value = links.map((l) => ({
        ...l,
        sourceFile: path,
        sourceFileName: getFileName(path),
      }));

      if (links.length === 0) {
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

      isCollecting.value = true;
      try {
        const files = await scanMdFiles(dir);
        mdFiles.value = files;

        if (files.length === 0) {
          toast.info('未找到 MD 文件', '该文件夹中没有 Markdown 文件');
          imageLinks.value = [];
          return false;
        }

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
          toast.info('未找到图片链接', `${files.length} 个文件中均无图片链接`);
        }

        return true;
      } finally {
        isCollecting.value = false;
      }
    } catch (err) {
      log.error('选择文件夹失败', err);
      toast.error('文件夹打开失败', String(err));
      return false;
    }
  }

  /**
   * 通过路径直接加载单个 MD 文件（拖放用，跳过 dialog）
   */
  async function loadFilePath(path: string): Promise<boolean> {
    try {
      const lower = path.toLowerCase();
      if (!MD_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        toast.info('不支持的文件类型', '请拖放 Markdown 文件（.md / .markdown）');
        return false;
      }

      mode.value = 'file';
      filePath.value = path;
      folderPath.value = null;
      mdFiles.value = [];
      const content = await readTextFile(path);
      fileContent.value = content;

      const links = extractImageLinks(content);
      imageLinks.value = links.map((l) => ({
        ...l,
        sourceFile: path,
        sourceFileName: getFileName(path),
      }));

      return true;
    } catch (err) {
      log.error('加载文件失败', err);
      toast.error('文件加载失败', String(err));
      return false;
    }
  }

  /**
   * 通过路径直接加载文件夹（拖放用，跳过 dialog）
   */
  async function loadFolderPath(dir: string): Promise<boolean> {
    try {
      mode.value = 'folder';
      folderPath.value = dir;
      filePath.value = null;
      fileContent.value = null;

      isCollecting.value = true;
      try {
        const files = await scanMdFiles(dir);
        mdFiles.value = files;

        if (files.length === 0) {
          toast.info('未找到 MD 文件', '该文件夹中没有 Markdown 文件');
          imageLinks.value = [];
          return false;
        }

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
        return true;
      } finally {
        isCollecting.value = false;
      }
    } catch (err) {
      log.error('加载文件夹失败', err);
      toast.error('文件夹加载失败', String(err));
      return false;
    }
  }

  /**
   * 处理拖放的文件路径列表，自动判断文件/文件夹
   */
  async function handleDropPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    if (phase.value !== 'idle') return;

    const first = paths[0];
    try {
      const info = await stat(first);
      let ok = false;

      if (info.isDirectory) {
        ok = await loadFolderPath(first);
      } else if (info.isFile) {
        if (paths.length === 1) {
          ok = await loadFilePath(first);
        } else {
          // 多个文件：收集所有 MD 文件
          const mdPaths = paths.filter((p) => {
            const lower = p.toLowerCase();
            return MD_EXTENSIONS.some((ext) => lower.endsWith(ext));
          });
          if (mdPaths.length === 0) {
            toast.info('未找到 MD 文件', '拖放的文件中没有 Markdown 文件');
            return;
          }
          // 用第一个文件的方式处理
          mode.value = 'file';
          filePath.value = mdPaths[0];
          folderPath.value = null;
          mdFiles.value = mdPaths;

          const allLinks: MdImageLinkWithFile[] = [];
          for (const file of mdPaths) {
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
          ok = allLinks.length > 0;
        }
      }

      if (ok && imageLinks.value.length > 0) await analyzeFile();
    } catch (err) {
      log.error('处理拖放失败', err);
      toast.error('拖放处理失败', String(err));
    }
  }

  /**
   * 解析并检测所有图片链接
   *
   * 新算法：边检测边处理，文件一完成就出结果
   *
   * 1. 批量检测所有图片 URL（Rust 多线程）
   * 2. 在检测进度回调中，追踪每个文件的 URL 完成度
   * 3. 某个文件的所有 URL 都检测完了 →
   *    a. 全部正常 → 立刻标记 ready（出现在正常摘要区）
   *    b. 有坏的 → 立刻从 DB 查备用链接 → 标记 ready（卡片出现，备用链接待验证）
   * 4. 主检测完成后 → 统一批量验证所有备用链接的可用性
   * 5. 验证完毕 → 更新卡片上的备用徽章状态 → 扫描完成
   */
  async function analyzeFile(): Promise<void> {
    if (imageLinks.value.length === 0) return;
    if (isAnalyzing.value) return;

    phase.value = 'scanning';
    scanStage.value = 'checking';
    isAnalyzing.value = true;
    readyFiles.value = new Set();
    scanProgress.value = null;

    // 取消安全标志：cancelCheck 后阻止所有后续异步操作
    let isCancelled = false;

    try {
      // --- 准备：构建文件-URL 映射 ---
      const links = imageLinks.value;
      const uniqueUrls = [...new Set(links.map((l) => l.url))]
        .filter((url) => !excludedUrls.value.has(url));
      const items: BatchCheckRequestItem[] = uniqueUrls.map((url) => ({ url }));

      // url → Set<filePath> 反向映射
      const urlFileMap = new Map<string, Set<string>>();
      // file → Set<url>
      const fileUrlSets = new Map<string, Set<string>>();
      for (const link of links) {
        if (excludedUrls.value.has(link.url)) continue;
        let fset = fileUrlSets.get(link.sourceFile);
        if (!fset) { fset = new Set(); fileUrlSets.set(link.sourceFile, fset); }
        fset.add(link.url);
        let uset = urlFileMap.get(link.url);
        if (!uset) { uset = new Set(); urlFileMap.set(link.url, uset); }
        uset.add(link.sourceFile);
      }

      // url → 该 URL 对应的图片链接数量（含重复引用），用于进度映射
      const urlLinkCount = new Map<string, number>();
      for (const link of links) {
        if (excludedUrls.value.has(link.url)) continue;
        urlLinkCount.set(link.url, (urlLinkCount.get(link.url) ?? 0) + 1);
      }
      const totalImageCount = [...urlLinkCount.values()].reduce((a, b) => a + b, 0);

      // buildUrlIndex 并行启动（纯 DB 操作，和 checkUrls 并行）
      const config = await loadConfig();
      const urlIndexPromise = buildUrlIndex(config);

      // --- 逐文件完成跟踪 ---
      const checkedUrls = new Set<string>();       // 已有 checkResult 的 URL
      const completedFiles = new Set<string>();     // 已处理完的文件（避免重复处理）
      const allBackupMap = new Map<string, MdBackupLink[]>(); // url → 备用链接（跨文件复用）

      // 用串行队列避免并发写 imageLinks 导致的竞态
      let backupChain = Promise.resolve();
      const backupPromises: Promise<void>[] = [];

      function markReady(file: string) {
        const nr = new Set(readyFiles.value);
        nr.add(file);
        readyFiles.value = nr;
      }

      /**
       * 单个文件完成后的处理：查备用链接 + 标记 ready
       * 通过 backupChain 串行化，避免并发写 imageLinks
       */
      async function onFileComplete(file: string): Promise<void> {
        if (isCancelled) return;

        const hasBroken = imageLinks.value.some(
          (l) => l.sourceFile === file && l.checkResult && !l.checkResult.is_valid,
        );

        if (!hasBroken) {
          markReady(file);
          return;
        }

        // 有坏链接 → 等 urlIndex 就绪后查备用链接
        await urlIndexPromise;

        const brokenUrls = [...new Set(
          imageLinks.value
            .filter((l) => l.sourceFile === file && l.checkResult && !l.checkResult.is_valid)
            .map((l) => l.url),
        )];

        for (const url of brokenUrls) {
          if (!allBackupMap.has(url)) {
            allBackupMap.set(url, await findBackupLinksRaw(url, config));
          }
        }

        // 将备用链接（尚未验证）写入 imageLinks
        imageLinks.value = imageLinks.value.map((link) => {
          if (link.sourceFile === file && link.checkResult && !link.checkResult.is_valid) {
            const backups = allBackupMap.get(link.url);
            return backups?.length ? { ...link, backupLinks: backups } : link;
          }
          return link;
        });

        // 标记 ready → 卡片出现（备用链接暂显示为"待验证"）
        markReady(file);
      }

      /**
       * 检查 batch 中的 URL 是否使某些文件全部完成，如果是就触发处理
       */
      function checkFileCompletion(batchUrls: string[]) {
        for (const url of batchUrls) {
          checkedUrls.add(url);
        }

        // 检查哪些文件的所有 URL 都已检测完
        const affectedFiles = new Set<string>();
        for (const url of batchUrls) {
          const files = urlFileMap.get(url);
          if (files) for (const f of files) affectedFiles.add(f);
        }

        for (const file of affectedFiles) {
          if (completedFiles.has(file)) continue;
          const fileUrls = fileUrlSets.get(file);
          if (!fileUrls) continue;

          // 检查该文件的所有 URL 是否都已检测
          let allDone = true;
          for (const u of fileUrls) {
            if (!checkedUrls.has(u)) { allDone = false; break; }
          }
          if (!allDone) continue;

          completedFiles.add(file);

          // 串行队列：防止并发写 imageLinks
          const p = backupChain.then(() => onFileComplete(file));
          backupChain = p.catch(() => { /* 单文件失败不影响其他 */ });
          backupPromises.push(p);
        }
      }

      // --- Phase 1: 批量检测 + 边检测边处理文件 ---
      let pending: Array<{ url: string; result: CheckLinkResult }> = [];
      let rafId = 0;

      function flushPending() {
        if (pending.length === 0) return;
        const batch = pending;
        pending = [];
        rafId = 0;

        // 写入 checkResult
        const updated = imageLinks.value.map((link) => {
          const match = batch.find((b) => b.url === link.url);
          return match && !link.checkResult ? { ...link, checkResult: match.result } : link;
        });
        imageLinks.value = updated;

        // 检查文件完成度
        checkFileCompletion(batch.map((b) => b.url));
      }

      let mappedChecked = 0;
      const result = await checkUrls(items, (prog) => {
        if (prog.current_result) {
          mappedChecked += urlLinkCount.get(prog.current_url) ?? 1;
          scanProgress.value = { checked: mappedChecked, total: totalImageCount };
          pending.push({ url: prog.current_url, result: prog.current_result });
          if (!rafId) rafId = requestAnimationFrame(flushPending);
        }
      });

      // 确保最后一批也刷入
      if (rafId) cancelAnimationFrame(rafId);
      flushPending();

      if (!result) {
        isCancelled = true;
        phase.value = 'idle';
        return;
      }

      // 补漏：rAF 可能遗漏部分结果
      const resultMap = new Map<string, CheckLinkResult>();
      for (const r of result.results) resultMap.set(r.link, r as CheckLinkResult);
      imageLinks.value = imageLinks.value.map((link) => {
        if (!link.checkResult) {
          const r = resultMap.get(link.url);
          return r ? { ...link, checkResult: r } : link;
        }
        return link;
      });

      // 处理 flushPending 中可能遗漏的文件（rAF 时序问题）
      for (const [file] of fileUrlSets) {
        if (!completedFiles.has(file)) {
          completedFiles.add(file);
          const p = backupChain.then(() => onFileComplete(file));
          backupChain = p.catch(() => {});
          backupPromises.push(p);
        }
      }

      // 等待所有备用链接查找完成
      await Promise.all(backupPromises);

      // --- Phase 2: 统一批量验证备用链接可用性 ---
      const allBackupUrls = new Set<string>();
      for (const backups of allBackupMap.values()) {
        for (const b of backups) allBackupUrls.add(b.url);
      }

      if (allBackupUrls.size > 0 && !isCancelled) {
        scanStage.value = 'backups';

        const backupResult = await checkUrls([...allBackupUrls].map((url) => ({ url })));
        if (backupResult) {
          const backupResultMap = new Map(backupResult.results.map((r) => [r.link, r]));
          for (const backups of allBackupMap.values()) {
            for (const b of backups) {
              const cr = backupResultMap.get(b.url);
              if (cr) b.checkResult = cr as CheckLinkResult;
            }
            // 排序：有效优先，响应时间短优先
            backups.sort((a, b) => {
              const aV = a.checkResult?.is_valid ? 1 : 0;
              const bV = b.checkResult?.is_valid ? 1 : 0;
              if (aV !== bV) return bV - aV;
              return (a.checkResult?.response_time || 99999) - (b.checkResult?.response_time || 99999);
            });
          }

          // 将验证结果更新到 imageLinks
          imageLinks.value = imageLinks.value.map((link) => {
            if (link.backupLinks) {
              const verified = allBackupMap.get(link.url);
              return verified ? { ...link, backupLinks: verified } : link;
            }
            return link;
          });
        }
      }

      if (!isCancelled) {
        scanStage.value = 'complete';
      }
    } catch (err) {
      log.error('分析失败', err);
      toast.error('分析失败', String(err));
      phase.value = 'idle';
    } finally {
      isAnalyzing.value = false;
    }
  }

  /**
   * 按图床偏好为每张失效图片选择最佳备用链接
   */
  function applyHostPreference(links: MdImageLinkWithFile[], preference: string[]): void {
    for (const link of links) {
      if (!link.backupLinks?.length || link.checkResult?.is_valid) continue;

      const backups = preference.length === 0
        ? link.backupLinks
        : [...link.backupLinks].sort((a, b) => {
            const ai = preference.indexOf(a.serviceId);
            const bi = preference.indexOf(b.serviceId);
            return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
          });

      const best = backups.find((b) => b.checkResult?.is_valid);
      link.selectedBackup = best?.url;
    }
  }

  /**
   * 从配置加载图床偏好
   */
  async function loadHostPreference(): Promise<void> {
    const config = await loadConfig();
    hostPreference.value = config.mdRescueHostPreference ?? [];
  }

  /**
   * 将当前图床偏好保存到配置
   */
  async function saveHostPreference(): Promise<void> {
    const config = await loadConfig();
    await saveConfig({ ...config, mdRescueHostPreference: hostPreference.value }, true);
  }

  /**
   * 应用偏好并开始修复（report → fixing → done）
   */
  async function startFix(preference: string[]): Promise<void> {
    const links = [...imageLinks.value];
    applyHostPreference(links, preference);
    imageLinks.value = links;
    await executeReplace();
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
   * 为失效 URL 查找备用链接（仅 DB 查询，不做 HTTP 检测）
   */
  async function findBackupLinksRaw(brokenUrl: string, config: UserConfig): Promise<MdBackupLink[]> {
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

    return backups;
  }

  /**
   * 执行链接替换（支持多文件），推进 fixing → done 阶段
   */
  async function executeReplace(): Promise<{
    success: number;
    skipped: number;
    failed: number;
  }> {
    isReplacing.value = true;
    phase.value = 'fixing';
    healedFiles.value = new Set();

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
      isReplacing.value = false;
      phase.value = 'done';
      repairReceipt.value = {
        filesFixed: 0,
        linksFixed: 0,
        unrescuableCount: unrescuableLinks.value.length,
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

      for (const [file, replacements] of fileReplacements) {
        try {
          const content = await readTextFile(file);

          let bakPath: string;
          if (mode.value === 'folder' && folderPath.value) {
            const relativePath = file.replace(/\\/g, '/').replace(folderPath.value.replace(/\\/g, '/'), '').replace(/^\//, '');
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
        filesFixed: fileReplacements.size - totalFailed,
        linksFixed: totalSuccess,
        unrescuableCount: unrescuableLinks.value.length,
        backupPath: backupDir,
        fileBackupMap,
      };

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
   */
  async function undoReplace(): Promise<void> {
    if (!repairReceipt.value?.fileBackupMap.length) return;

    try {
      for (const { original, backup } of repairReceipt.value.fileBackupMap) {
        await copyFile(backup, original);
        log.info(`已恢复: ${original}`);
      }
      toast.success('撤销完成', '已恢复所有文件至修复前状态');
    } catch (err) {
      log.error('撤销失败', err);
      toast.error('撤销失败', String(err));
    }

    reset();
  }

  /**
   * 清理旧备份目录，保留最近 N 次
   */
  async function cleanupOldBackups(rootDir: string, keepCount: number): Promise<void> {
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

  /**
   * 生成简单的 diff 预览（变更行高亮）
   */
  function generateDiff(): Array<{ line: number; type: 'unchanged' | 'removed' | 'added'; text: string; file?: string }> {
    const allDiff: Array<{ line: number; type: 'unchanged' | 'removed' | 'added'; text: string; file?: string }> = [];

    const fileLinks = new Map<string, MdImageLinkWithFile[]>();
    for (const link of imageLinks.value) {
      if (link.selectedBackup && link.checkResult && !link.checkResult.is_valid) {
        const list = fileLinks.get(link.sourceFile) || [];
        list.push(link);
        fileLinks.set(link.sourceFile, list);
      }
    }

    if (fileLinks.size === 0) return [];

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
  // 筛选管道
  // ============================================

  type StatusFilter = 'invalid' | 'suspicious' | 'timeout' | 'unchecked' | 'valid' | 'all' | null;

  const statusFilter: Ref<StatusFilter> = ref('all');
  const selectedSourceFile = ref<string | null>(null);
  const searchInput = ref('');
  const searchQuery = ref('');
  const currentPage = ref(1);
  const PAGE_SIZE = 100;

  watch(statusFilter, () => { currentPage.value = 1; });
  watch(selectedSourceFile, () => { currentPage.value = 1; });
  watchDebounced(searchInput, (val) => { searchQuery.value = val; currentPage.value = 1; }, { debounce: 200 });

  const sourceFileList = computed(() => {
    const map = new Map<string, number>();
    for (const link of imageLinks.value) {
      map.set(link.sourceFileName, (map.get(link.sourceFileName) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  });

  const scopedLinks = computed(() => {
    let links = imageLinks.value;
    if (selectedSourceFile.value) {
      links = links.filter((l) => l.sourceFileName === selectedSourceFile.value);
    }
    const q = searchQuery.value.trim().toLowerCase();
    if (q) {
      links = links.filter((l) =>
        l.url.toLowerCase().includes(q)
        || l.sourceFileName.toLowerCase().includes(q)
        || (l.altText && l.altText.toLowerCase().includes(q)),
      );
    }
    return links;
  });

  const stats = computed(() => {
    const links = scopedLinks.value;
    let valid = 0, invalid = 0, timeout = 0, suspicious = 0, unchecked = 0;
    let rescuable = 0;
    for (const l of links) {
      const cr = l.checkResult;
      if (!cr) { unchecked++; continue; }
      if (cr.is_valid) { valid++; continue; }
      if (cr.error_type === 'timeout') { timeout++; }
      else if (cr.error_type === 'suspicious') { suspicious++; }
      else { invalid++; }
      if (l.backupLinks && l.backupLinks.length > 0) rescuable++;
    }
    const broken = invalid + timeout + suspicious;
    const checked = links.length - unchecked;
    const unresolvable = broken - rescuable;
    return {
      total: links.length, checked, valid, broken, rescuable, unresolvable,
      invalid, timeout, suspicious, unchecked,
    };
  });

  const brokenLinks = computed(() =>
    imageLinks.value.filter((l) => l.checkResult && !l.checkResult.is_valid),
  );

  const healthyLinks = computed(() =>
    imageLinks.value.filter((l) => l.checkResult?.is_valid),
  );

  const filteredLinks = computed(() => {
    let links = scopedLinks.value.filter((l) => {
      const r = l.checkResult;
      switch (statusFilter.value) {
        case null: return true;
        case 'invalid': return r && !r.is_valid && r.error_type !== 'timeout' && r.error_type !== 'suspicious';
        case 'suspicious': return r?.error_type === 'suspicious';
        case 'timeout': return r?.error_type === 'timeout';
        case 'unchecked': return !r;
        case 'valid': return r?.is_valid;
        case 'all': return true;
        default: return true;
      }
    });
    const severity: Record<string, number> = { http_4xx: 0, http_5xx: 1, network: 2, timeout: 3, suspicious: 4, success: 5 };
    links = [...links].sort((a, b) =>
      (severity[a.checkResult?.error_type ?? 'success'] ?? 5) - (severity[b.checkResult?.error_type ?? 'success'] ?? 5),
    );
    return links;
  });

  const totalPages = computed(() => Math.max(1, Math.ceil(filteredLinks.value.length / PAGE_SIZE)));
  const visibleLinks = computed(() => {
    const start = (currentPage.value - 1) * PAGE_SIZE;
    return filteredLinks.value.slice(start, start + PAGE_SIZE);
  });

  /**
   * 自动选择最佳备用链接并返回替换摘要
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

    for (const link of links) {
      if (!link.checkResult?.is_valid && link.backupLinks && link.backupLinks.length > 0) {
        const best = link.backupLinks.find((b) => b.checkResult?.is_valid);
        if (best) link.selectedBackup = best.url;
      }
    }
    imageLinks.value = links;

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

  function toggleExclude(url: string): void {
    const next = new Set(excludedUrls.value);
    if (next.has(url)) {
      next.delete(url);
    } else {
      next.add(url);
    }
    excludedUrls.value = next;
  }

  function excludeAll(): void {
    excludedUrls.value = new Set(imageLinks.value.map((l) => l.url));
  }

  function includeAll(): void {
    excludedUrls.value = new Set();
  }

  /** 底栏统计数据 */
  const bottomStats = computed(() => {
    const links = imageLinks.value;
    const totalFiles = fileHealthList.value.length;
    const totalImages = links.length;
    let normalCount = 0;
    let problemCount = 0;
    let repairedCount = 0;
    let manualCount = 0;
    for (const link of links) {
      if (!link.checkResult) continue;
      if (link.checkResult.is_valid) { normalCount++; continue; }
      if (link.selectedBackup && healedFiles.value.has(link.sourceFile)) {
        repairedCount++;
      } else if (!link.backupLinks?.some((b) => b.checkResult?.is_valid)) {
        manualCount++;
      }
      problemCount++;
    }
    // 文件级健康计数：正常 vs 异常（broken + warning）
    let normalFileCount = 0;
    let problemFileCount = 0;
    for (const f of fileHealthList.value) {
      if (f.status === 'healthy') normalFileCount++;
      else problemFileCount++;
    }
    const checkedCount = normalCount + problemCount;
    return {
      totalFiles, totalImages, normalCount, problemCount, checkedCount, repairedCount, manualCount,
      normalFileCount, problemFileCount,
    };
  });

  /**
   * 根据修复策略为每张失效图片选择备用链接
   */
  function applyRepairStrategy(strategy: RepairStrategy): void {
    const links = [...imageLinks.value];

    for (const link of links) {
      if (!link.checkResult || link.checkResult.is_valid) continue;
      if (!link.backupLinks?.length) continue;

      const validBackups = link.backupLinks.filter((b) => b.checkResult?.is_valid);
      if (validBackups.length === 0) continue;

      switch (strategy.type) {
        case 'priority': {
          const order = strategy.order;
          const sorted = [...validBackups].sort((a, b) => {
            const ai = order.indexOf(a.serviceId);
            const bi = order.indexOf(b.serviceId);
            return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
          });
          link.selectedBackup = sorted[0]?.url;
          break;
        }
        case 'fastest': {
          const sorted = [...validBackups].sort(
            (a, b) => (a.checkResult?.response_time ?? 99999) - (b.checkResult?.response_time ?? 99999),
          );
          link.selectedBackup = sorted[0]?.url;
          break;
        }
        case 'manual': {
          const selected = strategy.selections.get(link.url);
          if (selected) link.selectedBackup = selected;
          break;
        }
      }
    }

    imageLinks.value = links;
  }

  function reset(): void {
    phase.value = 'idle';
    mode.value = null;
    filePath.value = null;
    folderPath.value = null;
    mdFiles.value = [];
    fileContent.value = null;
    imageLinks.value = [];
    scanStage.value = 'checking';
    scanProgress.value = null;
    readyFiles.value = new Set();
    urlIndex = null;
    excludedUrls.value = new Set();
    includeSubfolders.value = true;
    statusFilter.value = 'all';
    selectedSourceFile.value = null;
    searchInput.value = '';
    searchQuery.value = '';
    currentPage.value = 1;
    fixingProgress.value = { current: 0, total: 0 };
    repairReceipt.value = null;
    healedFiles.value = new Set();
    // hostPreference 保留（用户偏好跨任务持久）
  }

  return {
    // 阶段状态
    phase,
    // 任务状态
    mode,
    filePath,
    folderPath,
    mdFiles,
    fileContent,
    imageLinks,
    isAnalyzing,
    isCollecting,
    isReplacing,
    isChecking,
    progress,
    stats,
    displayPath,
    displayLabel,
    // 新增：健康状态
    fileHealthList,
    unrescuableLinks,
    availableBackupServices,
    fixingProgress,
    repairReceipt,
    healedFiles,
    hostPreference,
    bottomStats,
    // 筛选管道
    statusFilter,
    selectedSourceFile,
    searchInput,
    searchQuery,
    sourceFileList,
    scopedLinks,
    brokenLinks,
    healthyLinks,
    filteredLinks,
    visibleLinks,
    currentPage,
    totalPages,
    PAGE_SIZE,
    excludedUrls,
    includeSubfolders,
    // 方法
    selectMdFile,
    selectFolder,
    loadFilePath,
    loadFolderPath,
    handleDropPaths,
    analyzeFile,
    startFix,
    applyHostPreference,
    applyRepairStrategy,
    loadHostPreference,
    saveHostPreference,
    executeReplace,
    undoReplace,
    generateDiff,
    autoSelectAndGetSummary,
    toggleExclude,
    excludeAll,
    includeAll,
    cancelCheck,
    reset,
    // 渐进式扫描状态
    scanStage,
    scanProgress,
    readyFiles,
  };
}
