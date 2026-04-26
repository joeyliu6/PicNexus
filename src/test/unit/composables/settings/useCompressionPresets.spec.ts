import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

// Mock useConfirm
const confirmDeleteMock = vi.fn();
vi.mock('../../../../composables/useConfirm', () => ({
  useConfirm: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    confirmDelete: confirmDeleteMock,
  }),
}));

import {
  useCompressionPresets,
  FORMAT_LABEL,
  OUTPUT_FORMAT_OPTIONS,
} from '../../../../composables/settings/useCompressionPresets';
import {
  DEFAULT_COMPRESSION_PRESET,
  type ImageCompressionConfig,
  type CompressionPreset,
} from '../../../../config/compressionTypes';

function makeConfig(overrides: Partial<ImageCompressionConfig> = {}): ImageCompressionConfig {
  return {
    enabled: true,
    activePresetId: 'p1',
    presets: [
      { ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: '方案 A' },
    ],
    ...overrides,
  };
}

function harness(initial: ImageCompressionConfig) {
  const cfg = ref<ImageCompressionConfig>(initial);
  const editInput = ref<HTMLInputElement | null>(null);
  let updates: Array<Partial<ImageCompressionConfig>> = [];
  let api: ReturnType<typeof useCompressionPresets> | null = null;

  const Harness = defineComponent({
    setup() {
      api = useCompressionPresets({
        imageCompression: cfg,
        onUpdate: (patch) => {
          updates.push(patch);
          cfg.value = { ...cfg.value, ...patch };
        },
        editInputRef: editInput,
      });
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  return {
    wrapper,
    api: () => api!,
    cfg,
    updates: () => updates,
    clearUpdates: () => { updates = []; },
  };
}

describe('useCompressionPresets - 常量', () => {
  it('FORMAT_LABEL 映射', () => {
    expect(FORMAT_LABEL.webp).toBe('WebP');
    expect(FORMAT_LABEL.original).toBe('原格式');
    expect(FORMAT_LABEL.jpeg).toBe('JPEG');
  });

  it('OUTPUT_FORMAT_OPTIONS 三个选项', () => {
    expect(OUTPUT_FORMAT_OPTIONS).toHaveLength(3);
    expect(OUTPUT_FORMAT_OPTIONS.map(o => o.value)).toEqual(['original', 'webp', 'jpeg']);
  });
});

describe('useCompressionPresets - computed', () => {
  beforeEach(() => {
    confirmDeleteMock.mockReset();
  });

  it('activePreset 按 activePresetId 定位', () => {
    const h = harness(makeConfig({
      activePresetId: 'p2',
      presets: [
        { ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A' },
        { ...DEFAULT_COMPRESSION_PRESET, id: 'p2', name: 'B' },
      ],
    }));
    expect(h.api().activePreset.value.name).toBe('B');
  });

  it('activePresetId 不存在时回退到第一个', () => {
    const h = harness(makeConfig({
      activePresetId: 'ghost',
      presets: [{ ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A' }],
    }));
    expect(h.api().activePreset.value.name).toBe('A');
  });

  it('canAddPreset 在 5 个以下为 true', () => {
    const h = harness(makeConfig());
    expect(h.api().canAddPreset.value).toBe(true);

    const full = harness(makeConfig({
      presets: Array.from({ length: 5 }, (_, i) => ({
        ...DEFAULT_COMPRESSION_PRESET, id: `p${i}`, name: `P${i}`,
      })),
    }));
    expect(full.api().canAddPreset.value).toBe(false);
  });

  it('statusDesc - 未启用时', () => {
    const h = harness(makeConfig({ enabled: false }));
    expect(h.api().statusDesc.value).toBe('上传前自动压缩图片，减小体积');
  });

  it('statusDesc - 启用时拼接各段', () => {
    const h = harness(makeConfig({
      presets: [{
        ...DEFAULT_COMPRESSION_PRESET,
        id: 'p1', name: '标准', quality: 70, outputFormat: 'webp',
        scalePercent: 80, skipIfSmallerKB: 2048, stripExif: true,
      }],
    }));
    const desc = h.api().statusDesc.value;
    expect(desc).toContain('标准');
    expect(desc).toContain('WebP');
    expect(desc).toContain('质量 70');
    expect(desc).toContain('缩放 80%');
    expect(desc).toContain('跳过 < 2MB');
    expect(desc).toContain('去 EXIF');
  });

  it('statusDesc - skip < 1024 显示 KB', () => {
    const h = harness(makeConfig({
      presets: [{
        ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A',
        skipIfSmallerKB: 500, stripExif: false, scalePercent: 100,
      }],
    }));
    expect(h.api().statusDesc.value).toContain('跳过 < 500KB');
  });

  it('qualityLevel 四档分级', () => {
    const makeLevel = (q: number) => {
      const h = harness(makeConfig({ presets: [{ ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A', quality: q }]}));
      return h.api().qualityLevel.value.label;
    };
    expect(makeLevel(20)).toBe('低');
    expect(makeLevel(50)).toBe('中');
    expect(makeLevel(75)).toBe('良好');
    expect(makeLevel(95)).toBe('高');
  });

  it('scaleLevel 四档分级', () => {
    const makeLevel = (s: number) => {
      const h = harness(makeConfig({ presets: [{ ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A', scalePercent: s }]}));
      return h.api().scaleLevel.value.label;
    };
    expect(makeLevel(100)).toBe('原图');
    expect(makeLevel(80)).toBe('轻微');
    expect(makeLevel(60)).toBe('适中');
    expect(makeLevel(30)).toBe('激进');
  });

  it('skipDisplayValue 按单位换算', async () => {
    const h = harness(makeConfig({
      presets: [{ ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A', skipIfSmallerKB: 2048 }],
    }));
    // 2048 是 1024 倍数 → 初始化为 MB
    await nextTick();
    expect(h.api().skipUnit.value).toBe('MB');
    expect(h.api().skipDisplayValue.value).toBe(2);
  });
});

describe('useCompressionPresets - CRUD', () => {
  beforeEach(() => {
    confirmDeleteMock.mockReset();
  });

  it('selectPreset 发出 activePresetId 更新', () => {
    const h = harness(makeConfig());
    h.clearUpdates();
    h.api().selectPreset('p2');
    expect(h.updates()).toContainEqual({ activePresetId: 'p2' });
  });

  it('addPreset - 新增一个预设', () => {
    // mock crypto.randomUUID
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('new-id' as any);
    const h = harness(makeConfig());
    h.api().addPreset();
    const patch = h.updates().find(u => u.presets && u.activePresetId === 'new-id');
    expect(patch).toBeTruthy();
    expect(patch!.presets).toHaveLength(2);
  });

  it('addPreset - 达到上限不新增', () => {
    const h = harness(makeConfig({
      presets: Array.from({ length: 5 }, (_, i) => ({
        ...DEFAULT_COMPRESSION_PRESET, id: `p${i}`, name: `P${i}`,
      })),
    }));
    h.clearUpdates();
    h.api().addPreset();
    expect(h.updates()).toEqual([]);
  });

  it('addPreset - 处理重名自动加序号', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('new-id' as any);
    const h = harness(makeConfig({
      presets: [
        { ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: '方案 2' },
      ],
    }));
    h.api().addPreset();
    const patch = h.updates().find(u => u.presets && u.activePresetId === 'new-id');
    const newPreset = patch!.presets!.find((p: CompressionPreset) => p.id === 'new-id');
    // 首选 "方案 2"，被占用 → "方案 2 2"
    expect(newPreset!.name).toMatch(/方案 2/);
  });

  it('updateActivePreset 只改变激活的预设', () => {
    const h = harness(makeConfig({
      activePresetId: 'p1',
      presets: [
        { ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A', quality: 80 },
        { ...DEFAULT_COMPRESSION_PRESET, id: 'p2', name: 'B', quality: 60 },
      ],
    }));
    h.clearUpdates();
    h.api().updateActivePreset({ quality: 50 });
    const patch = h.updates()[0];
    expect(patch.presets!.find((p: CompressionPreset) => p.id === 'p1')!.quality).toBe(50);
    expect(patch.presets!.find((p: CompressionPreset) => p.id === 'p2')!.quality).toBe(60);
  });

  it('handleDeletePreset - 仅剩一个预设时不删除', () => {
    const h = harness(makeConfig());
    h.clearUpdates();
    h.api().handleDeletePreset('p1');
    expect(confirmDeleteMock).not.toHaveBeenCalled();
    expect(h.updates()).toEqual([]);
  });

  it('handleDeletePreset - 找不到 preset 提前返回', () => {
    const h = harness(makeConfig({
      presets: [
        { ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A' },
        { ...DEFAULT_COMPRESSION_PRESET, id: 'p2', name: 'B' },
      ],
    }));
    h.clearUpdates();
    h.api().handleDeletePreset('ghost');
    expect(confirmDeleteMock).not.toHaveBeenCalled();
  });

  it('handleDeletePreset - confirmDelete 回调执行后更新配置', () => {
    confirmDeleteMock.mockImplementation((_msg: string, cb: () => void) => cb());
    const h = harness(makeConfig({
      activePresetId: 'p1',
      presets: [
        { ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A' },
        { ...DEFAULT_COMPRESSION_PRESET, id: 'p2', name: 'B' },
      ],
    }));
    h.clearUpdates();
    h.api().handleDeletePreset('p1');
    const patch = h.updates()[0];
    expect(patch.presets).toHaveLength(1);
    expect(patch.activePresetId).toBe('p2');
  });

  it('handleDeletePreset - 删除的不是激活预设，保持 activeId', () => {
    confirmDeleteMock.mockImplementation((_msg: string, cb: () => void) => cb());
    const h = harness(makeConfig({
      activePresetId: 'p1',
      presets: [
        { ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A' },
        { ...DEFAULT_COMPRESSION_PRESET, id: 'p2', name: 'B' },
      ],
    }));
    h.clearUpdates();
    h.api().handleDeletePreset('p2');
    expect(h.updates()[0].activePresetId).toBe('p1');
  });
});

describe('useCompressionPresets - 编辑', () => {
  it('startEditing / commitEdit 完整流程', async () => {
    const h = harness(makeConfig());
    h.api().startEditing('p1');
    expect(h.api().editingPresetId.value).toBe('p1');
    expect(h.api().editDraft.value).toBe('方案 A');
    h.api().editDraft.value = '新名字';
    h.clearUpdates();
    h.api().commitEdit();
    expect(h.api().editingPresetId.value).toBeNull();
    expect(h.updates()[0].presets![0].name).toBe('新名字');
  });

  it('startEditing - 找不到 preset 提前返回', () => {
    const h = harness(makeConfig());
    h.api().startEditing('ghost');
    expect(h.api().editingPresetId.value).toBeNull();
  });

  it('commitEdit - 空字符串不更新', () => {
    const h = harness(makeConfig());
    h.api().startEditing('p1');
    h.api().editDraft.value = '   ';
    h.clearUpdates();
    h.api().commitEdit();
    expect(h.updates()).toEqual([]);
    expect(h.api().editingPresetId.value).toBeNull();
  });

  it('cancelEdit 清空 editingPresetId', () => {
    const h = harness(makeConfig());
    h.api().startEditing('p1');
    h.api().cancelEdit();
    expect(h.api().editingPresetId.value).toBeNull();
  });
});

describe('useCompressionPresets - 防抖参数', () => {
  it('handleQualityInput - null 回退到 80', () => {
    vi.useFakeTimers();
    const h = harness(makeConfig());
    h.clearUpdates();
    h.api().handleQualityInput(null);
    vi.advanceTimersByTime(301);
    expect(h.updates()).toEqual([]);
    vi.useRealTimers();
  });

  it('handleQualityInput - 值被 clamp 到 1-100', () => {
    vi.useFakeTimers();
    const h = harness(makeConfig());
    h.clearUpdates();
    h.api().handleQualityInput(150);
    vi.advanceTimersByTime(301);
    expect(h.updates().some(u => u.presets?.[0].quality === 100)).toBe(true);
    h.clearUpdates();
    h.api().handleQualityInput(-5);
    vi.advanceTimersByTime(301);
    expect(h.updates().some(u => u.presets?.[0].quality === 1)).toBe(true);
    vi.useRealTimers();
  });

  it('handleScaleInput - null 回退到 100', () => {
    vi.useFakeTimers();
    const h = harness(makeConfig());
    h.clearUpdates();
    h.api().handleScaleInput(null);
    vi.advanceTimersByTime(301);
    expect(h.updates()).toEqual([]);
    vi.useRealTimers();
  });

  it('commitQualityInput 立即提交并取消防抖', () => {
    vi.useFakeTimers();
    const h = harness(makeConfig());
    h.api().handleQualityInput(50);
    h.clearUpdates();
    h.api().commitQualityInput();
    expect(h.updates().length).toBeGreaterThan(0);
    vi.advanceTimersByTime(500);
    // 防抖被取消，不应有新更新
    vi.useRealTimers();
  });

  it('commitScaleInput 立即提交', () => {
    const h = harness(makeConfig({
      presets: [{ ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A', scalePercent: 85 }],
    }));
    h.clearUpdates();
    h.api().commitScaleInput();
    expect(h.updates()[0].presets![0].scalePercent).toBe(85);
  });
});

describe('useCompressionPresets - 跳过阈值', () => {
  it('handleSkipValueChange - KB 单位直接存', () => {
    const h = harness(makeConfig({
      presets: [{ ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A', skipIfSmallerKB: 500 }],
    }));
    h.clearUpdates();
    h.api().handleSkipValueChange(300);
    expect(h.updates()[0].presets![0].skipIfSmallerKB).toBe(300);
  });

  it('handleSkipValueChange - MB 单位换算为 KB', async () => {
    const h = harness(makeConfig({
      presets: [{ ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A', skipIfSmallerKB: 2048 }],
    }));
    await nextTick();
    // activePreset 切换导致 skipUnit=MB
    expect(h.api().skipUnit.value).toBe('MB');
    h.clearUpdates();
    h.api().handleSkipValueChange(3);
    expect(h.updates()[0].presets![0].skipIfSmallerKB).toBe(3072);
  });

  it('handleSkipValueChange - null 当作 0', () => {
    const h = harness(makeConfig());
    h.clearUpdates();
    h.api().handleSkipValueChange(null);
    expect(h.updates()[0].presets![0].skipIfSmallerKB).toBe(0);
  });

  it('handleSkipUnitChange 切换单位', () => {
    const h = harness(makeConfig());
    h.api().handleSkipUnitChange('MB');
    expect(h.api().skipUnit.value).toBe('MB');
  });

  it('toggleSkipUnit 翻转当前单位', () => {
    const h = harness(makeConfig({
      presets: [{ ...DEFAULT_COMPRESSION_PRESET, id: 'p1', name: 'A', skipIfSmallerKB: 500 }],
    }));
    expect(h.api().skipUnit.value).toBe('KB');
    h.api().toggleSkipUnit();
    expect(h.api().skipUnit.value).toBe('MB');
    h.api().toggleSkipUnit();
    expect(h.api().skipUnit.value).toBe('KB');
  });
});
