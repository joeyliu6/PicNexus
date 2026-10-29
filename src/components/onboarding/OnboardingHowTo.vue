<script setup lang="ts">
// 引导 3 / 3 · 怎么传（O03）：四种上传方式（快捷键写实际录的组合键、按平台写法）+ 默认链接格式 URL / Markdown。
// 当前是 HTML 等其他格式时两个都不亮，不点就不改。
import { computed } from 'vue';
import PnSegmented, { type PnSegment } from '@/components/pn/PnSegmented.vue';
import type { LinkFormat } from '@/utils/linkFormatter';
import type { UiPlatform } from '@/utils/platform';
import { uploadWays } from './onboardingModel';

const props = defineProps<{ format: LinkFormat; platform: UiPlatform; hotkey: string }>();
const emit = defineEmits<{ 'update:format': [format: LinkFormat] }>();

const SEGMENTS: readonly PnSegment<LinkFormat>[] = [
  { value: 'url', label: 'URL' },
  { value: 'markdown', label: 'Markdown' },
];

const ways = computed(() => uploadWays(props.platform, props.hotkey));
const format = computed({ get: () => props.format, set: (value: LinkFormat) => emit('update:format', value) });
</script>

<template>
  <div class="howto">
    <div class="howto__head">
      <h2 class="howto__title">上传方式</h2>
      <span class="howto__desc">上传完成后自动复制链接，可直接粘贴到编辑器。</span>
    </div>

    <div class="howto__grid">
      <div v-for="way in ways" :key="way.title" class="howto__way">
        <span class="howto__plate" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path :d="way.icon" /></svg>
        </span>
        <span class="howto__text">
          <span class="howto__name">{{ way.title }}</span>
          <span class="howto__sub pn-wrap-phrases">{{ way.body }}</span>
        </span>
      </div>
    </div>

    <div class="howto__format">
      <span class="howto__text howto__text--grow">
        <span class="howto__name">默认链接格式</span>
        <span class="howto__sub pn-wrap-phrases">Markdown 适用于博客与笔记，URL 仅包含地址。可在设置中修改</span>
      </span>
      <PnSegmented v-model="format" :segments="SEGMENTS" label="默认链接格式" />
    </div>
  </div>
</template>

<style scoped>
.howto {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--pn-space-onboarding-gap);
  padding: var(--pn-space-onboarding-page);
}

.howto__head { display: flex; flex-direction: column; gap: var(--pn-space-6); }

.howto__title {
  margin: 0;
  font-size: var(--pn-text-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-title);
  letter-spacing: var(--pn-tracking-onboarding-title);
}

.howto__desc { color: var(--pn-text2); }

.howto__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--pn-space-12);
}

.howto__way {
  display: flex;
  gap: var(--pn-space-12);
  padding: var(--pn-space-onboarding-panel);
  border-radius: var(--pn-radius-xl);
  background: var(--pn-subtle);
}

.howto__plate {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-onboarding-way-plate);
  height: var(--pn-size-onboarding-way-plate);
  border-radius: var(--pn-radius-md);
  background: var(--pn-elevated);
  box-shadow: 0 0 0 var(--pn-space-1) var(--pn-hairline);
  color: var(--pn-brand-text);
}

.howto__text { display: flex; flex-direction: column; gap: var(--pn-space-2); min-width: 0; }
.howto__text--grow { flex: 1; gap: 0; }
.howto__name { font-weight: var(--pn-weight-semibold); }
.howto__sub { font-size: var(--pn-text-footnote); line-height: var(--pn-leading-footnote); color: var(--pn-text2); }

.howto__format {
  display: flex;
  align-items: center;
  gap: var(--pn-space-onboarding-card-gap);
  padding: var(--pn-space-onboarding-panel);
  border-radius: var(--pn-radius-xl);
  box-shadow: 0 0 0 var(--pn-space-1) var(--pn-border);
}
</style>
