// 压缩方案（S02「图片压缩」）：一行说明怎么写、取值范围、新方案叫什么。纯函数，组件与测试共用。
import { DEFAULT_COMPRESSION_PRESET, type CompressionOutputFormat, type CompressionPreset, type ImageCompressionConfig } from '@/config/types';
import { formatFileSize } from '@/utils/formatters';

/** 最多几个方案（设计稿「最多 5 个」） */
export const MAX_PRESETS = 5;

export const FORMAT_LABELS: Record<CompressionOutputFormat, string> = {
  original: '原格式',
  webp: 'WebP',
  jpeg: 'JPEG',
};

/** 「小于 100 KB 不压缩」：整 MB 写成「2 MB」，其余按全应用的文件大小写法 */
export function formatSkipSize(kb: number): string {
  if (kb >= 1024 && kb % 1024 === 0) return `${kb / 1024} MB`;
  return formatFileSize(kb * 1024);
}

/** 方案下面那行说明，如「WebP · 质量 80 · 长边 2560 · 小于 100 KB 不压缩 · 去除 EXIF」 */
export function describePreset(preset: CompressionPreset): string {
  const parts = [FORMAT_LABELS[preset.outputFormat] ?? preset.outputFormat, `质量 ${preset.quality}`];
  if (preset.maxLongSide > 0) parts.push(`长边 ${preset.maxLongSide}`);
  else if (preset.scalePercent > 0 && preset.scalePercent < 100) parts.push(`缩放 ${preset.scalePercent}%`);
  else parts.push('不缩放');
  if (preset.skipIfSmallerKB > 0) parts.push(`小于 ${formatSkipSize(preset.skipIfSmallerKB)} 不压缩`);
  if (preset.stripExif) parts.push('去除 EXIF');
  return parts.join(' · ');
}

const clampInt = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)));

/** 把对话框里填的数收进合法范围（质量 1–100、缩放 1–100%、长边与跳过阈值不小于 0） */
export function normalizePreset(preset: CompressionPreset): CompressionPreset {
  return {
    ...preset,
    name: preset.name.trim() || DEFAULT_COMPRESSION_PRESET.name,
    quality: clampInt(preset.quality, 1, 100),
    scalePercent: clampInt(preset.scalePercent, 1, 100),
    maxLongSide: clampInt(preset.maxLongSide, 0, 100_000),
    skipIfSmallerKB: clampInt(preset.skipIfSmallerKB, 0, 10_485_760),
  };
}

/** 不重名的名字：撞名时加序号（「方案 3」已有就叫「方案 3 2」） */
export function uniquePresetName(base: string, presets: readonly CompressionPreset[], exceptId?: string): string {
  const taken = new Set(presets.filter((p) => p.id !== exceptId).map((p) => p.name));
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
  return name;
}

/** 新建一个方案（照默认方案的参数），并选中它；已满 5 个时原样返回 null */
export function addPreset(config: ImageCompressionConfig, id: string): ImageCompressionConfig | null {
  if (config.presets.length >= MAX_PRESETS) return null;
  const name = uniquePresetName(`方案 ${config.presets.length + 1}`, config.presets);
  return { ...config, presets: [...config.presets, { ...DEFAULT_COMPRESSION_PRESET, id, name }], activePresetId: id };
}

/** 删掉一个方案；只剩一个时不删。删的是当前方案时改选第一个 */
export function removePreset(config: ImageCompressionConfig, id: string): ImageCompressionConfig | null {
  if (config.presets.length <= 1 || !config.presets.some((p) => p.id === id)) return null;
  const presets = config.presets.filter((p) => p.id !== id);
  return { ...config, presets, activePresetId: config.activePresetId === id ? presets[0].id : config.activePresetId };
}
