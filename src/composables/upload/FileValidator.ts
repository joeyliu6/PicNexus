// src/composables/upload/FileValidator.ts
// 上传文件校验与选择：扩展名过滤 + 系统文件对话框

import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { useToast } from '../useToast';
import { TOAST_MESSAGES } from '../../constants';
import { createLogger } from '../../utils/logger';

const log = createLogger('FileValidator');

/** 允许上传的图片扩展名 */
export const VALID_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] as const;

/** 单次上传最大文件数，防止内存溢出 */
export const MAX_FILES_PER_UPLOAD = 200;

/**
 * 按扩展名过滤有效的图片文件
 * @param filePaths 文件路径列表
 */
export async function filterValidFiles(filePaths: string[]): Promise<{
  valid: string[];
  invalid: string[];
}> {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const filePath of filePaths) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext && (VALID_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
      valid.push(filePath);
    } else {
      invalid.push(filePath);
    }
  }

  return { valid, invalid };
}

/**
 * 打开系统文件选择对话框，返回用户选中的图片路径
 */
export async function selectFiles(): Promise<string[] | null> {
  const toast = useToast();
  try {
    const selected = await dialogOpen({
      multiple: true,
      filters: [{
        name: '图片',
        extensions: [...VALID_IMAGE_EXTENSIONS]
      }]
    });

    if (selected) {
      return Array.isArray(selected) ? selected : [selected];
    }
    return null;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error('文件选择失败:', error);
    toast.showConfig('error', TOAST_MESSAGES.upload.selectFailed(errorMsg));
    return null;
  }
}
