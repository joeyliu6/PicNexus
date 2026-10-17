// 全局快捷键录制（S08 / S09）的状态机：显示 → 录制中 → 检查 → 保存 / 冲突。
// 录制期间先注销全局快捷键（否则按到原组合键时系统直接触发上传），并在捕获阶段拦住应用内快捷键；
// 结束时按配置重新注册。冲突不保存，配置保持原值；冲突提示留到再点一次按钮或离开这一页。
import { onBeforeUnmount, onDeactivated, ref } from 'vue';
import { DEFAULT_CONFIG, type GlobalShortcutConfig } from '@/config/types';
import { probeShortcut, resumeGlobalShortcuts, suspendGlobalShortcuts } from '@/composables/useGlobalShortcut';
import { createLogger } from '@/utils/logger';
import { uiPlatform } from '@/utils/platform';
import { findConflict, OS_CONFLICT, recordKey } from './shortcutRecording';
import { useSettingsConfig } from './useSettingsConfig';

const log = createLogger('ShortcutRecorder');

export type HotkeyId = 'uploadClipboard' | 'uploadFromFile';

export const HOTKEYS: readonly { id: HotkeyId; name: string; rowId: 'shortcutClipboard' | 'shortcutFile' }[] = [
  { id: 'uploadClipboard', name: '上传剪贴板图片', rowId: 'shortcutClipboard' },
  { id: 'uploadFromFile', name: '选择文件上传', rowId: 'shortcutFile' },
];

export function useShortcutRecorder() {
  const settings = useSettingsConfig();
  const platform = uiPlatform();
  const recording = ref<HotkeyId | null>(null);
  /** 录制中说明行换成的原因（不支持的键、缺修饰键） */
  const hint = ref('');
  const conflict = ref<{ id: HotkeyId; accelerator: string; message: string } | null>(null);
  let checking = false;

  const current = (): GlobalShortcutConfig => ({ ...DEFAULT_CONFIG.globalShortcut!, ...settings.config.value.globalShortcut });

  async function start(id: HotkeyId): Promise<void> {
    if (recording.value === id) { await stop(); return; }
    if (recording.value) await stop();
    conflict.value = null;
    hint.value = '';
    recording.value = id;
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onWindowBlur);
    await suspendGlobalShortcuts().catch((error) => log.warn('暂停全局快捷键失败', error));
  }

  async function stop(): Promise<void> {
    if (!recording.value) return;
    recording.value = null;
    hint.value = '';
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onWindowBlur);
    await resumeGlobalShortcuts().catch((error) => log.warn('恢复全局快捷键失败', error));
  }

  function onWindowBlur(): void { void stop(); }

  async function save(id: HotkeyId, accelerator: string): Promise<void> {
    const rowId = HOTKEYS.find((h) => h.id === id)!.rowId;
    await settings.patch(rowId, (c) => { c.globalShortcut = { ...DEFAULT_CONFIG.globalShortcut!, ...c.globalShortcut, [id]: accelerator }; });
  }

  async function onKey(event: KeyboardEvent): Promise<void> {
    const id = recording.value;
    if (!id || checking) return;
    if (event.key === 'Tab') { void stop(); return; }
    event.preventDefault();
    event.stopPropagation();
    const result = recordKey(event, platform);
    if (result.kind === 'pending') return;
    if (result.kind === 'reject') { hint.value = result.reason; return; }
    if (result.kind === 'cancel') { await stop(); return; }
    if (result.kind === 'clear') {
      await save(id, '');
      await stop();
      return;
    }
    const accelerator = result.accelerator;
    if (accelerator === current()[id]) { await stop(); return; }
    checking = true;
    try {
      const others = HOTKEYS.filter((h) => h.id !== id).map((h) => ({ name: h.name, accelerator: current()[h.id] }));
      const message = findConflict(accelerator, others, platform) ?? ((await probeShortcut(accelerator)) ? null : OS_CONFLICT);
      if (message) {
        conflict.value = { id, accelerator, message };
        await stop();
        return;
      }
      await save(id, accelerator);
      await stop();
    } finally {
      checking = false;
    }
  }

  function reset(): void {
    conflict.value = null;
    void stop();
  }

  onDeactivated(reset);
  onBeforeUnmount(reset);

  return { recording, hint, conflict, start, stop };
}
