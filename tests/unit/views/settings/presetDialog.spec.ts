// 编辑压缩方案：数字离开输入框才保存且收进范围；「删除方案」不弹确认，撤销时按原位置放回
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { DEFAULT_COMPRESSION_PRESET, type CompressionPreset, type ImageCompressionConfig } from '@/config/types';

const undo = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('@/composables/useUndoToast', () => ({ useUndoToast: () => undo }));
// 对话框直接写设置模块里的配置（不经父组件），这里用一份内存配置代替
const store = vi.hoisted(() => ({ config: null as unknown as ImageCompressionConfig }));
vi.mock('@/views/settings/useSettingsConfig', () => ({
  useSettingsConfig: () => ({
    patchCompression: async (mutate: (c: ImageCompressionConfig) => ImageCompressionConfig | null) => {
      store.config = mutate(store.config) ?? store.config;
      return true;
    },
  }),
}));

import PresetDialog from '@/views/settings/PresetDialog.vue';

const a: CompressionPreset = { ...DEFAULT_COMPRESSION_PRESET, id: 'a', name: 'Web', quality: 80 };
const b: CompressionPreset = { ...DEFAULT_COMPRESSION_PRESET, id: 'b', name: '高清', quality: 92 };

function setup(preset: CompressionPreset) {
  store.config = { enabled: true, presets: [a, b], activePresetId: 'a' };
  const wrapper = mount(PresetDialog, {
    props: { preset, presets: store.config.presets },
    attachTo: document.body,
  });
  return { wrapper, get config() { return store.config; } };
}

const field = (label: string) => [...document.body.querySelectorAll<HTMLLabelElement>('.preset__field')]
  .find((el) => el.querySelector('.preset__label')?.textContent === label)!.querySelector('input')!;

afterEach(() => { document.body.innerHTML = ''; });

describe('PresetDialog', () => {
  it('saves a typed quality on blur, clamped to 1–100', async () => {
    const s = setup(a);
    await nextTick();
    const quality = field('质量');
    quality.value = '180';
    quality.dispatchEvent(new Event('input'));
    expect(s.config.presets[0].quality).toBe(80);
    quality.dispatchEvent(new FocusEvent('blur'));
    await nextTick();
    expect(s.config.presets[0].quality).toBe(100);
    expect(quality.value).toBe('100');
  });

  it('deletes without asking and puts it back in place on 撤销', async () => {
    undo.show.mockResolvedValueOnce(false);
    const s = setup(a);
    await nextTick();
    [...document.body.querySelectorAll('button')].find((el) => el.textContent === '删除方案')!.click();
    expect(s.config.presets.map((p) => p.id)).toEqual(['b']);
    expect(undo.show).toHaveBeenCalledWith('已删除方案「Web」');
    await vi.waitFor(() => expect(s.config.presets.map((p) => p.id)).toEqual(['a', 'b']));
    expect(s.config.activePresetId).toBe('a');
    expect(s.wrapper.emitted('close')).toBeTruthy();
  });

  // 删掉方案后切到别的设置分组：对话框和「上传与链接」都卸载了，点「撤销」仍要放回去，不能只弹「已撤销」
  it('still puts the preset back when 撤销 comes after the dialog is gone', async () => {
    let settle!: (kept: boolean) => void;
    undo.show.mockReturnValueOnce(new Promise<boolean>((resolve) => { settle = resolve; }));
    const s = setup(a);
    await nextTick();
    [...document.body.querySelectorAll('button')].find((el) => el.textContent === '删除方案')!.click();
    expect(s.config.presets.map((p) => p.id)).toEqual(['b']);

    s.wrapper.unmount();
    settle(false);
    await vi.waitFor(() => expect(s.config.presets.map((p) => p.id)).toEqual(['a', 'b']));
  });
});
