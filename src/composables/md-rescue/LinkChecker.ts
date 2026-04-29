// src/composables/md-rescue/LinkChecker.ts
// MD 救援 — 链接检测 + 备用链接查找流水线
// 从 useMdRescue.ts 抽取，负责：buildScanMappings / buildUrlIndex
// / findBackupLinksRaw / runLinkCheck（包含 analyzeFile 的核心逻辑）

import type { UserConfig, HistoryItem } from '../../config/types';
import { applyConfiguredUrlWithConfig } from '../useCopyLink';
import { historyDB } from '../../services/HistoryDatabase';
import { createLogger } from '../../utils/logger';
import { stripKnownPrefixes } from '../../utils/mdParser';
import type {
  MdBackupLink,
  BatchCheckRequestItem,
  BatchCheckResult,
  BatchCheckProgress,
  CheckLinkResult,
} from '../../types/linkCheck';

import {
  type MdImageLinkWithFile,
  imageLinks,
  excludedUrls,
  scanStage,
  readyFiles,
  scanProgress,
  isCancelled,
  setCheckStartTime,
  getUrlIndex,
  setUrlIndex,
} from './shared';

const log = createLogger('LinkChecker');

/** 来自 useLinkCheckManager 的 checkUrls 签名 */
export type CheckUrlsFn = (
  items: BatchCheckRequestItem[],
  onProgress?: (prog: BatchCheckProgress) => void,
) => Promise<BatchCheckResult | null>;

/**
 * 构建扫描所需的各种映射索引
 */
export function buildScanMappings(
  links: MdImageLinkWithFile[],
  excluded: Set<string>,
) {
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
 * 建立 URL → HistoryItem 内存索引（单例，只在首次调用时构建）
 */
export async function buildUrlIndex(config: UserConfig): Promise<void> {
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
      const finalUrl = applyConfiguredUrlWithConfig(rawUrl, r.serviceId, config);
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
export async function findBackupLinksRaw(
  brokenUrl: string,
  config: UserConfig,
): Promise<MdBackupLink[]> {
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
      const finalUrl = applyConfiguredUrlWithConfig(rawUrl, r.serviceId, config);

      if (seenUrls.has(finalUrl)) continue;
      seenUrls.add(finalUrl);

      backups.push({ url: finalUrl, serviceId: r.serviceId });
    }
  }

  return backups;
}

/**
 * 运行链接检测流水线（原 analyzeFile 的核心逻辑）
 *
 * 新算法：边检测边处理，文件一完成就出结果
 *
 * 1. 批量检测所有图片 URL（Rust 多线程）
 * 2. 在检测进度回调中，追踪每个文件的 URL 完成度
 * 3. 某个文件的所有 URL 都检测完了 →
 *    a. 全部正常 → 立刻标记 ready
 *    b. 有坏的 → 立刻从 DB 查备用链接 → 标记 ready（备用链接待验证）
 * 4. 主检测完成后 → 统一批量验证所有备用链接的可用性
 *
 * 状态切换（phase / isAnalyzing / 错误 toast）由调用方门面负责。
 */
