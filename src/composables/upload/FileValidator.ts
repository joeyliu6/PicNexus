// src/composables/upload/FileValidator.ts
// 上传文件校验与选择：扩展名过滤 + 系统文件对话框

import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { useToast } from '../useToast';
import { TOAST_MESSAGES } from '../../constants';
import { createLogger } from '../../utils/logger';
import { Semaphore } from '../../utils/semaphore';

const log = createLogger('FileValidator');

/** 允许上传的图片扩展名 */
export const VALID_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] as const;

/** 单次上传最大文件数，防止内存溢出 */
export const MAX_FILES_PER_UPLOAD = 200;

const IMAGE_VALIDATION_CONCURRENCY = 5;

interface ImageHeaderMetadata {
  width: number;
  height: number;
}

export interface FileValidationResult {
  valid: string[];
  invalid: string[];
  truncatedCount: number;
}

function hasValidImageExtension(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return !!ext && (VALID_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

async function canReadImageHeader(filePath: string): Promise<boolean> {
  try {
    const metadata = await invoke<ImageHeaderMetadata>('get_image_metadata', { filePath });
    return Number(metadata?.width) > 0 && Number(metadata?.height) > 0;
  } catch (error) {
    log.warn('图片文件头校验失败:', filePath, error);
    return false;
  }
}

/**
 * 按扩展名过滤有效的图片文件
 * @param filePaths 文件路径列表
 */
export async function filterValidFiles(
  filePaths: string[],
  maxValidFiles: number = MAX_FILES_PER_UPLOAD
): Promise<FileValidationResult> {
  const valid: string[] = [];
  const invalidByExtension: string[] = [];
  const candidates: string[] = [];

  for (const filePath of filePaths) {
    if (hasValidImageExtension(filePath)) {
      candidates.push(filePath);
    } else {
      invalidByExtension.push(filePath);
    }
  }

  const safeLimit = Math.max(0, maxValidFiles);
  const candidatesToValidate = candidates.slice(0, safeLimit);
  const truncatedCount = Math.max(0, candidates.length - candidatesToValidate.length);
  const invalid = [...invalidByExtension];

  const semaphore = new Semaphore(IMAGE_VALIDATION_CONCURRENCY);
  const checks = await Promise.all(candidatesToValidate.map(async (filePath) => {
    await semaphore.acquire();
    try {
      return { filePath, isValid: await canReadImageHeader(filePath) };
    } finally {
      semaphore.release();
    }
  }));

  checks.forEach(({ filePath, isValid }) => {
    if (isValid) valid.push(filePath);
    else invalid.push(filePath);
  });

  return { valid, invalid, truncatedCount };
}

/**
 * 打开系统文件选择对话框，返回用户选中的图片路径
 * @param toast toast 实例（由 composable 在 setup 阶段注入，避免在回调中调用 useToast）
 */
export async function selectFiles(toast?: ReturnType<typeof useToast>): Promise<string[] | null> {
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
    toast?.showConfig('error', TOAST_MESSAGES.upload.selectFailed(errorMsg));
    return null;
  }
}
