// 压缩预设管理 composable
// 负责预设增删改查、编辑状态、参数防抖处理

import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type {
  ImageCompressionConfig,
  CompressionPreset,
  CompressionOutputFormat,
} from '../../config/types';
import { DEFAULT_COMPRESSION_PRESET } from '../../config/types';
import { debounce } from '../../utils/debounce';
import { useConfirm } from '../useConfirm';

/** 最大预设数量 */
const MAX_PRESETS = 5;

/** 格式标签映射 */
const FORMAT_LABEL: Record<string, string> = {
  original: '原格式',
  webp: 'WebP',
  jpeg: 'JPEG',
};

/** 输出格式选项 */
export const OUTPUT_FORMAT_OPTIONS: Array<{
  value: CompressionOutputFormat;
  label: string;
  tooltip: string;
}> = [
  { value: 'original', label: '原格式', tooltip: '保持原始格式不转换，兼容性最好' },
  { value: 'webp', label: 'WebP', tooltip: '体积更小画质更高，但部分公共图床不支持' },
  { value: 'jpeg', label: 'JPEG', tooltip: '通用格式，所有图床都支持，不保留透明通道' },
];

interface UseCompressionPresetsOptions {
  /** 压缩配置（响应式引用） */
  imageCompression: Ref<ImageCompressionConfig>;
  /** 配置变更回调 */
  onUpdate: (patch: Partial<ImageCompressionConfig>) => void;
  /** 编辑输入框的 template ref（由组件声明并传入） */
  editInputRef: Ref<HTMLInputElement | HTMLInputElement[] | null>;
}

