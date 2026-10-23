<script setup lang="ts">
// 关于（S07 / S16–S21）：版本、更新卡片 + 自动更新开关（同一块）、帮助与反馈。
// 有新版本时侧栏「设置」与这里的「关于」各一个小圆点，不弹窗（见 SettingsNav / useNavBadges）。
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import BrandMark from '@/components/biz/BrandMark.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnSwitch from '@/components/pn/PnSwitch.vue';
import { useOnboarding } from '@/composables/useOnboarding';
import { useToast } from '@/composables/useToast';
import { openTrustedExternalUrl } from '@/security/shellOpen';
import SettingRow from './SettingRow.vue';
import SettingsCard from './SettingsCard.vue';
import SettingsSection from './SettingsSection.vue';
import UpdateCard from './UpdateCard.vue';
import WechatDialog from './WechatDialog.vue';
import { useSettingsConfig } from './useSettingsConfig';

const REPO = 'https://github.com/joeyliu6/PicNexus';

const settings = useSettingsConfig();
const toast = useToast();
const { reopen } = useOnboarding();

const version = ref('');
const wechatOpen = ref(false);
const autoUpdate = computed(() => settings.config.value.autoUpdate?.enabled !== false);

onMounted(async () => { version.value = await getVersion().catch(() => ''); });

function setAutoUpdate(on: boolean): void {
  void settings.patch('autoUpdate', (c) => { c.autoUpdate = { enabled: on }; });
}

async function openUrl(url: string): Promise<void> {
  try {
    await openTrustedExternalUrl(url);
  } catch {
    toast.error('未能打开链接', `请在浏览器中访问 ${url}`);
  }
}

async function openLogDir(): Promise<void> {
  try {
    await invoke('open_log_dir');
  } catch {
    toast.error('未能打开日志目录', '请稍后重试');
  }
}

const LINKS = [
  { name: 'GitHub 仓库', hint: '源码和版本发布', external: true, run: () => openUrl(REPO) },
  { name: '问题反馈', hint: '', external: true, run: () => openUrl(`${REPO}/issues`) },
  { name: '更新日志', hint: '', external: true, run: () => openUrl(`${REPO}/releases`) },
  { name: '公众号', hint: '关注开发进度', external: false, run: () => { wechatOpen.value = true; } },
  { name: '重新查看新手引导', hint: '', external: false, run: () => { void reopen(); }, rowId: 'onboarding' },
  { name: '打开日志目录', hint: '用于排查问题', external: true, run: openLogDir },
];
</script>

<template>
  <div class="about">
    <div class="about__brand">
      <BrandMark :size="56" />
      <div class="about__brand-text">
        <span class="about__name">PicNexus</span>
        <span class="about__version">{{ version ? `版本 ${version} · ` : '' }}一张图，多个图床同时备份</span>
      </div>
    </div>

    <div class="about__update">
      <UpdateCard />
      <SettingsCard class="about__auto">
        <SettingRow row-id="autoUpdate" title="自动更新" desc="启动时自动检查新版本">
          <PnSwitch :model-value="autoUpdate" label="自动更新" @update:model-value="setAutoUpdate" />
        </SettingRow>
      </SettingsCard>
    </div>

    <SettingsSection title="帮助与反馈" note="PicNexus 是开源软件，遵循 Apache 2.0 许可证。">
      <SettingsCard>
        <button
          v-for="link in LINKS"
          :key="link.name"
          type="button"
          class="about__link"
          :data-setting-row="link.rowId"
          @click="link.run"
        >
          <span class="about__link-name">{{ link.name }}</span>
          <span class="about__hint">{{ link.hint }}</span>
          <PnIcon class="about__icon" :name="link.external ? 'openExternal' : 'chevronRight'" :size="13" :stroke="1.8" />
        </button>
      </SettingsCard>
    </SettingsSection>

    <WechatDialog v-model:open="wechatOpen" />
  </div>
</template>

<style scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-settings-groups-about);
}

.about__brand {
  display: flex;
  align-items: center;
  gap: var(--pn-space-16);
}

.about__brand-text {
  display: flex;
  flex-direction: column;
}

.about__name {
  font-size: var(--pn-text-headline);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-headline);
}

.about__version { color: var(--pn-text2); }

.about__update { display: flex; flex-direction: column; }

/* 更新卡与「自动更新」上下相接，两块各带一圈描边，接缝处会叠成 2px（设计稿也这样叠）：
   下面这块铺页面底色，盖住更新卡露在它里面的那 1px，接缝和卡片里别的分隔线一样只有 1px */
.about__auto {
  border-radius: 0 0 var(--pn-radius-settings-card) var(--pn-radius-settings-card);
  background: var(--pn-canvas);
}

.about__link {
  display: flex;
  align-items: center;
  gap: var(--pn-space-16);
  height: var(--pn-size-settings-app-key);
  padding: 0 var(--pn-space-16);
  border: 0;
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

/* 会打开链接 / 弹窗的行：按下用设计稿 S10 里「正在导出」那一行的底色（同手动备份） */
.about__link + .about__link { border-top: 1px solid var(--pn-border); }
.about__link:first-child { border-radius: var(--pn-radius-settings-card) var(--pn-radius-settings-card) 0 0; }
.about__link:last-child { border-radius: 0 0 var(--pn-radius-settings-card) var(--pn-radius-settings-card); }
.about__link:hover { background: var(--pn-row-hover); }
.about__link:active { background: var(--pn-selected); }
.about__link-name { flex: 1; }

.about__hint {
  color: var(--pn-text3);
  font-size: var(--pn-text-footnote);
}

.about__icon { flex: none; color: var(--pn-text3); }
</style>
