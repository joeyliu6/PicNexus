<script setup lang="ts">
// 通用（S01）：外观三卡（浅色 / 深色 / 跟随系统）；启动三项。改动即保存。
import { computed } from 'vue';
import PnSwitch from '@/components/pn/PnSwitch.vue';
import { DEFAULT_CONFIG, type ThemeMode } from '@/config/types';
import { useThemeManager } from '@/composables/useTheme';
import SettingRow from './SettingRow.vue';
import SettingsCard from './SettingsCard.vue';
import SettingsSection from './SettingsSection.vue';
import { useSettingsConfig } from './useSettingsConfig';
import { useSettingsEffects } from './settingsEffects';

const settings = useSettingsConfig();
const effects = useSettingsEffects();
const { currentTheme } = useThemeManager();

const THEMES: { mode: ThemeMode; name: string }[] = [
  { mode: 'light', name: '浅色' },
  { mode: 'dark', name: '深色' },
  { mode: 'auto', name: '跟随系统' },
];

const behavior = computed(() => settings.config.value.appBehavior ?? DEFAULT_CONFIG.appBehavior!);
const autoStart = computed(() => effects.autoStartActual.value ?? behavior.value.autoStart);
function setSilentStart(on: boolean): void {
  void settings.patch('silentStart', (c) => { c.appBehavior = { ...(c.appBehavior ?? DEFAULT_CONFIG.appBehavior!), minimizeToTrayOnStart: on }; });
}

function onThemeKey(event: KeyboardEvent, index: number): void {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  event.preventDefault();
  const next = THEMES[(index + step + THEMES.length) % THEMES.length];
  void effects.changeTheme(next.mode);
  const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="radio"]');
  buttons?.[THEMES.indexOf(next)]?.focus();
}
</script>

<template>
  <div class="general">
    <SettingsSection title="外观">
      <div class="general__themes" role="radiogroup" aria-label="外观" data-setting-row="theme">
        <button
          v-for="(theme, index) in THEMES"
          :key="theme.mode"
          type="button"
          role="radio"
          class="general__theme"
          :class="`general__theme--${theme.mode}`"
          :aria-checked="currentTheme === theme.mode"
          :tabindex="currentTheme === theme.mode ? 0 : -1"
          @click="effects.changeTheme(theme.mode)"
          @keydown="onThemeKey($event, index)"
        >
          <span class="general__preview" aria-hidden="true">
            <span class="general__preview-side" />
            <span class="general__preview-main">
              <span class="general__preview-line" />
              <span class="general__preview-card" />
              <span class="general__preview-note" />
            </span>
          </span>
          <span class="general__theme-name">{{ theme.name }}</span>
        </button>
      </div>
    </SettingsSection>

    <SettingsSection title="启动" note="关闭窗口后 PicNexus 仍在托盘运行，全局快捷键和后台检测照常可用。">
      <SettingsCard>
        <SettingRow row-id="autoStart" title="开机自动启动" desc="登录系统后在托盘中运行">
          <PnSwitch :model-value="autoStart" label="开机自动启动" @update:model-value="effects.changeAutoStart" />
        </SettingRow>
        <SettingRow row-id="silentStart" title="静默启动" desc="启动时不弹出主窗口">
          <PnSwitch :model-value="behavior.minimizeToTrayOnStart" label="静默启动" @update:model-value="setSilentStart" />
        </SettingRow>
        <SettingRow row-id="closeToTray" title="关闭窗口时最小化到托盘" desc="关闭窗口后不退出应用">
          <PnSwitch :model-value="behavior.closeToTray !== false" label="关闭窗口时最小化到托盘" @update:model-value="effects.changeCloseToTray" />
        </SettingRow>
      </SettingsCard>
    </SettingsSection>
  </div>
</template>

<style scoped>
.general {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-settings-groups);
}

.general__themes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--pn-space-12);
}

.general__theme {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--pn-space-8);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
}

.general__theme:focus-visible { outline: none; }
.general__theme:focus-visible .general__preview { box-shadow: 0 0 0 var(--pn-ring-offset) var(--pn-canvas), 0 0 0 calc(var(--pn-ring-offset) + var(--pn-ring-width)) var(--pn-ring); }

/* 三张卡的样子是固定的，没有悬停态，点了就选中。选中描边（2 + 2）不带过渡：选中总和整页换主题同时发生，
   带过渡时描边比整页慢半拍，深浅切换那一下卡片外圈会闪一圈旧主题的颜色 */
.general__preview {
  display: flex;
  width: 100%;
  height: var(--pn-size-theme-preview);
  box-sizing: border-box;
  border-radius: var(--pn-radius-settings-card);
  box-shadow: 0 0 0 1px var(--pn-border);
  overflow: hidden;
}

.general__theme[aria-checked='true'] .general__preview { box-shadow: 0 0 0 var(--pn-ring-offset) var(--pn-canvas), 0 0 0 calc(var(--pn-ring-offset) + var(--pn-ring-width)) var(--pn-brand); }
.general__theme[aria-checked='true'] .general__theme-name { font-weight: var(--pn-weight-semibold); }

.general__preview-side { width: 30%; }

.general__preview-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-theme-preview-gap);
  padding: var(--pn-space-theme-preview);
}

.general__preview-line { width: 60%; height: var(--pn-size-theme-line); border-radius: var(--pn-radius-theme-line); }
.general__preview-card { height: var(--pn-size-theme-card); border-radius: var(--pn-radius-theme-card); }
.general__preview-note { width: 40%; height: var(--pn-size-theme-note); border-radius: var(--pn-radius-theme-line); }

.general__theme--light .general__preview-side { background: var(--pn-theme-light-side); }
.general__theme--light .general__preview-main { background: var(--pn-theme-light-main); }

.general__theme--light .general__preview-line,
.general__theme--light .general__preview-note { background: var(--pn-theme-light-line); }
.general__theme--light .general__preview-card { background: var(--pn-theme-light-card); }

.general__theme--dark .general__preview-side { background: var(--pn-theme-dark-side); }
.general__theme--dark .general__preview-main { background: var(--pn-theme-dark-main); }

.general__theme--dark .general__preview-line,
.general__theme--dark .general__preview-note { background: var(--pn-theme-dark-line); }
.general__theme--dark .general__preview-card { background: var(--pn-theme-dark-card); }

.general__theme--auto .general__preview-side { background: var(--pn-theme-light-side); }
.general__theme--auto .general__preview-main { background: linear-gradient(90deg, var(--pn-theme-light-main) 50%, var(--pn-theme-dark-main) 50%); }

.general__theme--auto .general__preview-line,
.general__theme--auto .general__preview-note { background: var(--pn-theme-auto-line); }
.general__theme--auto .general__preview-card { background: linear-gradient(90deg, var(--pn-theme-light-card) 50%, var(--pn-theme-dark-card) 50%); }
</style>
