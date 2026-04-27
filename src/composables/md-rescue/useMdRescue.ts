// MD 文档救援 Composable（主编排文件）
// 负责解析 MD 文件、检测失效图片链接、匹配备用链接、执行替换
// 支持单文件和文件夹（递归扫描所有 MD 文件）

import { computed } from 'vue';
import { stat } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { useConfigManager } from '../useConfig';
import { useLinkCheckManager } from '../useLinkCheck';
import { useToast } from '../useToast';
import { createLogger } from '../../utils/logger';

// 共享状态
import {
  type FileHealth,
  phase,
  mode,
  filePath,
  folderPath,
  mdFiles,
  fileContent,
  imageLinks,
  isAnalyzing,
  isCollecting,
  collectProgress,
  isReplacing,
  excludedUrls,
  includeSubfolders,
  includeCodeBlocks,
  fixingProgress,
  repairReceipt,
  healedFiles,
  hostPreference,
  scanStage,
  readyFiles,
  scanProgress,
  isCancelled,
  skippedDirs,
  getCheckStartTime,
  setCheckStartTime,
  setUrlIndex,
  setCollectCancelled,
} from './shared';
import { runLinkCheck } from './LinkChecker';

// 子模块
import {
  isMarkdownFile,
  collectLinksFromFiles,
  useMdFileLoader,
} from './useMdFileLoader';
import { useMdLinkFilter, generateDiff } from './useMdLinkFilter';
import { executeReplace as executeReplaceImpl, undoReplace as undoReplaceImpl } from './useFileBackup';
import {
  applyHostPreference,
  loadHostPreference,
  saveHostPreference,
  applyRepairStrategy,
  autoSelectAndGetSummary,
  toggleExclude,
  excludeAll,
  includeAll,
  useBottomStats,
} from './useRepairStrategy';

const log = createLogger('MdRescue');

