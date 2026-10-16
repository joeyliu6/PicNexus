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
 * 从配置加载图床偏好
 *
 * `configManager` 由调用方传进来（便于测试替换）。
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
  }
}

function hasValidSelection(link: MdImageLinkWithFile): boolean {
  return Boolean(link.selectedBackup)
    && (link.backupLinks?.some((b) => b.checkResult?.is_valid && b.url === link.selectedBackup) ?? false);
}

/**
 * 扫描结束时给每张可修复的图定好替换来源：有保存的首选顺序就按它，没有就挑最快的
 *
 * Why 扫描一结束就定、而不是等点「修复」时再算：列表上显示的替换来源必须就是
 * 真正会写进文件的那一条——所见即所改，才敢不弹确认框直接修。
 * 用户已经手动选过的（仍然有效）不覆盖。
 */
export function applyDefaultBackups(preference: string[]): void {
  const strategy: RepairStrategy = preference.length > 0
    ? { type: 'priority', order: preference }
    : { type: 'fastest' };
  const links = [...imageLinks.value];
  let changed = false;
  for (const link of links) {
    if (hasValidSelection(link)) continue;
    const picked = pickBackupForLink(link, strategy);
    if (picked && picked !== link.selectedBackup) {
      link.selectedBackup = picked;
      changed = true;
    }
  }
  if (changed) imageLinks.value = links;
}

/**
 * 「以后都优先用这个图床」：把它提到首选顺序最前，并立刻应用到所有在它上面有可用备份的图
 *
 * 只改内存里的 hostPreference，持久化由调用方 saveHostPreference 负责（要 configManager）。
 */
export function preferServiceForAll(serviceId: string): number {
  hostPreference.value = [serviceId, ...hostPreference.value.filter((id) => id !== serviceId)];
  const links = [...imageLinks.value];
  let changed = 0;
  for (const link of links) {
    if (!link.checkResult || link.checkResult.is_valid) continue;
    const backup = link.backupLinks?.find((b) => b.serviceId === serviceId && b.checkResult?.is_valid);
    if (!backup || backup.url === link.selectedBackup) continue;
    link.selectedBackup = backup.url;
    changed++;
  }
  if (changed > 0) imageLinks.value = links;
  return changed;
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
