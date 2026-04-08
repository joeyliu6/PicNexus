// MD 文档救援 — 修复策略模块
// 负责：图床偏好管理、修复策略应用、排除管理、底栏统计

import { computed, type ComputedRef } from 'vue';
import { useConfigManager } from '../useConfig';
import {
  type MdImageLinkWithFile,
  type RepairStrategy,
  type FileHealth,
  imageLinks,
  excludedUrls,
  hostPreference,
  healedFiles,
} from './shared';

/**
 * 按图床偏好为每张失效图片选择最佳备用链接
 */
export function applyHostPreference(links: MdImageLinkWithFile[], preference: string[]): void {
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
export async function loadHostPreference(): Promise<void> {
  const { loadConfig } = useConfigManager();
  const config = await loadConfig();
  hostPreference.value = config.mdRescueHostPreference ?? [];
}

/**
 * 将当前图床偏好保存到配置
 */
export async function saveHostPreference(): Promise<void> {
  const { loadConfig, saveConfig } = useConfigManager();
  const config = await loadConfig();
  await saveConfig({ ...config, mdRescueHostPreference: hostPreference.value }, true);
}

/**
 * 根据修复策略为每张失效图片选择备用链接
 */
export function applyRepairStrategy(strategy: RepairStrategy): void {
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

/**
 * 自动选择最佳备用链接并返回替换摘要
 */
export function autoSelectAndGetSummary(): {
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

export function toggleExclude(url: string): void {
  const next = new Set(excludedUrls.value);
  if (next.has(url)) {
    next.delete(url);
  } else {
    next.add(url);
  }
  excludedUrls.value = next;
}

export function excludeAll(): void {
  excludedUrls.value = new Set(imageLinks.value.map((l) => l.url));
}

export function includeAll(): void {
  excludedUrls.value = new Set();
}

/**
 * 底栏统计数据
 * @param fileHealthList 文件健康列表 computed（由主模块传入）
 */
export function useBottomStats(fileHealthList: ComputedRef<FileHealth[]>) {
  return computed(() => {
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
    // 文件级健康计数：仅统计已完成检测（ready）的文件，避免未检测被误算正常
    let normalFileCount = 0;
    let problemFileCount = 0;
    for (const f of fileHealthList.value) {
      if (!f.ready) continue;
      if (f.status === 'healthy') normalFileCount++;
      else problemFileCount++;
    }
    const checkedCount = normalCount + problemCount;
    return {
      totalFiles, totalImages, normalCount, problemCount, checkedCount, repairedCount, manualCount,
      normalFileCount, problemFileCount,
    };
  });
}
