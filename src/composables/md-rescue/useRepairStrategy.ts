// MD 文档救援 — 修复策略模块
// 负责：图床偏好管理、修复策略应用、排除管理、底栏统计

import { computed, type ComputedRef } from 'vue';
import type { ConfigManagerApi } from '@/composables/useConfig';
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
 *
 * ⚠️ `configManager` 必须由调用方在 setup 栈期间取好传进来，**不要在这里
 * 自己调 `useConfigManager()`**：它内部是 `inject()`，而本函数的调用点是
 * 「扫描完成」的 watcher 回调，那时 Vue 已经没有组件上下文，会直接抛
 * 「No PrimeVue Toast provided!」——整个回调中断，偏好静默加载不上。
 */
export async function loadHostPreference(configManager: ConfigManagerApi): Promise<void> {
  const config = await configManager.loadConfig();
  hostPreference.value = config.mdRescueHostPreference ?? [];
}

/**
 * 将当前图床偏好保存到配置
 *
 * ⚠️ 同上：`configManager` 由调用方在 setup 期间取好传入（调用点是 click 回调）。
 */
export async function saveHostPreference(configManager: ConfigManagerApi): Promise<void> {
  const config = await configManager.loadConfig();
  await configManager.saveConfig({ ...config, mdRescueHostPreference: hostPreference.value }, true);
}

/**
 * 按策略为单张失效图片挑选备用链接（纯函数，不写 selectedBackup）
 *
 * `applyRepairStrategy`（真正应用）与确认对话框的替换摘要预览共用这份挑选逻辑——
 * 预览必须跟点「开始修复」后实际发生的完全一致，不能各写一份而悄悄走样。
 */
export function pickBackupForLink(
  link: MdImageLinkWithFile,
  strategy: RepairStrategy,
): string | undefined {
  if (!link.checkResult || link.checkResult.is_valid) return undefined;
  if (!link.backupLinks?.length) return undefined;

  const validBackups = link.backupLinks.filter((b) => b.checkResult?.is_valid);
  if (validBackups.length === 0) return undefined;

  switch (strategy.type) {
    case 'priority': {
      const order = strategy.order;
      const sorted = [...validBackups].sort((a, b) => {
        const ai = order.indexOf(a.serviceId);
        const bi = order.indexOf(b.serviceId);
        return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
      });
      return sorted[0]?.url;
    }
    case 'fastest': {
      const sorted = [...validBackups].sort(
        (a, b) => (a.checkResult?.response_time ?? 99999) - (b.checkResult?.response_time ?? 99999),
      );
      return sorted[0]?.url;
    }
    case 'manual':
      return strategy.selections.get(link.url);
  }
}

/**
 * 根据修复策略为每张失效图片选择备用链接
 */
export function applyRepairStrategy(strategy: RepairStrategy): void {
  const links = [...imageLinks.value];

  for (const link of links) {
    const picked = pickBackupForLink(link, strategy);
    if (picked) link.selectedBackup = picked;
  }

  imageLinks.value = links;
}

export interface RepairSummary {
  files: Array<{
    path: string;
    fileName: string;
    replacements: Array<{ lineNumber: number; oldUrl: string; newUrl: string; serviceId: string }>;
  }>;
  totalReplacements: number;
  totalFiles: number;
}

/**
 * 按给定策略预览替换摘要（纯函数，不写 imageLinks/selectedBackup）
 *
 * 供确认对话框实时预览用：传入的 `strategy` 必须是用户当前选中的那个（含手动/优先级顺序），
 * 否则摘要会跟点「开始修复」后 `applyRepairStrategy` 实际产生的结果对不上。
 */
export function summarizeRepairStrategy(
  links: MdImageLinkWithFile[],
  strategy: RepairStrategy,
): RepairSummary {
  const fileMap = new Map<string, RepairSummary['files'][number]>();

  for (const link of links) {
    const picked = pickBackupForLink(link, strategy);
    if (!picked) continue;
    const backup = link.backupLinks?.find((b) => b.url === picked);
    if (!backup) continue;

    let entry = fileMap.get(link.sourceFile);
    if (!entry) {
      entry = { path: link.sourceFile, fileName: link.sourceFileName, replacements: [] };
      fileMap.set(link.sourceFile, entry);
    }
    entry.replacements.push({
      lineNumber: link.lineNumber,
      oldUrl: link.url,
      newUrl: picked,
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