export function useMdRescueManager() {
  const toast = useToast();
  const { loadConfig } = useConfigManager();
  const { checkUrls, isChecking, progress, progressSource, cancelCheck } = useLinkCheckManager();
  // 必须在 setup 栈期间调用 useMdFileLoader，内部会 useToast() → inject()，
  // 返回的 5 个函数通过闭包持有 toast，之后可在 click / 拖放回调里安全调用。
  const { selectMdFile, selectFolder, selectAny, loadFilePath, loadFolderPath } = useMdFileLoader();

  // 筛选管道（内含 watch/watchDebounced，必须在 composable 函数内调用）
  const {
    statusFilter,
    selectedSourceFile,
    searchInput,
    searchQuery,
    currentPage,
    PAGE_SIZE,
    sourceFileList,
    scopedLinks,
    stats,
    brokenLinks,
    healthyLinks,
    filteredLinks,
    totalPages,
    visibleLinks,
  } = useMdLinkFilter();

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

  /** 链接检测剩余时间估算（毫秒），null 表示无法估算 */
  const estimatedTimeRemaining = computed<number | null>(() => {
    const sp = scanProgress.value;
    const checkStartTime = getCheckStartTime();
    if (!sp || sp.checked === 0 || sp.checked >= sp.total || checkStartTime === 0) return null;
    const elapsed = Date.now() - checkStartTime;
    const avgMs = elapsed / sp.checked;
    return Math.round((sp.total - sp.checked) * avgMs);
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

  // 底栏统计（依赖 fileHealthList）
  const bottomStats = useBottomStats(fileHealthList);

  // ============================================
  // 核心编排逻辑
  // ============================================

  /**
   * 解析并检测所有图片链接（委托给 LinkChecker.runLinkCheck）
   *
   * 门面职责：状态切换（phase / isAnalyzing / scanStage / readyFiles /
   * scanProgress / isCancelled）+ 错误处理。流水线本体见 LinkChecker.ts。
   */
  async function analyzeFile(): Promise<void> {
    if (imageLinks.value.length === 0) return;
    if (isAnalyzing.value) return;
    if (isChecking.value && progressSource.value !== 'rescue') {
      toast.warn('检测进行中', '请等待当前链接检测完成后再修复文档');
      return;
    }

    phase.value = 'scanning';
    scanStage.value = 'checking';
    isAnalyzing.value = true;
    readyFiles.value = new Set();
    scanProgress.value = null;
    isCancelled.value = false;

    try {
      const config = await loadConfig();
      await runLinkCheck({ config, checkUrls });
    } catch (err) {
      log.error('分析失败', err);
      toast.error('分析失败', String(err));
      phase.value = 'idle';
    } finally {
      isAnalyzing.value = false;
    }
  }

  /** 取消扫描（同时停止后端 URL 检测 + 短路后续异步操作） */
  function cancelScan(): void {
    isCancelled.value = true;
    scanStage.value = 'cancelling';
    cancelCheck();
  }

  /** 取消修复（当前文件完成后停止） */
  function cancelFix(): void {
    isCancelled.value = true;
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

  /** 拖放处理（handleDropPaths 调用 analyzeFile，留在主文件） */
  async function handleDropPaths(paths: string[]): Promise<void> {
    if (paths.length === 0 || phase.value !== 'idle') return;
    if (isChecking.value && progressSource.value !== 'rescue') {
      toast.warn('检测进行中', '请等待当前链接检测完成后再拖入文档');
      return;
    }

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
          const mdPaths = paths.filter(isMarkdownFile);
          if (mdPaths.length === 0) {
            toast.info('未找到 MD 文件', '拖放的文件中没有 Markdown 文件');
            return;
          }
          mode.value = 'file';
          filePath.value = mdPaths[0];
          folderPath.value = null;
          mdFiles.value = mdPaths;

          // 与 loadFolderImpl 的收集态保持一致：重置取消标志 + 上报进度。
          // 缺这一段时，用户取消一次再次拖放会让 collectLinksFromFiles 内部
          // 的 getCollectCancelled() 仍为 true，每个文件早 return 静默失败。
          setCollectCancelled(false);
          isCollecting.value = true;
          collectProgress.value = { scannedFiles: mdPaths.length, processedFiles: 0, foundLinks: 0 };
          try {
            imageLinks.value = await collectLinksFromFiles(mdPaths, (processed, found) => {
              collectProgress.value = {
                scannedFiles: mdPaths.length,
                processedFiles: processed,
                foundLinks: found,
              };
            });
            ok = imageLinks.value.length > 0;
          } finally {
            isCollecting.value = false;
            collectProgress.value = null;
          }
        }
      }

      if (ok && imageLinks.value.length > 0) await analyzeFile();
    } catch (err) {
      log.error('处理拖放失败', err);
      toast.error('拖放处理失败', String(err));
    }
  }

  /** 取消收集阶段（scanMdFiles + collectLinksFromFiles），回到 idle */
  function cancelCollect(): void {
    setCollectCancelled(true);
    isCollecting.value = false;
    collectProgress.value = null;
    phase.value = 'idle';
    // 通知 Rust 侧取消扫描
    invoke('cancel_md_scan').catch(() => {});
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
    setUrlIndex(null);
    excludedUrls.value = new Set();
    // includeSubfolders / includeCodeBlocks 跨扫描周期保留用户意图，不在 reset 里重置
    statusFilter.value = 'all';
    selectedSourceFile.value = null;
    searchInput.value = '';
    searchQuery.value = '';
    currentPage.value = 1;
    fixingProgress.value = { current: 0, total: 0 };
    repairReceipt.value = null;
    isCancelled.value = false;
    healedFiles.value = new Set();
    isCollecting.value = false;
    isAnalyzing.value = false;
    setCollectCancelled(false);
    collectProgress.value = null;
    skippedDirs.value = [];
    setCheckStartTime(0);
    // hostPreference 保留（用户偏好跨任务持久）
  }

  /** executeReplace 包装：传入 unrescuableCount */
  async function executeReplace() {
    return executeReplaceImpl(unrescuableLinks.value.length);
  }

  /** undoReplace 包装：传入 reset */
  async function undoReplace() {
    return undoReplaceImpl(reset);
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
    collectProgress,
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
    includeCodeBlocks,
    // 方法
    selectMdFile,
    selectFolder,
    selectAny,
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
    cancelScan,
    cancelFix,
    cancelCollect,
    reset,
    // 渐进式扫描状态
    scanStage,
    scanProgress,
    readyFiles,
    // #2 跳过的目录
    skippedDirs,
    // #4 时间估算
    estimatedTimeRemaining,
  };
}
