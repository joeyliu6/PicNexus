import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_COMPRESSION_PRESET, type CompressionPreset, type ImageCompressionConfig } from '@/config/types';
import { getImageMetadata } from '@/composables/image/useImageMetadata';
import { createLogger } from '@/utils/logger';

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

/** 待清理的临时文件路径（批量上传会话结束时由 cleanupTempFiles 统一删除） */
const pendingCleanup: string[] = [];

/** 当前激活的压缩预设：找不到时退回第一个，再退回内置默认 */
export function resolveActivePreset(config: ImageCompressionConfig): CompressionPreset {
  return config.presets?.find(p => p.id === config.activePresetId)
    ?? config.presets?.[0]
    ?? { ...DEFAULT_COMPRESSION_PRESET };
}

async function deleteCompressedFiles(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return;
  try {
    const cleaned = await invoke<number>('cleanup_compressed_files', { filePaths });
    log.debug(`已清理 ${cleaned} 个压缩临时文件`);
  } catch (err) {
    log.warn('清理临时文件失败:', err);
  }
}

export function useImageCompress() {
  /**
   * 压缩单张图片
   * @param filePath 原图路径
   * @param preset 当前激活的压缩预设
   * @param fileSize 文件大小（字节），用于跳过小文件判断
   * @param outputs 产物登记处：默认进会话级 pendingCleanup；单张上传传自己的数组自行清理
   */
  async function compressImage(
    filePath: string,
    preset: CompressionPreset,
    fileSize?: number,
    outputs: string[] = pendingCleanup,
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
          return await stripExifOnly(filePath, outputs);
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
        outputs.push(result.outputPath);
        return { filePath, compressed: false };
      }

      const saved = result.originalSize - result.compressedSize;
      totalBytesSaved.value += saved;
      outputs.push(result.outputPath);

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
    outputs: string[],
  ): Promise<{ filePath: string; compressed: boolean; result?: CompressResult }> {
    try {
      const result = await invoke<CompressResult>('strip_exif_only', { filePath });
      outputs.push(result.outputPath);
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
    await deleteCompressedFiles(toClean);
  }

  /**
   * 单张上传（如重试）前按当前压缩设置准备文件。
   *
   * 产物不进会话级 pendingCleanup：重试可能发生在另一次批量上传进行中，
   * 那次会话结束时的 cleanupTempFiles 会把重试正在上传的临时文件删掉。
   * 调用方上传结束后必须调用返回的 cleanup。
   */
  async function prepareSingleUpload(
    filePath: string,
    compression: ImageCompressionConfig | undefined,
  ): Promise<{ uploadPath: string; cleanup: () => Promise<void> }> {
    if (!compression?.enabled) {
      return { uploadPath: filePath, cleanup: async () => {} };
    }
    const outputs: string[] = [];
    // getImageMetadata 读失败时不抛错而是返回 file_size: 0；0 按「不知道大小」处理，
    // 与批量上传一致（否则「小于 N KB 跳过」会把读不到大小的图当小图跳过压缩）
    const fileSize = (await getImageMetadata(filePath)).file_size || undefined;
    const { filePath: uploadPath } = await compressImage(filePath, resolveActivePreset(compression), fileSize, outputs);
    return { uploadPath, cleanup: () => deleteCompressedFiles(outputs) };
  }

  return {
    totalBytesSaved,
    compressImage,
    compressImageBatch,
    cleanupTempFiles,
    prepareSingleUpload,
  };
}
