import { invoke } from '@tauri-apps/api/core';
import { createLogger } from './logger';

const log = createLogger('ClipboardTempFile');
const CLIPBOARD_TEMP_FILE_PATTERN = /^clipboard_image_.+\.png$/i;

export function isClipboardTempFilePath(filePath: string | undefined): filePath is string {
  if (!filePath) return false;

  const normalized = filePath.replace(/\\/g, '/');
  const fileName = normalized.split('/').pop() || '';
  return CLIPBOARD_TEMP_FILE_PATTERN.test(fileName);
}

export async function cleanupClipboardTempFile(filePath: string | undefined): Promise<void> {
  if (!isClipboardTempFilePath(filePath)) return;

  try {
    await invoke('cleanup_clipboard_temp_file', { path: filePath });
  } catch (error) {
    log.warn('清理剪贴板临时文件失败:', error);
  }
}