export function useCompressionPresets({ imageCompression, onUpdate, editInputRef }: UseCompressionPresetsOptions) {
  const { confirmDelete } = useConfirm();

  // ── 编辑状态 ──
  const editingPresetId = ref<string | null>(null);
  const editDraft = ref('');
  const skipUnit = ref<'KB' | 'MB'>('KB');

  // ── 计算属性 ──

  /** 当前激活的预设 */
  const activePreset = computed<CompressionPreset>(() => {
    const cfg = imageCompression.value;
    return cfg.presets?.find((p) => p.id === cfg.activePresetId)
      ?? cfg.presets?.[0]
      ?? { ...DEFAULT_COMPRESSION_PRESET };
  });

  /** 是否可以新增预设 */
  const canAddPreset = computed(() => (imageCompression.value.presets?.length ?? 0) < MAX_PRESETS);

  /** 状态描述文本（用于折叠时显示概要） */
  const statusDesc = computed(() => {
    if (!imageCompression.value.enabled) return '上传前自动压缩图片，减小体积';
    const p = activePreset.value;
    const parts = [p.name];
    parts.push(FORMAT_LABEL[p.outputFormat] || p.outputFormat);
    parts.push(`质量 ${p.quality}`);
    if (p.scalePercent && p.scalePercent < 100) parts.push(`缩放 ${p.scalePercent}%`);
    if (p.skipIfSmallerKB > 0) {
      const kb = p.skipIfSmallerKB;
      parts.push(kb >= 1024 ? `跳过 < ${Math.round(kb / 1024)}MB` : `跳过 < ${kb}KB`);
    }
    if (p.stripExif) parts.push('去 EXIF');
    return parts.join(' · ');
  });

  /** 质量等级标签 */
  const qualityLevel = computed(() => {
    const q = activePreset.value.quality;
    if (q <= 30) return { label: '低', cls: 'quality-low' };
    if (q <= 60) return { label: '中', cls: 'quality-medium' };
    if (q <= 80) return { label: '良好', cls: 'quality-good' };
    return { label: '高', cls: 'quality-high' };
  });

  /** 缩放等级标签 */
  const scaleLevel = computed(() => {
    const s = activePreset.value.scalePercent ?? 100;
    if (s >= 100) return { label: '原图', cls: 'scale-original' };
    if (s >= 75) return { label: '轻微', cls: 'scale-light' };
    if (s >= 50) return { label: '适中', cls: 'scale-moderate' };
    return { label: '激进', cls: 'scale-heavy' };
  });

  /** 跳过阈值的显示值（根据当前单位换算） */
  const skipDisplayValue = computed(() => {
    const kb = activePreset.value.skipIfSmallerKB;
    if (skipUnit.value === 'MB') {
      return Math.round((kb / 1024) * 10) / 10;
    }
    return kb;
  });

  // ── 预设 CRUD ──

  /** 更新当前激活预设的部分字段 */
  function updateActivePreset(patch: Partial<CompressionPreset>) {
    const presets = imageCompression.value.presets.map((p) =>
      p.id === imageCompression.value.activePresetId ? { ...p, ...patch } : p,
    );
    onUpdate({ presets });
  }

  /** 选择预设 */
  function selectPreset(presetId: string) {
    onUpdate({ activePresetId: presetId });
  }

  /** 生成不重名的预设名称 */
  function createPresetName(base: string) {
    let candidate = base;
    let index = 2;
    const existing = new Set(imageCompression.value.presets.map((p) => p.name));
    while (existing.has(candidate)) {
      candidate = `${base} ${index}`;
      index += 1;
    }
    return candidate;
  }

  /** 新增预设 */
  function addPreset() {
    if (!canAddPreset.value) return;
    const id = crypto.randomUUID();
    const name = createPresetName(`方案 ${imageCompression.value.presets.length + 1}`);
    const newPreset: CompressionPreset = { ...DEFAULT_COMPRESSION_PRESET, id, name };
    const presets = [...imageCompression.value.presets, newPreset];
    onUpdate({ presets, activePresetId: id });
  }

  /** 删除预设（带确认对话框） */
  function handleDeletePreset(presetId: string) {
    if (imageCompression.value.presets.length <= 1) return;
    const preset = imageCompression.value.presets.find((p) => p.id === presetId);
    if (!preset) return;

    confirmDelete(`确定要删除方案「${preset.name}」吗？`, () => {
      const presets = imageCompression.value.presets.filter((p) => p.id !== presetId);
      const activeId = imageCompression.value.activePresetId === presetId
        ? presets[0].id
        : imageCompression.value.activePresetId;
      onUpdate({ presets, activePresetId: activeId });
    });
  }

  // ── 预设重命名 ──

  /** 开始编辑预设名称 */
  function startEditing(presetId: string) {
    const preset = imageCompression.value.presets.find((p) => p.id === presetId);
    if (!preset) return;
    editingPresetId.value = presetId;
    editDraft.value = preset.name;
    nextTick(() => {
      const el = Array.isArray(editInputRef.value) ? editInputRef.value[0] : editInputRef.value;
      el?.focus();
      el?.select();
    });
  }

  /** 提交编辑 */
  function commitEdit() {
    const name = editDraft.value.trim();
    if (name && editingPresetId.value) {
      const presets = imageCompression.value.presets.map((p) =>
        p.id === editingPresetId.value ? { ...p, name } : p,
      );
      onUpdate({ presets });
    }
    editingPresetId.value = null;
  }

  /** 取消编辑 */
  function cancelEdit() {
    editingPresetId.value = null;
  }

  // ── 防抖参数更新 ──

  const debouncedQualityUpdate = debounce((q: number) => {
    updateActivePreset({ quality: q });
  }, 300);

  const debouncedScaleUpdate = debounce((s: number) => {
    updateActivePreset({ scalePercent: s });
  }, 300);

  /** 质量输入处理（防抖） */
  function handleQualityInput(v: number | null) {
    const q = v === null ? 80 : Math.round(Math.min(100, Math.max(1, v)));
    debouncedQualityUpdate(q);
  }

  /** 缩放输入处理（防抖） */
  function handleScaleInput(v: number | null) {
    const s = v === null ? 100 : Math.round(Math.min(100, Math.max(1, v)));
    debouncedScaleUpdate(s);
  }

  /** 质量输入失焦时立即提交 */
  function commitQualityInput() {
    debouncedQualityUpdate.cancel();
    const q = Math.round(Math.min(100, Math.max(1, activePreset.value.quality)));
    updateActivePreset({ quality: q });
  }

  /** 缩放输入失焦时立即提交 */
  function commitScaleInput() {
    debouncedScaleUpdate.cancel();
    const s = Math.round(Math.min(100, Math.max(1, activePreset.value.scalePercent ?? 100)));
    updateActivePreset({ scalePercent: s });
  }

  // ── 跳过阈值 ──

  /** 切换预设时同步单位显示 */
  watch(
    () => activePreset.value.id,
    () => {
      const kb = activePreset.value.skipIfSmallerKB;
      skipUnit.value = (kb >= 1024 && kb % 1024 === 0) ? 'MB' : 'KB';
    },
    { immediate: true },
  );

  /** 跳过阈值变更 */
  function handleSkipValueChange(v: number | null) {
    const raw = v ?? 0;
    const kb = skipUnit.value === 'MB' ? Math.round(raw * 1024) : raw;
    updateActivePreset({ skipIfSmallerKB: kb });
  }

  /** 切换单位 */
  function handleSkipUnitChange(newUnit: 'KB' | 'MB') {
    skipUnit.value = newUnit;
  }

  /** 快捷切换单位（KB ↔ MB） */
  function toggleSkipUnit() {
    handleSkipUnitChange(skipUnit.value === 'KB' ? 'MB' : 'KB');
  }

  // ── 生命周期清理 ──
  onBeforeUnmount(() => {
    debouncedQualityUpdate.cancel();
    debouncedScaleUpdate.cancel();
  });

  return {
    // 编辑状态
    editingPresetId,
    editDraft,
    skipUnit,

    // 计算属性
    activePreset,
    canAddPreset,
    statusDesc,
    qualityLevel,
    scaleLevel,
    skipDisplayValue,

    // 预设 CRUD
    selectPreset,
    addPreset,
    handleDeletePreset,
    updateActivePreset,

    // 重命名
    startEditing,
    commitEdit,
    cancelEdit,

    // 参数更新
    handleQualityInput,
    handleScaleInput,
    commitQualityInput,
    commitScaleInput,

    // 跳过阈值
    handleSkipValueChange,
    handleSkipUnitChange,
    toggleSkipUnit,
  };
}
