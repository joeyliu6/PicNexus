<script setup lang="ts">
// 预览框（ImageRatios.dc.html「预览框」：首页焦点卡）：框的尺寸由外面定，图片完整显示、不裁不拉伸；
// 空出来的地方铺这张图自己的模糊放大版，竖图、横图都不会留下突兀的白边或黑边。
// 原图比框小时不放大（同图库小图的规则，避免模糊）。透明格式在图片底下衬棋盘格，不让模糊衬底透出来。
import { useElementSize } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
import { imageFormat, mayBeTransparent } from '@/utils/imageDisplay';

const props = defineProps<{
  srcs: string[];
  /** 文件名：读屏念它；数据库没记格式时也靠它的扩展名判断要不要衬棋盘格 */
  name: string;
  /** 上传时记下的格式（小写扩展名） */
  format?: string;
  /** 宽 / 高（不知道就当正方形） */
  ratio?: number;
  /** 原图宽（像素）：知道的话不放大到超过它 */
  naturalWidth?: number;
  confirmedHttpHosts?: ReadonlySet<string>;
}>();

const checker = computed(() => mayBeTransparent(imageFormat({ format: props.format, localFileName: props.name })));

const frame = ref<HTMLElement | null>(null);
const { width: frameWidth, height: frameHeight } = useElementSize(frame);

/** 实际显示出来的那一张：衬底用同一个地址，不多发请求 */
const shown = ref<string | null>(null);
watch(() => props.srcs, () => { shown.value = null; });

const box = computed(() => {
  const ratio = props.ratio && props.ratio > 0 ? props.ratio : 1;
  if (!frameWidth.value || !frameHeight.value) return { width: '100%', height: '100%' };
  let width = Math.min(frameWidth.value, frameHeight.value * ratio);
  if (props.naturalWidth) width = Math.min(width, props.naturalWidth);
  return { width: `${Math.round(width)}px`, height: `${Math.round(width / ratio)}px` };
});
</script>

<template>
  <span ref="frame" class="preview-frame">
    <img v-if="shown" :src="shown" alt="" aria-hidden="true" class="preview-frame__fill" referrerpolicy="no-referrer">
    <span class="preview-frame__image" :class="{ 'preview-frame__image--checker': checker }" :style="box">
      <ThumbnailImage :srcs="srcs" :alt="name" :confirmed-http-hosts="confirmedHttpHosts" @loaded="shown = $event" />
    </span>
  </span>
</template>

<style scoped>
.preview-frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* 这张图自己的模糊放大版：比框大一圈，模糊后边缘不露底 */
.preview-frame__fill {
  position: absolute;
  top: var(--pn-preview-fill-inset);
  left: var(--pn-preview-fill-inset);
  width: calc(100% - 2 * var(--pn-preview-fill-inset));
  height: calc(100% - 2 * var(--pn-preview-fill-inset));
  object-fit: cover;
  filter: var(--pn-preview-fill-blur);
  opacity: var(--pn-preview-fill-opacity);
}

.preview-frame__image {
  position: relative;
  display: flex;
  overflow: hidden;
  box-shadow: 0 0 0 1px var(--pn-hairline);
}

.preview-frame__image--checker {
  background-color: var(--pn-checker-a);
  background-image: var(--pn-checker);
  background-position: var(--pn-checker-position);
  background-size: var(--pn-size-checker) var(--pn-size-checker);
}
</style>
