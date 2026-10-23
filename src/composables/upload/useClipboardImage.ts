// 剪贴板图片读取 Composable

import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { useToast } from '@/composables/useToast';
import { useQueueState } from './useQueueState';
import { createLogger } from '@/utils/logger';
import { cleanupClipboardTempFile } from '@/utils/clipboardTempFile';
import { isStatusError } from '@/utils/uploadStatus';
import { uiPlatform } from '@/utils/platform';
import { getErrorMessage } from '@/types/errors';

const log = createLogger('useClipboardImage');

/** 判断文本是否为图片 URL */
function isImageUrl(text: string): boolean {
  return /^https?:\/\/.+\.(jpe?g|png|gif|webp|bmp|svg|tiff?|ico|avif)([?#].*)?$/i.test(text);
}

/** 剪贴板里的文字是一条图片链接时返回它；不是、或读不出文字，返回 null */
async function readClipboardImageUrl(): Promise<string | null> {
  try {
    const text = (await readText())?.trim() ?? '';
    return isImageUrl(text) ? text : null;
  } catch (error) {
    log.debug('读取剪贴板文本失败:', error);
    return null;
  }
}

/**
 * 「上传剪贴板图片」有没有东西可传：图片，或一条图片链接（文字，先下载再上传）。
 * 与 pasteAndUpload 同一个口径；托盘第一项据此变灰
 */
export async function clipboardHasUploadable(): Promise<boolean> {
  return (await invoke<boolean>('clipboard_has_image')) || (await readClipboardImageUrl()) !== null;
}

function hasRetryableFailureForFile(filePath: string): boolean {
  const { queueItems } = useQueueState();
  return queueItems.value.some(item =>
    item.filePath === filePath &&
    Object.values(item.serviceProgress || {}).some(progress => isStatusError(progress?.status))
  );
}

/** 剪贴板图片读取结果 */
export interface ClipboardImageResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

/**
 * 剪贴板图片读取 Composable
 * 提供从剪贴板读取图片并上传的功能
 */
export function useClipboardImage() {
  const toast = useToast();
  const isProcessing = ref(false);

  /**
   * 从剪贴板读取图片并保存为临时文件
   * @returns 临时文件路径或错误
   */
  async function readClipboardImage(): Promise<ClipboardImageResult> {
    if (isProcessing.value) {
      return { success: false, error: '正在处理中...' };
    }

    isProcessing.value = true;

    try {
      // 1. 检查剪贴板是否包含图片
      const hasImg = await invoke<boolean>('clipboard_has_image');

      if (!hasImg) {
        return {
          success: false,
          error: '剪贴板中没有图片'
        };
      }

      // 2. 读取图片并保存为临时文件
      const tempFilePath = await invoke<string>('read_clipboard_image');

      return {
        success: true,
        filePath: tempFilePath
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error('读取失败:', error);
      return {
        success: false,
        error: errorMsg
      };
    } finally {
      isProcessing.value = false;
    }
  }

  /**
   * 从剪贴板粘贴图片并触发上传
   * @param uploadHandler 上传处理函数（传入文件路径数组）
   */
  async function pasteAndUpload(
    uploadHandler: (filePaths: string[]) => Promise<void>
  ): Promise<void> {
    const result = await readClipboardImage();

    if (result.success && result.filePath) {
      try {
        await uploadHandler([result.filePath]);
      } finally {
        if (hasRetryableFailureForFile(result.filePath)) {
          log.debug('检测到剪贴板上传仍有失败服务，保留临时文件用于重试:', result.filePath);
        } else {
          await cleanupClipboardTempFile(result.filePath);
        }
      }
      return;
    }

    // 剪贴板没有图片数据：文字是一条图片链接就下载再上传
    const url = await readClipboardImageUrl();
    if (url) {
      log.info('检测到剪贴板中的图片 URL，开始下载:', url);
      try {
        const downloadResult = await invoke<{ file_path: string }>('download_url_image', { url });
        await uploadHandler([downloadResult.file_path]);
      } catch (downloadError) {
        log.error('图片 URL 下载失败:', downloadError);
        // 这次粘贴上传失败了（红），原因照 Rust 的原话
        toast.error('图片链接下载失败', `${getErrorMessage(downloadError)}，请检查链接后重试`);
      }
      return;
    }

    // 不算出错，说清怎么做（Patterns.dc.html 通知样例，灰色 i）
    toast.info('剪贴板里没有图片', `复制一张图片后再按 ${uiPlatform() === 'macos' ? '⌘ V' : 'Ctrl V'}`);
  }

  return {
    isProcessing,
    readClipboardImage,
    pasteAndUpload
  };
}
