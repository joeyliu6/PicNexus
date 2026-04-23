// 剪贴板图片读取 Composable

import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { useToast } from './useToast';
import { createLogger } from '../utils/logger';

const log = createLogger('useClipboardImage');

/** 判断文本是否为图片 URL */
function isImageUrl(text: string): boolean {
  return /^https?:\/\/.+\.(jpe?g|png|gif|webp|bmp)([?#].*)?$/i.test(text);
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
      await uploadHandler([result.filePath]);
      return;
    }

    // 剪贴板没有图片数据，尝试读取文本判断是否为图片 URL
    try {
      const text = await readText();
      const trimmed = text?.trim() || '';
      if (isImageUrl(trimmed)) {
        log.info('检测到剪贴板中的图片 URL，开始下载:', trimmed);
        try {
          const downloadResult = await invoke<{ file_path: string }>('download_url_image', { url: trimmed });
          await uploadHandler([downloadResult.file_path]);
          return;
        } catch (downloadError) {
          log.error('图片 URL 下载失败:', downloadError);
          toast.warn('下载失败', `图片链接下载失败: ${String(downloadError)}`);
          return;
        }
      }
    } catch (error) {
      log.debug('读取剪贴板文本失败:', error);
    }

    toast.warn('粘贴失败', '剪贴板中没有图片，也没有有效的图片链接');
  }

  return {
    isProcessing,
    readClipboardImage,
    pasteAndUpload
  };
}
