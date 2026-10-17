// 快捷键录制（S08 / S09）：录制期间全局快捷键暂停；冲突不保存；Esc 不改；Backspace 清除
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';

const m = vi.hoisted(() => ({
  config: { value: null as unknown as UserConfig },
  patch: vi.fn(),
  suspend: vi.fn(),
  resume: vi.fn(),
  probe: vi.fn(),
}));

vi.mock('@/views/settings/useSettingsConfig', () => ({ useSettingsConfig: () => ({ config: m.config, patch: m.patch }) }));
vi.mock('@/composables/useGlobalShortcut', () => ({
  suspendGlobalShortcuts: m.suspend,
  resumeGlobalShortcuts: m.resume,
  probeShortcut: m.probe,
}));
vi.mock('@/utils/platform', () => ({ uiPlatform: () => 'windows' }));

import { useShortcutRecorder } from '@/views/settings/useShortcutRecorder';

let recorder!: ReturnType<typeof useShortcutRecorder>;
const Host = defineComponent({ setup() { recorder = useShortcutRecorder(); return () => h('div'); } });

function key(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  m.config.value = structuredClone(DEFAULT_CONFIG);
  m.patch.mockReset().mockImplementation(async (_row: string, mutate: (c: UserConfig) => void) => { mutate(m.config.value); return true; });
  m.suspend.mockReset().mockResolvedValue(undefined);
  m.resume.mockReset().mockResolvedValue(undefined);
  m.probe.mockReset().mockResolvedValue(true);
  mount(Host);
});
afterEach(async () => { await recorder.stop(); });

describe('useShortcutRecorder', () => {
  it('pauses global shortcuts while recording and saves a free combination', async () => {
    await recorder.start('uploadClipboard');
    expect(m.suspend).toHaveBeenCalled();
    key({ key: 'U', code: 'KeyU', ctrlKey: true, altKey: true });
    await flush();
    expect(m.probe).toHaveBeenCalledWith('CommandOrControl+Alt+U');
    expect(m.config.value.globalShortcut?.uploadClipboard).toBe('CommandOrControl+Alt+U');
    expect(m.patch).toHaveBeenCalledWith('shortcutClipboard', expect.any(Function));
    expect(recorder.recording.value).toBeNull();
    expect(m.resume).toHaveBeenCalled();
  });

  it('does not save a combination the other global shortcut already uses (S09)', async () => {
    await recorder.start('uploadClipboard');
    key({ key: 'O', code: 'KeyO', ctrlKey: true, shiftKey: true });
    await flush();
    expect(m.patch).not.toHaveBeenCalled();
    expect(recorder.conflict.value).toEqual({ id: 'uploadClipboard', accelerator: 'CommandOrControl+Shift+O', message: '该组合键已用于「选择文件上传」，请更换' });
    expect(m.config.value.globalShortcut?.uploadClipboard).toBe('CommandOrControl+Shift+C');
  });

  it('says another program holds it when the system refuses to register', async () => {
    m.probe.mockResolvedValueOnce(false);
    await recorder.start('uploadFromFile');
    key({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true });
    await flush();
    expect(recorder.conflict.value?.message).toBe('该组合键已被其他程序占用，请更换');
    expect(m.patch).not.toHaveBeenCalled();
  });

  it('Esc leaves the value alone; Backspace clears it', async () => {
    await recorder.start('uploadClipboard');
    key({ key: 'Escape', code: 'Escape' });
    await flush();
    expect(recorder.recording.value).toBeNull();
    expect(m.patch).not.toHaveBeenCalled();

    await recorder.start('uploadClipboard');
    key({ key: 'Backspace', code: 'Backspace' });
    await flush();
    expect(m.config.value.globalShortcut?.uploadClipboard).toBe('');
  });

  it('keeps recording and explains why when a key cannot be used', async () => {
    await recorder.start('uploadClipboard');
    key({ key: 'C', code: 'KeyC', shiftKey: true });
    await flush();
    expect(recorder.recording.value).toBe('uploadClipboard');
    expect(recorder.hint.value).toBe('请同时按住 Ctrl 或 Alt');
  });
});
