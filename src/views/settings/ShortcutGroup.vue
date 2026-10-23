<script setup lang="ts">
// 快捷键（S03 / S08 / S09 / K05）：全局快捷键可整体关闭；点组合键进入录制，Esc 取消、Backspace 清除；
// 冲突时不保存，红框 + 说清被谁占用。应用内快捷键只读列出，macOS 显示 ⌘。
import { computed } from 'vue';
import PnSwitch from '@/components/pn/PnSwitch.vue';
import { DEFAULT_CONFIG } from '@/config/types';
import { uiPlatform } from '@/utils/platform';
import { formatShortcut } from '@/utils/shortcutText';
import SettingRow from './SettingRow.vue';
import SettingsCard from './SettingsCard.vue';
import SettingsSection from './SettingsSection.vue';
import { APP_SHORTCUTS, appShortcutLabel } from './shortcutRecording';
import { HOTKEYS, useShortcutRecorder, type HotkeyId } from './useShortcutRecorder';
import { useSettingsConfig } from './useSettingsConfig';

const settings = useSettingsConfig();
const recorder = useShortcutRecorder();
const platform = uiPlatform();

const shortcuts = computed(() => ({ ...DEFAULT_CONFIG.globalShortcut!, ...settings.config.value.globalShortcut }));

function setEnabled(on: boolean): void {
  void settings.patch('globalShortcut', (c) => { c.globalShortcut = { ...DEFAULT_CONFIG.globalShortcut!, ...c.globalShortcut, enabled: on }; });
}

function keysOf(id: HotkeyId): string {
  if (recorder.recording.value === id) return '按下新的组合键…';
  const conflict = recorder.conflict.value;
  const accelerator = conflict?.id === id ? conflict.accelerator : shortcuts.value[id];
  return accelerator ? formatShortcut(accelerator, platform) : '未设置';
}

function messageOf(id: HotkeyId): { text: string; danger: boolean } | null {
  if (recorder.recording.value === id) return { text: recorder.hint.value || 'Esc 取消 · Backspace 清除', danger: false };
  const conflict = recorder.conflict.value;
  return conflict?.id === id ? { text: conflict.message, danger: true } : null;
}
</script>

<template>
  <div class="shortcut">
    <SettingsSection title="全局快捷键" note="点击组合键可重新录制；与其他软件冲突时将立即提示。">
      <SettingsCard>
        <SettingRow row-id="globalShortcut" title="全局快捷键" desc="关闭后，以下快捷键在其他程序中不再生效">
          <PnSwitch :model-value="shortcuts.enabled" label="全局快捷键" @update:model-value="setEnabled" />
        </SettingRow>
        <SettingRow v-for="hotkey in HOTKEYS" :key="hotkey.id" :row-id="hotkey.rowId" :title="hotkey.name" :disabled="!shortcuts.enabled">
          <template v-if="messageOf(hotkey.id)" #desc>
            <span :class="{ 'shortcut__msg--danger': messageOf(hotkey.id)!.danger }" :role="messageOf(hotkey.id)!.danger ? 'alert' : undefined">
              {{ messageOf(hotkey.id)!.text }}
            </span>
          </template>
          <button
            type="button"
            class="shortcut__key"
            :class="{
              'shortcut__key--recording': recorder.recording.value === hotkey.id,
              'shortcut__key--conflict': recorder.conflict.value?.id === hotkey.id,
            }"
            :disabled="!shortcuts.enabled"
            :aria-label="`${hotkey.name}：${keysOf(hotkey.id)}，点击重新录制`"
            @click="recorder.start(hotkey.id)"
            @blur="recorder.recording.value === hotkey.id && recorder.stop()"
          >
            {{ keysOf(hotkey.id) }}
          </button>
        </SettingRow>
      </SettingsCard>
    </SettingsSection>

    <SettingsSection title="应用内快捷键" note="应用内快捷键仅在 PicNexus 窗口中生效，不可修改。">
      <SettingsCard class="shortcut__grid" data-setting-row="appShortcuts">
        <div v-for="item in APP_SHORTCUTS" :key="item.name" class="shortcut__app">
          <span class="shortcut__app-name">{{ item.name }}</span>
          <kbd class="shortcut__kbd">{{ appShortcutLabel(item.keys, platform) }}</kbd>
        </div>
      </SettingsCard>
    </SettingsSection>
  </div>
</template>

<style scoped>
.shortcut {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-settings-groups);
}

.shortcut__msg--danger { color: var(--pn-danger); }

.shortcut__key {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: var(--pn-space-4);
  min-width: var(--pn-size-settings-hotkey);
  height: var(--pn-size-button-md);
  box-sizing: border-box;
  padding: 0 var(--pn-space-sidebar-x);
  border: 0;
  border-radius: var(--pn-radius-md);
  background: var(--pn-secondary-bg);
  box-shadow: var(--pn-secondary-ring);
  color: var(--pn-text1);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-footnote);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in), color var(--pn-dur-fast) var(--pn-ease-in), box-shadow var(--pn-dur-fast) var(--pn-ease-in);
}

/* 白底描边按钮：悬停 / 按下照次按钮的两级 */
.shortcut__key:not(:disabled):hover { background: var(--pn-secondary-hover); }
.shortcut__key:not(:disabled):active { background: var(--pn-secondary-press); }
.shortcut__key:disabled { opacity: var(--pn-opacity-disabled); }

.shortcut__key--recording,
.shortcut__key--recording:not(:disabled):hover,
.shortcut__key--recording:not(:disabled):active {
  background: var(--pn-brand-soft);
  box-shadow: inset 0 0 0 1px var(--pn-brand), 0 0 0 var(--pn-ring-soft-width) var(--pn-ring-soft);
  color: var(--pn-brand-text);
  font-family: inherit;
}

.shortcut__key--recording:focus-visible { outline: none; }
.shortcut__key--conflict { box-shadow: inset 0 0 0 1px var(--pn-danger-fill); }

.shortcut__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.shortcut__app {
  display: flex;
  align-items: center;
  height: var(--pn-size-settings-app-key);
  padding: 0 var(--pn-space-16);
}

.shortcut__app:nth-child(n + 3) { border-top: 1px solid var(--pn-border); }
.shortcut__app:nth-child(even) { border-left: 1px solid var(--pn-border); }

.shortcut__app-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shortcut__kbd {
  display: flex;
  flex: none;
  align-items: center;
  height: var(--pn-size-settings-token);
  padding: 0 var(--pn-space-settings-kbd-x);
  border-radius: var(--pn-radius-sm);
  background: var(--pn-subtle);
  box-shadow: inset 0 -1px 0 var(--pn-border);
  color: var(--pn-text2);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-caption);
}
</style>
