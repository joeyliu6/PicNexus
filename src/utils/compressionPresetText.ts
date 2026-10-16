// 「压缩」菜单里每个方案下面那一行参数（HomeScreen.dc.html H13）：「WebP · 质量 80 · 长边 2560」
import type { CompressionPreset } from '@/config/types';
import { FORMAT_LABEL } from '@/composables/settings/useCompressionPresets';

export function describeCompressionPreset(preset: CompressionPreset): string {
  const parts = [FORMAT_LABEL[preset.outputFormat] ?? preset.outputFormat, `质量 ${preset.quality}`];
  if (preset.maxLongSide > 0) parts.push(`长边 ${preset.maxLongSide}`);
  if (preset.scalePercent > 0 && preset.scalePercent < 100) parts.push(`缩放 ${preset.scalePercent}%`);
  return parts.join(' · ');
}
