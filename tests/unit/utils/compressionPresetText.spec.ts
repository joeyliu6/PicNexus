import { describe, expect, it } from 'vitest';
import { describeCompressionPreset } from '@/utils/compressionPresetText';
import { DEFAULT_COMPRESSION_PRESET } from '@/config/compressionTypes';

describe('describeCompressionPreset', () => {
  it('writes format, quality and the long-side limit', () => {
    expect(describeCompressionPreset({ ...DEFAULT_COMPRESSION_PRESET, outputFormat: 'webp', quality: 80, maxLongSide: 2560 }))
      .toBe('WebP · 质量 80 · 长边 2560');
  });

  it('adds the scale only when the image is shrunk', () => {
    expect(describeCompressionPreset({ ...DEFAULT_COMPRESSION_PRESET, outputFormat: 'jpeg', quality: 92 })).toBe('JPEG · 质量 92');
    expect(describeCompressionPreset({ ...DEFAULT_COMPRESSION_PRESET, scalePercent: 50 })).toBe('原格式 · 质量 80 · 缩放 50%');
    // 两项都设了：压缩时缩放为准（useImageCompress），只写缩放
    expect(describeCompressionPreset({ ...DEFAULT_COMPRESSION_PRESET, maxLongSide: 2560, scalePercent: 50 })).toBe('原格式 · 质量 80 · 缩放 50%');
  });
});
