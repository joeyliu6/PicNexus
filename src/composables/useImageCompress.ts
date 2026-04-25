import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { CompressionPreset } from '../config/types';
import { createLogger } from '../utils/logger';

const log = createLogger('ImageCompress');

interface CompressResult {
  outputPath: string;
  originalSize: number;
  compressedSize: number;
  ratio: number;
  width: number;
  height: number;
  format: string;
}

/** 累计节省的字节数（本次会话） */
const totalBytesSaved = ref(0);

/** 待清理的临时文件路径 */
const pendingCleanup: string[] = [];

export function useImageCompress() {
  /**
   * 压缩单张图片
   * @param filePath 原图路径
   * @param preset 当前激活的压缩预设
   * @param fileSize 文件大小（字节），用于跳过小文件判断
   */
  async function compressImage(
    filePath: string,
    preset: CompressionPreset,
    fileSize?: number,
  ): Promise<{ filePath: string; compressed: boolean; result?: CompressResult }> {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext === 'gif') {
      log.debug(`跳过 GIF 动图: ${filePath}`);
      return { filePath, compressed: false };
    }

    // 检查是否跳过小文件
    if (preset.skipIfSmallerKB > 0 && fileSize !== undefined) {
      const fileSizeKB = fileSize / 1024;
      if (fileSizeKB < preset.skipIfSmallerKB) {
        log.debug(`跳过压缩（${fileSizeKB.toFixed(0)}KB < ${preset.skipIfSmallerKB}KB）: ${filePath}`);
        // 即使跳过压缩，如果开了 stripExif 也要去除元数据
        if (preset.stripExif) {
          return await stripExifOnly(filePath);
        }
        return { filePath, compressed: false };
      }
    }

    try {
      let maxLongSide = preset.maxLongSide ?? 0;
      const scalePercent = preset.scalePercent ?? 100;
      if (scalePercent > 0 && scalePercent < 100) {
        const meta = await invoke<{ width: number; height: number }>('get_image_metadata', { filePath });
        const longSide = Math.max(meta.width, meta.height);
        maxLongSide = Math.round(longSide * scalePercent / 100);
      }

      const result = await invoke<CompressResult>('compress_image', {
        filePath,
        quality: preset.quality,
        maxLongSide,
        outputFormat: preset.outputFormat,
        stripExif: preset.stripExif,
      });

      if (result.compressedSize >= result.originalSize) {
        log.debug(`压缩后更大，使用原图: ${filePath}`);
        pendingCleanup.push(result.outputPath);
        return { filePath, compressed: false };
      }

      const saved = result.originalSize - result.compressedSize;
      totalBytesSaved.value += saved;
      pendingCleanup.push(result.outputPath);

      log.info(
        `压缩完成: ${(result.originalSize / 1024).toFixed(0)}KB → ${(result.compressedSize / 1024).toFixed(0)}KB (${(result.ratio * 100).toFixed(0)}%)`,
      );

      return { filePath: result.outputPath, compressed: true, result };
    } catch (err) {
      log.warn(`压缩失败，使用原图: ${filePath}`, err);
      return { filePath, compressed: false };
    }
  }

  /**
   * 仅去除 EXIF 元数据（跳过压缩的小文件使用）
   */
  async function stripExifOnly(
    filePath: string,
  ): Promise<{ filePath: string; compressed: boolean; result?: CompressResult }> {
    try {
      const result = await invoke<CompressResult>('strip_exif_only', { filePath });
      pendingCleanup.push(result.outputPath);
      log.debug(`EXIF 已剥离: ${filePath}`);
      return { filePath: result.outputPath, compressed: true, result };
    } catch (err) {
      log.warn(`EXIF 剥离失败，使用原图: ${filePath}`, err);
      return { filePath, compressed: false };
    }
  }

  /**
   * 批量压缩图片
   */
  async function compressImageBatch(
    filePaths: string[],
    preset: CompressionPreset,
    fileSizes?: Map<string, number>,
  ): Promise<Map<string, string>> {
    const pathMap = new Map<string, string>();

    if (filePaths.length === 0) {
      return pathMap;
    }

    log.info(`开始批量压缩 ${filePaths.length} 张图片（预设: ${preset.name}, 质量: ${preset.quality}）`);

    const MAX_CONCURRENT = 3;
    const results: Array<{ original: string; compressed: string }> = [];

    for (let i = 0; i < filePaths.length; i += MAX_CONCURRENT) {
      const batch = filePaths.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.all(
        batch.map(async (fp) => {
          const size = fileSizes?.get(fp);
          const { filePath: outPath, compressed } = await compressImage(fp, preset, size);
          return { original: fp, compressed: compressed ? outPath : fp };
        }),
      );
      results.push(...batchResults);
    }

    for (const { original, compressed } of results) {
      if (original !== compressed) {
        pathMap.set(original, compressed);
      }
    }

    if (pathMap.size > 0) {
      log.info(`批量压缩完成：${pathMap.size}/${filePaths.length} 张图片已压缩`);
    }

    return pathMap;
  }

  /**
   * 清理压缩产生的临时文件
   */
  async function cleanupTempFiles() {
    if (pendingCleanup.length === 0) return;

    const toClean = [...pendingCleanup];
    pendingCleanup.length = 0;

    try {
      const cleaned = await invoke<number>('cleanup_compressed_files', {
        filePaths: toClean,
      });
      log.debug(`已清理 ${cleaned} 个压缩临时文件`);
    } catch (err) {
      log.warn('清理临时文件失败:', err);
    }
  }

  return {
    totalBytesSaved,
    compressImage,
    compressImageBatch,
    cleanupTempFiles,
  };
}
