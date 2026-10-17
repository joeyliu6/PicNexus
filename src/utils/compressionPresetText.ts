// 「压缩」菜单里每个方案下面那一行参数（HomeScreen.dc.html H13）：「WebP · 质量 80 · 长边 2560」
import type { CompressionOutputFormat, CompressionPreset } from '@/config/types';

/** 输出格式的叫法（首页「压缩」菜单与设置页压缩方案共用） */
export const FORMAT_LABELS: Record<CompressionOutputFormat, string> = {
  original: '原格式',
  webp: 'WebP',
  jpeg: 'JPEG',
};

export function describeCompressionPreset(preset: CompressionPreset): string {
  const parts = [FORMAT_LABELS[preset.outputFormat] ?? preset.outputFormat, `质量 ${preset.quality}`];
  if (preset.maxLongSide > 0) parts.push(`长边 ${preset.maxLongSide}`);
  if (preset.scalePercent > 0 && preset.scalePercent < 100) parts.push(`缩放 ${preset.scalePercent}%`);
  return parts.join(' · ');
}
