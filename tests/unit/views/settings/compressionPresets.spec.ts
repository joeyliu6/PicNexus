import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPRESSION_PRESET, type CompressionPreset, type ImageCompressionConfig } from '@/config/types';
import { addPreset, describePreset, MAX_PRESETS, normalizePreset, removePreset, uniquePresetName } from '@/views/settings/compressionPresets';

const preset = (patch: Partial<CompressionPreset>): CompressionPreset => ({ ...DEFAULT_COMPRESSION_PRESET, ...patch });
const config = (presets: CompressionPreset[], activePresetId = presets[0].id): ImageCompressionConfig => ({ enabled: true, presets, activePresetId });

describe('compressionPresets', () => {
  it('describes a preset the way S02 writes it', () => {
    expect(describePreset(preset({ outputFormat: 'webp', quality: 80, maxLongSide: 2560, skipIfSmallerKB: 100, stripExif: true })))
      .toBe('WebP · 质量 80 · 长边 2560 · 小于 100 KB 不压缩 · 去除 EXIF');
    expect(describePreset(preset({ outputFormat: 'jpeg', quality: 92, maxLongSide: 0, scalePercent: 100, skipIfSmallerKB: 0, stripExif: false })))
      .toBe('JPEG · 质量 92 · 不缩放');
    expect(describePreset(preset({ outputFormat: 'original', quality: 80, scalePercent: 50, skipIfSmallerKB: 2048 })))
      .toBe('原格式 · 质量 80 · 缩放 50% · 小于 2 MB 不压缩 · 去除 EXIF');
    // 长边上限与缩放都设了：压缩时缩放为准，说明只写缩放
    expect(describePreset(preset({ outputFormat: 'webp', quality: 80, maxLongSide: 2560, scalePercent: 50, skipIfSmallerKB: 0, stripExif: false })))
      .toBe('WebP · 质量 80 · 缩放 50%');
  });

  it('keeps typed numbers in range and never leaves the name empty', () => {
    expect(normalizePreset(preset({ name: '  ', quality: 0, scalePercent: 140, maxLongSide: -5, skipIfSmallerKB: 12.6 })))
      .toMatchObject({ name: DEFAULT_COMPRESSION_PRESET.name, quality: 1, scalePercent: 100, maxLongSide: 0, skipIfSmallerKB: 13 });
  });

  it('adds up to five presets with unique names, selecting the new one', () => {
    let c = config([preset({ id: 'a', name: '方案 2' })]);
    c = addPreset(c, 'b')!;
    expect(c.presets.map((p) => p.name)).toEqual(['方案 2', '方案 2 2']);
    expect(c.activePresetId).toBe('b');
    for (let i = c.presets.length; i < MAX_PRESETS; i++) c = addPreset(c, `x${i}`)!;
    expect(addPreset(c, 'overflow')).toBeNull();
  });

  it('removes a preset but never the last one, moving the selection off it', () => {
    const c = config([preset({ id: 'a' }), preset({ id: 'b' })], 'b');
    expect(removePreset(c, 'b')).toMatchObject({ activePresetId: 'a', presets: [{ id: 'a' }] });
    expect(removePreset(config([preset({ id: 'a' })]), 'a')).toBeNull();
  });

  it('renaming to a taken name gets a number, except against itself', () => {
    const presets = [preset({ id: 'a', name: 'Web' }), preset({ id: 'b', name: '高清' })];
    expect(uniquePresetName('Web', presets, 'b')).toBe('Web 2');
    expect(uniquePresetName('Web', presets, 'a')).toBe('Web');
  });
});
