// MD 文档救援 Composable（主编排文件）
// 负责解析 MD 文件、检测失效图片链接、匹配备用链接、执行替换
// 支持单文件和文件夹（递归扫描所有 MD 文件）

import { computed } from 'vue';
import { stat } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import type { UserConfig, HistoryItem } from '../../config/types';
import { useConfigManager } from '../useConfig';
import { applyLinkPrefix } from '../useCopyLink';
import { historyDB } from '../../services/HistoryDatabase';
import { useLinkCheckManager } from '../useLinkCheck';
import { useToast } from '../useToast';
import { createLogger } from '../../utils/logger';
import { stripKnownPrefixes } from '../../utils/mdParser';
import type {
  MdBackupLink,
  BatchCheckRequestItem,
  CheckLinkResult,
} from '../../types/linkCheck';

// 共享状态
import {
  type MdImageLinkWithFile,
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
  getUrlIndex,
  setUrlIndex,
  setCollectCancelled,
} from './shared';

// 子模块
import {
  isMarkdownFile,
  collectLinksFromFiles,
  selectMdFile,
  selectFolder,
  loadFilePath,
  loadFolderPath,
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
  const { checkUrls, isChecking, progress, cancelCheck } = useLinkCheckManager();

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
   * 构建扫描所需的各种映射索引
   */
  function buildScanMappings(links: MdImageLinkWithFile[], excluded: Set<string>) {
    const uniqueUrls = [...new Set(links.map((l) => l.url))]
      .filter((url) => !excluded.has(url));
    const items: BatchCheckRequestItem[] = uniqueUrls.map((url) => ({ url }));

    // url → Set<filePath> 反向映射
    const urlFileMap = new Map<string, Set<string>>();
    // file → Set<url>
    const fileUrlSets = new Map<string, Set<string>>();
    for (const link of links) {
      if (excluded.has(link.url)) continue;
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
      if (excluded.has(link.url)) continue;
      urlLinkCount.set(link.url, (urlLinkCount.get(link.url) ?? 0) + 1);
    }
    const totalImageCount = [...urlLinkCount.values()].reduce((a, b) => a + b, 0);

    // file → 在 imageLinks 数组中的索引列表（onFileComplete 用，避免全量遍历）
    const fileToIndices = new Map<string, number[]>();
    for (let i = 0; i < links.length; i++) {
      const file = links[i].sourceFile;
      const arr = fileToIndices.get(file);
      if (arr) arr.push(i);
      else fileToIndices.set(file, [i]);
    }

    return { items, urlFileMap, fileUrlSets, urlLinkCount, totalImageCount, fileToIndices };
  }

  /**
   * 建立 URL → HistoryItem 内存索引
   */
  async function buildUrlIndex(config: UserConfig): Promise<void> {
    if (getUrlIndex()) return;

    const idx = new Map<string, { historyId: string; serviceId: string }[]>();
    await historyDB.open();
    const allItems: HistoryItem[] = [];
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
          const list = idx.get(url) || [];
          list.push(entry);
          idx.set(url, list);
        }
      }
    }

    setUrlIndex(idx);
    log.info(`URL 索引建立完成: ${idx.size} 条`);
  }

  /**
   * 为失效 URL 查找备用链接（仅 DB 查询，不做 HTTP 检测）
   */
  async function findBackupLinksRaw(brokenUrl: string, config: UserConfig): Promise<MdBackupLink[]> {
    const urlIndex = getUrlIndex();
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

    // 重置取消标志
    isCancelled.value = false;

    try {
      // --- 准备：构建文件-URL 映射 ---
      const links = imageLinks.value;
      const { items, urlFileMap, fileUrlSets, urlLinkCount, totalImageCount, fileToIndices } =
        buildScanMappings(links, excludedUrls.value);

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
        if (isCancelled.value) return;

        // 通过预建索引只访问该文件的链接，避免遍历全部 imageLinks
        const indices = fileToIndices.get(file);
        if (!indices) { markReady(file); return; }

        const currentLinks = imageLinks.value;
        const hasBroken = indices.some(
          (i) => currentLinks[i].checkResult && !currentLinks[i].checkResult!.is_valid,
        );

        if (!hasBroken) {
          markReady(file);
          return;
        }

        // 有坏链接 → 等 urlIndex 就绪后查备用链接
        await urlIndexPromise;

        const brokenUrlSet = new Set<string>();
        for (const i of indices) {
          const l = currentLinks[i];
          if (l.checkResult && !l.checkResult.is_valid) brokenUrlSet.add(l.url);
        }

        for (const url of brokenUrlSet) {
          if (!allBackupMap.has(url)) {
            allBackupMap.set(url, await findBackupLinksRaw(url, config));
          }
        }

        // 将备用链接（尚未验证）写入 imageLinks（仅更新该文件的链接）
        const updated = [...imageLinks.value];
        for (const i of indices) {
          const link = updated[i];
          if (link.checkResult && !link.checkResult.is_valid) {
            const backups = allBackupMap.get(link.url);
            if (backups?.length) updated[i] = { ...link, backupLinks: backups };
          }
        }
        imageLinks.value = updated;

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
      // 使用 Map 累积结果 + 500ms 节流，避免高频触发 computed 级联
      const FLUSH_INTERVAL = 500;
      const pendingResults = new Map<string, CheckLinkResult>();
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      function flushPending() {
        if (pendingResults.size === 0) return;
        const batch = new Map(pendingResults);
        pendingResults.clear();
        flushTimer = null;

        // 写入 checkResult（Map.get 是 O(1)，替代原先的 batch.find O(n)）
        const updated = imageLinks.value.map((link) => {
          if (link.checkResult) return link;
          const result = batch.get(link.url);
          return result ? { ...link, checkResult: result } : link;
        });
        imageLinks.value = updated;

        // 检查文件完成度
        checkFileCompletion([...batch.keys()]);
      }

      let mappedChecked = 0;
      setCheckStartTime(Date.now());
      const result = await checkUrls(items, (prog) => {
        if (prog.current_result) {
          mappedChecked += urlLinkCount.get(prog.current_url) ?? 1;
          scanProgress.value = { checked: mappedChecked, total: totalImageCount };
          pendingResults.set(prog.current_url, prog.current_result);
          if (!flushTimer) flushTimer = setTimeout(flushPending, FLUSH_INTERVAL);
        }
      });

      // 确保最后一批也刷入
      if (flushTimer) clearTimeout(flushTimer);
      flushPending();

      if (!result) {
        phase.value = 'idle';
        return;
      }

      // 补漏：rAF 可能遗漏部分结果（取消和正常完成都需要）
      const resultMap = new Map<string, CheckLinkResult>();
      for (const r of result.results) resultMap.set(r.link, r as CheckLinkResult);
      imageLinks.value = imageLinks.value.map((link) => {
        if (!link.checkResult) {
          const r = resultMap.get(link.url);
          return r ? { ...link, checkResult: r } : link;
        }
        return link;
      });

      // 取消时：保留已检测的部分结果，展示给用户
      if (result.cancelled) {
        isCancelled.value = true;

        // 确保已完成检测的文件被标记为 ready（无需查备用链接也先展示）
        for (const [file, urls] of fileUrlSets) {
          if (completedFiles.has(file)) continue;
          let allDone = true;
          for (const u of urls) {
            if (!checkedUrls.has(u)) { allDone = false; break; }
          }
          if (allDone) {
            completedFiles.add(file);
            const p = backupChain.then(() => onFileComplete(file));
            backupChain = p.catch(() => {});
            backupPromises.push(p);
          }
        }
        await Promise.all(backupPromises);

        scanStage.value = 'cancelled';
        log.info(`扫描已取消，已检测 ${result.results.length} 条链接`);
        return;
      }

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

      if (allBackupUrls.size > 0 && !isCancelled.value) {
        scanStage.value = 'backups';

        const backupResult = await checkUrls([...allBackupUrls].map((url) => ({ url })));
        if (backupResult && !backupResult.cancelled) {
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

      if (!isCancelled.value) {
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
          imageLinks.value = await collectLinksFromFiles(mdPaths);
          ok = imageLinks.value.length > 0;
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
    includeSubfolders.value = true;
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
