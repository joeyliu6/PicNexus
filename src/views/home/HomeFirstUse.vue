<script setup lang="ts">
// 第一次使用（HomeScreen.dc.html H01 / H19）：没有任何记录时投放区放大居中，下面三条说明还能怎么传。
// 「再加一个备份」打开同一个「上传到」面板，只列京东和七鱼两个免配置图床，点一下就能加上做备份。
import { computed } from 'vue';
import BrandMark from '@/components/biz/BrandMark.vue';
import HostIcon from '@/components/biz/HostIcon.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import PnPopover from '@/components/pn/PnPopover.vue';
import { NO_CONFIG_SERVICES } from '@/constants/serviceRequiredFields';
import type { UploadHost } from '@/composables/upload/useUploadController';
import { FORMAT_NAMES, type LinkFormat } from '@/utils/linkFormatter';
import { uiPlatform } from '@/utils/platform';
import UploadToPanel from './UploadToPanel.vue';

const props = defineProps<{
  hosts: readonly UploadHost[];
  format: LinkFormat;
  copyFrom?: string;
  /** 全局快捷键（上传剪贴板）的显示写法，如 Ctrl+Shift+C */
  hotkey: string;
}>();

const emit = defineEmits<{
  pick: [];
  url: [];
  toggleHost: [hostId: string];
  enableHost: [hostId: string];
  setCopyFrom: [hostId: string | undefined];
  setFormat: [format: LinkFormat];
  manageHosts: [];
}>();

const mac = uiPlatform() === 'macos';
const pasteKeys = mac ? '⌘V' : 'Ctrl+V';

const NAMES: Record<string, string> = { jd: '京东', qiyu: '七鱼' };

/** 已添加的图床 + 还没加的免配置图床（点一下就加上） */
const pickHosts = computed<UploadHost[]>(() => {
  const added = new Set(props.hosts.map((h) => h.id));
  const extra = NO_CONFIG_SERVICES.filter((id) => !added.has(id))
    .map((id) => ({ id, name: NAMES[id] ?? id, selected: false, warning: null, cookieLogin: false }));
  return [...props.hosts, ...extra];
});

const selected = computed(() => props.hosts.filter((h) => h.selected));

function onToggle(hostId: string) {
  if (props.hosts.some((h) => h.id === hostId)) emit('toggleHost', hostId);
  else emit('enableHost', hostId);
}

const formatOptions = (['url', 'markdown', 'html', 'bbcode', 'custom'] as const).map((value) => ({ value, label: FORMAT_NAMES[value] }));
const formatModel = computed({ get: () => props.format, set: (value: LinkFormat) => emit('setFormat', value) });
</script>

<template>
  <div class="first-use">
    <section class="first-use__drop" aria-label="投放区">
      <BrandMark :size="56" />
      <div class="first-use__title">拖入图片，或按 {{ pasteKeys }} 粘贴</div>
      <div class="first-use__buttons">
        <PnButton variant="primary" @click="emit('pick')">选择文件</PnButton>
        <PnButton variant="ghost" class="first-use__url" @click="emit('url')">从 URL 下载</PnButton>
      </div>
    </section>

    <div class="first-use__tips">
      <div class="first-use__tip">
        <span class="first-use__tip-title">拖入窗口任意位置</span>
        <span class="first-use__tip-desc">任意页面均可拖入上传</span>
      </div>
      <div class="first-use__tip">
        <span class="first-use__tip-title">截图后按 {{ pasteKeys }}</span>
        <span class="first-use__tip-desc">上传剪贴板图片</span>
      </div>
      <!-- 关掉了全局快捷键就不提它 -->
      <div v-if="hotkey" class="first-use__tip">
        <span class="first-use__tip-title">在任意程序中按 {{ hotkey }}</span>
        <span class="first-use__tip-desc">无需打开窗口，完成后自动复制链接</span>
      </div>
    </div>

    <div class="first-use__line">
      <span>上传到</span>
      <PnPopover align="center" label="上传到">
        <template #trigger>
          <button type="button" class="first-use__chips" title="点击选择上传到哪些图床">
            <span v-for="host in selected" :key="host.id" class="first-use__chip first-use__chip--on">
              <HostIcon :host="host.id" :name="host.name" :size="14" />
              {{ host.name }}
            </span>
            <span class="first-use__chip">
              <PnIcon name="plus" :size="11" :stroke="2.4" />
              再加一个备份
            </span>
          </button>
        </template>
        <UploadToPanel
          :hosts="pickHosts"
          :copy-from="copyFrom"
          @toggle="onToggle"
          @set-copy-from="emit('setCopyFrom', $event)"
          @manage="emit('manageHosts')"
        />
      </PnPopover>
      <span class="first-use__divider" />
      <span>复制为</span>
      <PnMenu align="center" :width="200">
        <template #trigger>
          <button type="button" class="first-use__format">{{ FORMAT_NAMES[format] }}</button>
        </template>
        <PnMenuRadioGroup v-model="formatModel" :options="formatOptions" />
      </PnMenu>
    </div>
  </div>
</template>

<style scoped>
.first-use {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-20);
  padding-top: var(--pn-space-home-first-use-top);
}

.first-use__drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--pn-space-toast-left);
  height: var(--pn-size-drop-first-use);
  box-sizing: border-box;
  border: var(--pn-border-dashed) dashed var(--pn-border-strong);
  border-radius: var(--pn-radius-panel);
}

.first-use__title {
  margin-top: var(--pn-space-6);
  font-size: var(--pn-text-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-title);
  letter-spacing: var(--pn-tracking-title);
}

.first-use__buttons { display: flex; align-items: center; gap: var(--pn-space-6); }
.first-use__url { color: var(--pn-text2); font-weight: var(--pn-weight-regular); }

.first-use__tips { display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; gap: var(--pn-space-12); }

.first-use__tip {
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-4);
  padding: var(--pn-space-toast-left) var(--pn-space-16);
  border-radius: var(--pn-radius-xl);
  background: var(--pn-subtle);
}

.first-use__tip-title { font-weight: var(--pn-weight-medium); }
.first-use__tip-desc { font-size: var(--pn-text-footnote); line-height: var(--pn-leading-footnote); color: var(--pn-text2); }

.first-use__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--pn-space-8);
  font-size: var(--pn-text-footnote);
  color: var(--pn-text2);
}

.first-use__chips { display: flex; gap: var(--pn-space-8); padding: 0; border: 0; background: transparent; font: inherit; cursor: pointer; }

.first-use__chip {
  display: flex;
  align-items: center;
  gap: var(--pn-space-copy-gap);
  height: var(--pn-size-chip);
  padding: 0 var(--pn-space-12) 0 var(--pn-space-sidebar-x);
  border-radius: var(--pn-size-chip);
  background: var(--pn-subtle);
  color: var(--pn-text2);
}

.first-use__chip--on {
  gap: var(--pn-space-6);
  padding: 0 var(--pn-space-sidebar-x) 0 var(--pn-space-8);
  background: var(--pn-chip-on);
  color: var(--pn-brand-text);
  font-weight: var(--pn-weight-medium);
}

.first-use__divider { width: 1px; height: var(--pn-size-icon-sm); margin: 0 var(--pn-space-4); background: var(--pn-border); }

.first-use__format {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  font-weight: var(--pn-weight-medium);
  cursor: pointer;
}
</style>
