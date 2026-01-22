// 剪贴板图片读取 Composable

import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from './useToast';

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
      console.log('[剪贴板] 检查剪贴板是否包含图片...');
      const hasImg = await invoke<boolean>('clipboard_has_image');

      if (!hasImg) {
        return {
          success: false,
          error: '剪贴板中没有图片'
        };
      }

      // 2. 读取图片并保存为临时文件
      console.log('[剪贴板] 正在读取图片...');
      const tempFilePath = await invoke<string>('read_clipboard_image');

      console.log('[剪贴板] 临时文件已创建:', tempFilePath);

      return {
        success: true,
        filePath: tempFilePath
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[剪贴板] 读取失败:', error);
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

    if (!result.success) {
      toast.warn('粘贴失败', result.error || '无法读取剪贴板图片');
      return;
    }

    if (result.filePath) {
      // 调用上传处理器
      await uploadHandler([result.filePath]);
    }
  }

  return {
    isProcessing,
    readClipboardImage,
    pasteAndUpload
  };
}
