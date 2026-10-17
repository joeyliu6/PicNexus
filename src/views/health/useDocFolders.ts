// 文档文件夹（交接说明 8.3「文档修复」弹窗上半）：增删记进配置、每次扫描前重新申请访问权限、逐个扫描。
// 结果只放内存：进入页面、增删文件夹、修复后各扫一次。单例：页面、弹窗、修复流程共用同一份。

import { computed, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import { useConfigManager } from '@/composables/useConfig';
import { useToast } from '@/composables/useToast';
import { allowUserPaths } from '@/security/fsScope';
import { createLogger } from '@/utils/logger';
import type { ScannedDoc, ScannedFolder } from './docIndex';
import { relativeToFolder } from './docFiles';

const log = createLogger('DocFolders');

export type FolderStatus = 'scanning' | 'ok' | 'missing' | 'denied';

export interface DocFolder {
  path: string;
  status: FolderStatus;
  docs: ScannedDoc[];
}

interface RustScanResult {
  files: ScannedDoc[];
  cancelled: boolean;
}

const folders = ref<DocFolder[]>([]);
const scanning = ref(false);
/** 至少扫过一次（「用于 N 个文档」在这之前不写） */
const scanned = ref(false);
let scanQueue: Promise<void> = Promise.resolve();

function sameFolder(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

function statusOfError(error: unknown): FolderStatus {
  const text = String(error instanceof Error ? error.message : error).toLowerCase();
  return /denied|permission|os error 5\b|forbidden/.test(text) ? 'denied' : 'missing';
}

async function scanOne(path: string): Promise<DocFolder> {
  try {
    await allowUserPaths([path]);
    const result = await invoke<RustScanResult>('scan_md_folder', { dir: path, includeSubfolders: true, includeCodeBlocks: false });
    return { path, status: 'ok', docs: result.files.map((f) => ({ filePath: f.filePath, fileName: f.fileName, links: f.links })) };
  } catch (error) {
    log.warn(`扫描文档文件夹失败: ${path}`, error);
    return { path, status: statusOfError(error), docs: [] };
  }
}

export function useDocFolders() {
  const toast = useToast();
  const { loadConfig, saveConfig } = useConfigManager();

  async function savedFolders(): Promise<{ config: UserConfig; list: string[] }> {
    const config = await loadConfig();
    return { config, list: config.linkHealth?.docFolders ?? [] };
  }

  async function saveFolders(config: UserConfig, list: string[]): Promise<void> {
    const linkHealth = { ...DEFAULT_CONFIG.linkHealth!, ...config.linkHealth, docFolders: list };
    await saveConfig({ ...config, linkHealth }, true);
  }

  /** 扫描（排队执行：Rust 侧扫描的取消标志是全局的，同时扫两个会互相干扰） */
  function scan(paths?: string[]): Promise<void> {
    scanQueue = scanQueue.then(async () => {
      const { list } = await savedFolders();
      const targets = paths ?? list;
      folders.value = list.map((path) => folders.value.find((f) => sameFolder(f.path, path))
        ?? { path, status: 'scanning', docs: [] });
      if (targets.length === 0) {
        scanned.value = true;
        return;
      }
      scanning.value = true;
      try {
        for (const path of targets) {
          folders.value = folders.value.map((f) => (sameFolder(f.path, path) ? { ...f, status: 'scanning' } : f));
          const result = await scanOne(path);
          folders.value = folders.value.map((f) => (sameFolder(f.path, path) ? result : f));
        }
        scanned.value = true;
      } finally {
        scanning.value = false;
      }
    }).catch((error) => log.error('扫描文档文件夹失败', error));
    return scanQueue;
  }

  /** 「添加文件夹…」：已在列表里（或在其中某个文件夹里面）不重复加；加的是已有文件夹的上层时，收掉被它包含的那几个 */
  async function add(): Promise<boolean> {
    const picked = await openDialog({ directory: true, multiple: false });
    const path = typeof picked === 'string' ? picked : null;
    if (!path) return false;
    const { config, list } = await savedFolders();
    if (list.some((existing) => sameFolder(existing, path) || relativeToFolder(existing, path) !== null)) {
      toast.info('已在文档文件夹中', path);
      return false;
    }
    const next = [...list.filter((existing) => relativeToFolder(path, existing) === null), path];
    await saveFolders(config, next);
    await scan([path]);
    return true;
  }

  async function remove(path: string): Promise<void> {
    const { config, list } = await savedFolders();
    await saveFolders(config, list.filter((p) => !sameFolder(p, path)));
    folders.value = folders.value.filter((f) => !sameFolder(f.path, path));
  }

  const scannedFolders = computed<ScannedFolder[]>(() => folders.value
    .filter((f) => f.status === 'ok')
    .map((f) => ({ folder: f.path, docs: f.docs })));

  return { folders, scanning, scanned, scannedFolders, scan, add, remove };
}
