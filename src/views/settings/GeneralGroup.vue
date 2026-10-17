<script setup lang="ts">
// 通用（S01）：外观三卡（浅色 / 深色 / 跟随系统）+ 首页背景装饰；启动三项。改动即保存。
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
const homeDecor = computed(() => settings.config.value.theme?.homeDecor !== false);

function setHomeDecor(on: boolean): void {
  void settings.patch('homeDecor', (c) => { c.theme = { ...(c.theme ?? DEFAULT_CONFIG.theme!), homeDecor: on }; });
}

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
      <SettingsCard class="general__decor">
        <SettingRow row-id="homeDecor" title="首页背景装饰" desc="浅色为花瓣，深色为极光；只在快传页显示">
          <template #lead>
            <span class="general__thumbs" aria-hidden="true">
              <span class="general__thumb general__thumb--light">
                <svg class="general__thumb-petals" viewBox="-4 -4 136 136">
                  <g class="general__thumb-fill"><path d="M64 58L44 29Q40 22 45 16L57 4Q64 -2 71 4L83 16Q88 22 84 29Z" /><path d="M70 64L99 44Q106 40 112 45L124 57Q130 64 124 71L112 83Q106 88 99 84Z" /><path d="M64 70L84 99Q88 106 83 112L71 124Q64 130 57 124L45 112Q40 106 44 99Z" /><path d="M58 64L29 84Q22 88 16 83L4 71Q-2 64 4 57L16 45Q22 40 29 44Z" /></g>
                  <g class="general__thumb-line"><path d="M64 58L44 29Q40 22 45 16L57 4Q64 -2 71 4L83 16Q88 22 84 29Z" /><path d="M70 64L99 44Q106 40 112 45L124 57Q130 64 124 71L112 83Q106 88 99 84Z" /><path d="M64 70L84 99Q88 106 83 112L71 124Q64 130 57 124L45 112Q40 106 44 99Z" /><path d="M58 64L29 84Q22 88 16 83L4 71Q-2 64 4 57L16 45Q22 40 29 44Z" /></g>
                </svg>
              </span>
              <span class="general__thumb general__thumb--dark">
                <span class="general__aurora general__aurora--a" />
                <span class="general__aurora general__aurora--b" />
              </span>
            </span>
          </template>
          <PnSwitch :model-value="homeDecor" label="首页背景装饰" @update:model-value="setHomeDecor" />
        </SettingRow>
      </SettingsCard>
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
  cursor: pointer;
}

.general__theme:focus-visible { outline: none; }
.general__theme:focus-visible .general__preview { box-shadow: 0 0 0 var(--pn-ring-offset) var(--pn-canvas), 0 0 0 calc(var(--pn-ring-offset) + var(--pn-ring-width)) var(--pn-ring); }

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

.general__decor { margin-top: var(--pn-space-4); }
.general__decor :deep(.setting-row) { padding: var(--pn-space-decor-row); }

.general__thumbs {
  display: flex;
  flex: none;
  gap: var(--pn-space-6);
}

.general__thumb {
  position: relative;
  width: var(--pn-size-decor-thumb-w);
  height: var(--pn-size-decor-thumb-h);
  border-radius: var(--pn-radius-decor-thumb);
  overflow: hidden;
}

.general__thumb--light { background: var(--pn-decor-thumb-light); box-shadow: var(--pn-decor-thumb-light-ring); }
.general__thumb--dark { background: var(--pn-decor-thumb-dark); box-shadow: var(--pn-decor-thumb-dark-ring); }

.general__thumb-petals {
  position: absolute;
  top: var(--pn-space-6);
  right: var(--pn-space-decor-petals-right);
  width: var(--pn-size-decor-petals);
  height: var(--pn-size-decor-petals);
}

.general__thumb-fill { fill: var(--pn-decor-thumb-petal-fill); opacity: var(--pn-decor-thumb-petal-fill-opacity); }
.general__thumb-line { fill: none; stroke: var(--pn-decor-thumb-petal-line); stroke-width: var(--pn-decor-thumb-petal-stroke); opacity: var(--pn-decor-thumb-petal-line-opacity); }

.general__aurora {
  position: absolute;
  border-radius: 50%;
  filter: blur(var(--pn-decor-thumb-blur));
}

.general__aurora--a { top: 45%; left: -20%; width: 90%; height: 60%; background: var(--pn-decor-thumb-aurora-a); }
.general__aurora--b { top: 55%; left: 35%; width: 80%; height: 50%; background: var(--pn-decor-thumb-aurora-b); }
</style>
