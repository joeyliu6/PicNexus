// URL 图片下载 Composable

import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from './useToast';
import { createLogger } from '../utils/logger';
import { TOAST_MESSAGES } from '../constants';

const log = createLogger('useUrlDownload');

/** Rust 侧返回的下载结果 */
interface RustDownloadResult {
  file_path: string;
  content_type: string;
  file_size: number;
}

const MAX_URLS = 20;
const MAX_CONCURRENT_DOWNLOADS = 3;

interface ParsedUrls {
  urls: string[];
  truncatedCount: number;
}

/**
 * URL 图片下载 Composable
 * 提供从 URL 下载图片并触发上传的功能
 */
export function useUrlDownload() {
  const toast = useToast();
  const isDownloading = ref(false);

  /**
   * 解析用户输入，提取有效 URL
   */
  function parseUrlInput(input: string): ParsedUrls {
    const lines = input.split('\n');
    const urls: string[] = [];
    const seen = new Set<string>();
    let truncatedCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!/^https?:\/\//i.test(trimmed)) continue;
      if (seen.has(trimmed)) continue;

      seen.add(trimmed);
      if (urls.length < MAX_URLS) {
        urls.push(trimmed);
      } else {
        truncatedCount += 1;
      }
    }

    return { urls, truncatedCount };
  }

  function parseUrls(input: string): string[] {
    const { urls } = parseUrlInput(input);
    return urls;
  }

  /**
   * 下载单个 URL 图片
   */
  async function downloadSingle(url: string): Promise<string> {
    const result = await invoke<RustDownloadResult>('download_url_image', { url });
    return result.file_path;
  }

  /**
   * 下载 URL 图片并触发上传
   * @param input 用户输入的文本（可包含多个 URL）
   * @param uploadHandler 上传处理函数
   */
  async function downloadAndUpload(
    input: string,
    uploadHandler: (filePaths: string[]) => Promise<void>
  ): Promise<void> {
    if (isDownloading.value) return;

    const { urls, truncatedCount } = parseUrlInput(input);
    if (urls.length === 0) {
      toast.showConfig('warn', TOAST_MESSAGES.urlDownload.invalidUrl);
      return;
    }

    if (truncatedCount > 0) {
      toast.showConfig('warn', TOAST_MESSAGES.urlDownload.tooManyUrls(MAX_URLS, truncatedCount));
    }

    isDownloading.value = true;

    try {
      const filePathsByIndex: Array<string | undefined> = [];
      const errors: string[] = [];

      // 并发下载，限制并发数
      let active = 0;
      let index = 0;

      await new Promise<void>((resolve) => {
        const runNext = () => {
          if (index >= urls.length && active === 0) {
            resolve();
            return;
          }
          while (active < MAX_CONCURRENT_DOWNLOADS && index < urls.length) {
            const currentIndex = index++;
            const currentUrl = urls[currentIndex];
            active++;
            downloadSingle(currentUrl)
              .then((path) => {
                filePathsByIndex[currentIndex] = path;
                log.info(`下载成功: ${currentUrl}`);
              })
              .catch((error) => {
                const msg = error instanceof Error ? error.message : String(error);
                errors.push(`${currentUrl}: ${msg}`);
                log.warn(`下载失败: ${currentUrl}`, error);
              })
              .finally(() => {
                active--;
                runNext();
              });
          }
        };
        runNext();
      });

      // 结果处理
      const filePaths = filePathsByIndex.filter((path): path is string => Boolean(path));
      if (filePaths.length === 0) {
        const detail = errors.length === 1
          ? errors[0]
          : `${errors.length} 个 URL 全部下载失败`;
        toast.showConfig('error', TOAST_MESSAGES.urlDownload.downloadFailed(detail));
        return;
      }

      if (errors.length > 0) {
        toast.showConfig('warn', TOAST_MESSAGES.urlDownload.partialFailed(filePaths.length, errors.length));
      }

      // 触发上传
      await uploadHandler(filePaths);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('URL 下载流程异常:', error);
      toast.showConfig('error', TOAST_MESSAGES.urlDownload.downloadFailed(msg));
    } finally {
      isDownloading.value = false;
    }
  }

  return {
    isDownloading,
    parseUrls,
    downloadAndUpload
  };
}
