// MD 文档救援 — 文件加载模块
// 负责：单文件/文件夹加载、拖放处理、链接收集

import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Semaphore } from '../../utils/semaphore';
import { useToast } from '../useToast';
import { createLogger } from '../../utils/logger';
import { extractImageLinks } from '../../utils/mdParser';
import { recordMruEntry } from './useMdRescueMru';
import type { MdImageLink } from '../../types/linkCheck';
import {
  type MdImageLinkWithFile,
  type RustScanProgress,
  type RustScanResult,
  MD_EXTENSIONS,
  COLLECT_CONCURRENCY,
  mode,
  filePath,
  folderPath,
  mdFiles,
  fileContent,
  imageLinks,
  isCollecting,
  collectProgress,
  includeSubfolders,
  phase,
  scanStage,
  scanProgress,
  readyFiles,
  skippedDirs,
  getCollectCancelled,
  setCollectCancelled,
} from './shared';

const log = createLogger('MdRescue:Loader');

export function getFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

export function isMarkdownFile(path: string): boolean {
  return MD_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

export function wrapLinksWithFile(links: MdImageLink[], file: string): MdImageLinkWithFile[] {
  const name = getFileName(file);
  return links.map((l) => ({ ...l, sourceFile: file, sourceFileName: name }));
}

/** 从多个文件中并发收集所有图片链接（8 路并发 + 进度回调 + 取消支持） */
export async function collectLinksFromFiles(
  files: string[],
  onProgress?: (processed: number, found: number) => void,
): Promise<MdImageLinkWithFile[]> {
  const allLinks: MdImageLinkWithFile[] = [];
  const sem = new Semaphore(COLLECT_CONCURRENCY);
  let processed = 0;

  await Promise.all(files.map((file) =>
    sem.withPermit(async () => {
      if (getCollectCancelled()) return;
      try {
        const content = await readTextFile(file);
        if (getCollectCancelled()) return;
        allLinks.push(...wrapLinksWithFile(extractImageLinks(content), file));
      } catch (err) {
        log.warn(`读取文件失败: ${file}`, err);
      }
      processed++;
      onProgress?.(processed, allLinks.length);
    }),
  ));

  return allLinks;
}

/** 加载单文件核心逻辑（dialog / 拖放共用） */
export async function loadFileImpl(path: string): Promise<void> {
  mode.value = 'file';
  filePath.value = path;
  folderPath.value = null;
  mdFiles.value = [];
  const content = await readTextFile(path);
  fileContent.value = content;
  imageLinks.value = wrapLinksWithFile(extractImageLinks(content), path);
  recordMruEntry(path, 'file');
}

/**
 * Composable 工厂：提供 5 个依赖 toast 的 MD 文件加载函数。
 *
 * 必须在组件 setup() 或其它 composable 顶层同步调用，因为内部 `useToast()`
 * 依赖 Vue 的 `inject()`，只在 setup 栈期间可用。返回的函数通过闭包持有
 * toast 引用，因此可以安全地在 click handler、拖放回调等异步上下文中调用。
 */
export function useMdFileLoader() {
  const toast = useToast();

  /**
   * 加载文件夹核心逻辑（dialog / 拖放共用）
   * 使用 Rust scan_md_folder 单次 IPC 完成：递归扫描 + 批量读取 + 正则提取
   */
  async function loadFolderImpl(dir: string): Promise<boolean> {
    mode.value = 'folder';
    folderPath.value = dir;
    filePath.value = null;
    fileContent.value = null;

    // 清空上次扫描的残留数据
    imageLinks.value = [];
    mdFiles.value = [];
    readyFiles.value = new Set();
    skippedDirs.value = [];
    phase.value = 'idle';
    scanStage.value = 'checking';
    scanProgress.value = null;
    collectProgress.value = { scannedFiles: 0, processedFiles: 0, foundLinks: 0 };

    setCollectCancelled(false);
    isCollecting.value = true;

    // 监听 Rust 侧的实时进度事件
    let progressUnlisten: UnlistenFn | null = null;
    try {
      progressUnlisten = await listen<RustScanProgress>('md-scan://progress', (event) => {
        const p = event.payload;
        collectProgress.value = {
          scannedFiles: p.scannedFiles,
          processedFiles: p.processedFiles,
          foundLinks: p.foundLinks,
          currentFile: p.currentFile || undefined,
        };
      });

      // 单次 IPC：目录扫描 + 文件读取 + 链接提取全部在 Rust 完成
      const result = await invoke<RustScanResult>('scan_md_folder', {
        dir,
        includeSubfolders: includeSubfolders.value,
      });

      if (result.cancelled) return false;

      // 保存跳过的目录信息
      skippedDirs.value = result.skippedDirs ?? [];

      // 转换 Rust 结果为前端类型
      const allLinks: MdImageLinkWithFile[] = [];
      const filePaths: string[] = [];
      for (const file of result.files) {
        filePaths.push(file.filePath);
        for (const link of file.links) {
          allLinks.push({
            originalText: link.originalText,
            url: link.url,
            altText: link.altText,
            lineNumber: link.lineNumber,
            syntax: link.syntax,
            context: link.context,
            sourceFile: file.filePath,
            sourceFileName: file.fileName,
          });
        }
      }

      mdFiles.value = filePaths;
      imageLinks.value = allLinks;

      if (filePaths.length === 0) {
        toast.info('未找到 MD 文件', '该文件夹中没有 Markdown 文件');
        return false;
      }

      recordMruEntry(dir, 'folder');
      if (allLinks.length === 0) {
        toast.info('未找到图片链接', `${filePaths.length} 个文件中均无图片链接`);
      }

      log.info(`Rust 扫描完成: ${result.totalFiles} 文件, ${result.totalLinks} 链接, ${result.elapsedMs}ms`);
      return true;
    } finally {
      progressUnlisten?.();
      isCollecting.value = false;
      collectProgress.value = null;
    }
  }

  async function selectMdFile(): Promise<boolean> {
    try {
      const selected = await dialogOpen({
        multiple: false,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
      });
      if (!selected) return false;
      const path = typeof selected === 'string' ? selected : (selected as string[])[0];
      if (!path) return false;

      await loadFileImpl(path);
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

  async function selectFolder(): Promise<boolean> {
    try {
      const selected = await dialogOpen({ directory: true, recursive: true });
      if (!selected) return false;
      const dir = typeof selected === 'string' ? selected : (selected as string[])[0];
      if (!dir) return false;

      return await loadFolderImpl(dir);
    } catch (err) {
      log.error('选择文件夹失败', err);
      toast.error('文件夹打开失败', String(err));
      return false;
    }
  }

  async function loadFilePath(path: string): Promise<boolean> {
    try {
      if (!isMarkdownFile(path)) {
        toast.info('不支持的文件类型', '请拖放 Markdown 文件（.md / .markdown）');
        return false;
      }
      await loadFileImpl(path);
      if (imageLinks.value.length === 0) {
        toast.info('未找到图片链接', '该文件中没有图片链接');
      }
      return true;
    } catch (err) {
      log.error('加载文件失败', err);
      toast.error('文件加载失败', String(err));
      return false;
    }
  }

  async function loadFolderPath(dir: string): Promise<boolean> {
    try {
      return await loadFolderImpl(dir);
    } catch (err) {
      log.error('加载文件夹失败', err);
      toast.error('文件夹加载失败', String(err));
      return false;
    }
  }

  return {
    loadFolderImpl,
    selectMdFile,
    selectFolder,
    loadFilePath,
    loadFolderPath,
  };
}
