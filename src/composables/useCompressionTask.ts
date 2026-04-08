/**
 * 压缩预览任务管理：文件选择、调用 Tauri 压缩命令、状态管理
 */
import { ref, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import type { CompressionPreset } from '../config/types';

/** Tauri 返回的压缩结果 */
export interface CompressResult {
  outputPath: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  width: number;
  height: number;
  format: string;
}

export type CompressionStatus = 'compressing' | 'done' | 'error';

export function useCompressionTask(
  preset: Ref<CompressionPreset>,
  options: {
    /** 压缩完成/出错后的回调 */
    onDone?: () => void;
    onError?: () => void;
  } = {},
) {
  const status = ref<CompressionStatus>('compressing');
  const fileName = ref('');
  const originalSrc = ref('');
  const compressedSrc = ref('');
  const result = ref<CompressResult | null>(null);
  const errorMsg = ref('');

  /** 节省百分比 */
  function getSaved(): number {
    if (!result.value) return 0;
    return Math.round((1 - result.value.ratio) * 100);
  }

  /** 压缩后体积是否反而更大 */
  function getIsLarger(): boolean {
    return result.value ? result.value.ratio >= 1 : false;
  }

  /** 格式化文件大小 */
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /** 重置所有状态 */
  function resetState() {
    status.value = 'compressing';
    fileName.value = '';
    originalSrc.value = '';
    compressedSrc.value = '';
    result.value = null;
    errorMsg.value = '';
  }

  /**
   * 弹出文件选择框 → 执行压缩 → 加载预览 base64
   * @returns 用户是否选择了文件（false = 用户取消了选择）
   */
  async function selectAndCompress(): Promise<boolean> {
    resetState();

    const selected = await dialogOpen({
      multiple: false,
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
    });

    if (!selected) return false;

    const filePath = Array.isArray(selected) ? selected[0] : selected;
    fileName.value = filePath.split(/[/\\]/).pop() || filePath;

    try {
      const p = preset.value;
      let maxLongSide = 0;
      const scalePercent = p.scalePercent ?? 100;
      if (scalePercent > 0 && scalePercent < 100) {
        const meta = await invoke<{ width: number; height: number }>(
          'get_image_metadata',
          { path: filePath },
        );
        maxLongSide = Math.round(
          Math.max(meta.width, meta.height) * scalePercent / 100,
        );
      }

      const [compressResult, origB64] = await Promise.all([
        invoke<CompressResult>('compress_image', {
          filePath,
          quality: p.quality,
          maxLongSide,
          outputFormat: p.outputFormat,
          stripExif: p.stripExif,
        }),
        invoke<string>('read_image_as_base64', { filePath, maxSide: 1200 }),
      ]);

      result.value = compressResult;
      originalSrc.value = origB64;

      const compB64 = await invoke<string>('read_image_as_base64', {
        filePath: compressResult.outputPath,
        maxSide: 1200,
      });
      compressedSrc.value = compB64;

      // 清理临时文件（不阻塞）
      invoke('cleanup_compressed_files', {
        filePaths: [compressResult.outputPath],
      }).catch(() => {});

      status.value = 'done';
      options.onDone?.();
    } catch (err: unknown) {
      errorMsg.value = err instanceof Error ? err.message : String(err);
      status.value = 'error';
      options.onError?.();
    }

    return true;
  }

  return {
    // 状态
    status,
    fileName,
    originalSrc,
    compressedSrc,
    result,
    errorMsg,

    // 方法
    getSaved,
    getIsLarger,
    formatSize,
    resetState,
    selectAndCompress,
  };
}