export async function runLinkCheck(params: {
  config: UserConfig;
  checkUrls: CheckUrlsFn;
}): Promise<void> {
  const { config, checkUrls } = params;

  // --- 准备：构建文件-URL 映射 ---
  const links = imageLinks.value;
  const { items, urlFileMap, fileUrlSets, urlLinkCount, totalImageCount, fileToIndices } =
    buildScanMappings(links, excludedUrls.value);

  // buildUrlIndex 并行启动（纯 DB 操作，和 checkUrls 并行）
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
   */
  async function onFileComplete(
    file: string,
    options: { allowCancelled?: boolean } = {},
  ): Promise<void> {
    if (isCancelled.value && !options.allowCancelled) return;

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

    const updated = [...imageLinks.value];
    for (const i of indices) {
      const link = updated[i];
      if (link.checkResult && !link.checkResult.is_valid) {
        const backups = allBackupMap.get(link.url);
        if (backups?.length) updated[i] = { ...link, backupLinks: backups };
      }
    }
    imageLinks.value = updated;

    markReady(file);
  }

  function enqueueFileComplete(
    file: string,
    options: { allowCancelled?: boolean } = {},
  ): Promise<void> {
    const p = backupChain.then(() => onFileComplete(file, options));
    backupChain = p.catch(() => { /* 单文件失败不影响其他 */ });
    backupPromises.push(p);
    return p;
  }

  /**
   * 检查 batch 中的 URL 是否使某些文件全部完成，如果是就触发处理
   */
  function checkFileCompletion(batchUrls: string[]) {
    for (const url of batchUrls) {
      checkedUrls.add(url);
    }

    const affectedFiles = new Set<string>();
    for (const url of batchUrls) {
      const files = urlFileMap.get(url);
      if (files) for (const f of files) affectedFiles.add(f);
    }

    for (const file of affectedFiles) {
      if (completedFiles.has(file)) continue;
      const fileUrls = fileUrlSets.get(file);
      if (!fileUrls) continue;

      let allDone = true;
      for (const u of fileUrls) {
        if (!checkedUrls.has(u)) { allDone = false; break; }
      }
      if (!allDone) continue;

      completedFiles.add(file);

      enqueueFileComplete(file);
    }
  }

  async function verifyBackupLinks(options: { allowCancelled?: boolean } = {}): Promise<void> {
    if (isCancelled.value && !options.allowCancelled) return;

    const allBackupUrls = new Set<string>();
    for (const backups of allBackupMap.values()) {
      for (const b of backups) allBackupUrls.add(b.url);
    }

    if (allBackupUrls.size === 0) return;

    scanStage.value = 'backups';

    const backupResult = await checkUrls([...allBackupUrls].map((url) => ({ url })));
    if (backupResult && !backupResult.cancelled) {
      const backupResultMap = new Map(backupResult.results.map((r) => [r.link, r]));
      for (const backups of allBackupMap.values()) {
        for (const b of backups) {
          const cr = backupResultMap.get(b.url);
          if (cr) b.checkResult = cr as CheckLinkResult;
        }
        backups.sort((a, b) => {
          const aV = a.checkResult?.is_valid ? 1 : 0;
          const bV = b.checkResult?.is_valid ? 1 : 0;
          if (aV !== bV) return bV - aV;
          return (a.checkResult?.response_time || 99999) - (b.checkResult?.response_time || 99999);
        });
      }

      imageLinks.value = imageLinks.value.map((link) => {
        if (link.backupLinks) {
          const verified = allBackupMap.get(link.url);
          return verified ? { ...link, backupLinks: verified } : link;
        }
        return link;
      });
    }
  }

  // --- Phase 1: 批量检测 + 边检测边处理文件 ---
  const FLUSH_INTERVAL = 500;
  const pendingResults = new Map<string, CheckLinkResult>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushPending() {
    if (pendingResults.size === 0) return;
    const batch = new Map(pendingResults);
    pendingResults.clear();
    flushTimer = null;

    const updated = imageLinks.value.map((link) => {
      if (link.checkResult) return link;
      const result = batch.get(link.url);
      return result ? { ...link, checkResult: result } : link;
    });
    imageLinks.value = updated;

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

  if (flushTimer) clearTimeout(flushTimer);
  flushPending();

  if (!result) return;

  // 补漏：rAF 可能遗漏部分结果
  const resultMap = new Map<string, CheckLinkResult>();
  for (const r of result.results) resultMap.set(r.link, r as CheckLinkResult);
  for (const r of result.results) checkedUrls.add(r.link);
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

    await Promise.allSettled(backupPromises);

    const partialBackupPromises: Promise<void>[] = [];
    for (const [file, urls] of fileUrlSets) {
      if (readyFiles.value.has(file)) continue;
      let allDone = true;
      for (const u of urls) {
        if (!checkedUrls.has(u)) { allDone = false; break; }
      }
      if (allDone) {
        completedFiles.add(file);
        partialBackupPromises.push(enqueueFileComplete(file, { allowCancelled: true }));
      }
    }
    await Promise.allSettled(partialBackupPromises);

    await verifyBackupLinks({ allowCancelled: true });

    scanStage.value = 'cancelled';
    log.info(`扫描已取消，已检测 ${result.results.length} 条链接`);
    return;
  }

  // 处理可能遗漏的文件（rAF 时序问题）
  for (const [file] of fileUrlSets) {
    if (!completedFiles.has(file)) {
      completedFiles.add(file);
      enqueueFileComplete(file);
    }
  }

  await Promise.all(backupPromises);

  // --- Phase 2: 统一批量验证备用链接可用性 ---
  await verifyBackupLinks();

  // Phase 1 取消已在前面分支处理（L352 scanStage='cancelled'）
  // 这里兜底 Phase 2 期间被取消的场景：否则 scanStage 会卡在 'cancelling'
  if (isCancelled.value) {
    if (scanStage.value !== 'cancelled') {
      scanStage.value = 'cancelled';
      log.info('Phase 2 期间被取消，保留已验证的备用链接结果');
    }
  } else {
    scanStage.value = 'complete';
  }
}
