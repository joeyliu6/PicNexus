<script setup lang="ts">
// 链接块（Patterns.dc.html）：浅灰底、等宽 12px，按格式语法分色，网址用蓝色文字。
// compact = 图库详情里那块（11px、最多三行）；broken = 这条链接已失效：网址变红、其余变灰（GalleryScreen.dc.html G06）
import { computed } from 'vue';
import { splitLinkSegments } from '@/utils/linkSegments';

const props = defineProps<{
  /** 按当前格式生成好的链接文字 */
  text: string;
  url: string;
  filename?: string;
  compact?: boolean;
  broken?: boolean;
}>();

const segments = computed(() => splitLinkSegments(props.text, props.url, props.filename));
</script>

<template>
  <div class="link-block" :class="{ 'link-block--compact': compact, 'link-block--broken': broken }"><span v-for="(segment, i) in segments" :key="i" :class="`link-block__${segment.kind}`">{{ segment.text }}</span></div>
</template>

<style scoped>
.link-block {
  padding: var(--pn-space-sidebar-x) var(--pn-space-toast-left);
  border-radius: var(--pn-radius-lg);
  background: var(--pn-subtle);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
  line-height: 1.6;
  word-break: break-all;
}

.link-block__url { color: var(--pn-brand-text); }
.link-block__name { color: var(--pn-text1); }
.link-block__syntax { color: var(--pn-text3); }

.link-block--compact {
  max-height: var(--pn-size-link-compact-max);
  overflow: hidden;
  padding: var(--pn-space-link-compact-y) var(--pn-space-button-sm-x);
  border-radius: var(--pn-radius-md);
  font-size: var(--pn-text-caption);
  line-height: 1.55;
}

.link-block--broken .link-block__url { color: var(--pn-danger); }
.link-block--broken .link-block__name { color: var(--pn-text2); }
</style>
