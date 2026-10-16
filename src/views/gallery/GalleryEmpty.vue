<script setup lang="ts">
// 图库的三种空状态（GalleryScreen.dc.html G09–G11）：
// 一张图都没有（首页同款背景装饰 +「前往快传」；拖图进来照常上传）/ 筛选没有结果（筛选标签留着，「清除筛选」）/
// 收藏为空（只说明怎么收藏，不放按钮：收藏只能在图片上操作）。
import BgDecor from '@/components/biz/BgDecor.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnEmpty from '@/components/pn/PnEmpty.vue';
import type { IconName } from '@/components/pn/icons';
import { uiPlatform } from '@/utils/platform';

export type GalleryEmptyKind = 'empty' | 'noResults' | 'favEmpty';

defineProps<{ kind: GalleryEmptyKind }>();
const emit = defineEmits<{ goHome: []; clearFilters: [] }>();

const pasteKeys = uiPlatform() === 'macos' ? '⌘V' : 'Ctrl+V';
const TEXT: Record<GalleryEmptyKind, { icon: IconName; title: string; body: string }> = {
  empty: { icon: 'emptyGallery', title: '暂无图片', body: `上传的图片会显示在这里。拖入图片，或按 ${pasteKeys} 粘贴` },
  noResults: { icon: 'noResults', title: '没有匹配的图片', body: '尝试其他关键词，或放宽筛选条件' },
  favEmpty: { icon: 'star', title: '还没有收藏', body: '将鼠标移到图片上，点击右上角的星标即可收藏' },
};
</script>

<template>
  <PnEmpty :icon="TEXT[kind].icon" :title="TEXT[kind].title" :description="TEXT[kind].body">
    <template v-if="kind === 'empty'" #backdrop><BgDecor fade-from="0px" fade-to="24px" /></template>
    <template v-if="kind === 'empty'" #default>
      <PnButton variant="primary" @click="emit('goHome')">前往快传</PnButton>
    </template>
    <template v-else-if="kind === 'noResults'" #default>
      <PnButton variant="secondary" @click="emit('clearFilters')">清除筛选</PnButton>
    </template>
  </PnEmpty>
</template>
