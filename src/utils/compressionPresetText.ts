// 「压缩」菜单里每个方案下面那一行参数（HomeScreen.dc.html H13）：「WebP · 质量 80 · 长边 2560」
import type { CompressionOutputFormat, CompressionPreset } from '@/config/types';

/** 输出格式的叫法（首页「压缩」菜单与设置页压缩方案共用） */
export const FORMAT_LABELS: Record<CompressionOutputFormat, string> = {
  original: '原格式',
  webp: 'WebP',
  jpeg: 'JPEG',
};

/** 实际生效的尺寸限制：缩放小于 100% 时以缩放为准（同 useImageCompress），否则看长边上限；都没有为 null */
export function presetSizeText(preset: CompressionPreset): string | null {
  if (preset.scalePercent > 0 && preset.scalePercent < 100) return `缩放 ${preset.scalePercent}%`;
  if (preset.maxLongSide > 0) return `长边 ${preset.maxLongSide}`;
  return null;
}

export function describeCompressionPreset(preset: CompressionPreset): string {
  const size = presetSizeText(preset);
  return [FORMAT_LABELS[preset.outputFormat] ?? preset.outputFormat, `质量 ${preset.quality}`, ...(size ? [size] : [])].join(' · ');
}
