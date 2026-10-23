<script setup lang="ts">
// 看大图（首页焦点卡、最近上传）：点缩略图打开，深色铺满窗口，图片按原比例放到能放下的最大、不超过原图尺寸；
// 点任意处、关闭按钮或 Esc 关闭。只看这一张：翻页、缩放、换图床在图库的灯箱里。
// 地址按候选顺序试：原图在前，加载不出来退到缩略图（与缩略图同一道安全闸，见 ThumbnailImage）。
// 与灯箱一样不随主题：标 data-theme="dark" 取深色令牌。
import { computed } from 'vue';
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
import PnIcon from '@/components/pn/PnIcon.vue';

const open = defineModel<boolean>('open', { default: false });

const props = defineProps<{
  srcs: string[];
  name: string;
  /** 原图宽高（像素）：知道才按比例放；不知道按正方形 */
  width?: number;
  height?: number;
  /** 底栏文件名下面那一行（尺寸、大小） */
  meta?: string;
  confirmedHttpHosts?: ReadonlySet<string>;
}>();

const frameStyle = computed(() => (props.width && props.height
  ? { '--viewer-w': props.width, '--viewer-h': props.height, '--viewer-cap': `${props.width}px` }
  : {}));
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="image-viewer__overlay" />
      <DialogContent class="pn-layer image-viewer" data-theme="dark" :aria-describedby="undefined" @click="open = false">
        <DialogTitle class="image-viewer__title">{{ name }}</DialogTitle>
        <DialogClose class="image-viewer__close" aria-label="关闭" title="关闭  Esc" @click.stop>
          <PnIcon name="close" :size="13" :stroke="2" />
        </DialogClose>
        <!-- 关闭时图片留到淡出结束（Reka 等退场动画播完才卸掉内容），不先空一帧 -->
        <div class="image-viewer__frame" :style="frameStyle">
          <ThumbnailImage :srcs="srcs" :alt="name" :confirmed-http-hosts="confirmedHttpHosts" />
        </div>
        <div class="image-viewer__bottom">
          <span class="image-viewer__name">{{ name }}</span>
          <span v-if="meta" class="image-viewer__meta">{{ meta }}</span>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<!-- 传送到 body，用不带 scoped 的类名 -->
<style>
.image-viewer__overlay {
  position: fixed;
  inset: 0;
  z-index: var(--pn-z-lightbox);
  background: var(--pn-lightbox-bg);
}

.image-viewer__overlay[data-state='open'] { animation: pn-dialog-fade var(--pn-dur-expressive) var(--pn-ease-in); }

/* 关闭时淡出：ease-out、比进场快 30%（交接说明 5.3）；Reka 等这段动画播完才移除元素 */
.image-viewer__overlay[data-state='closed'] { animation: pn-fade-out calc(var(--pn-dur-expressive) * 0.7) var(--pn-ease-out) forwards; }

.image-viewer {
  --viewer-w: 1;
  --viewer-h: 1;

  position: fixed;
  inset: 0;
  z-index: var(--pn-z-lightbox);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pn-text1);
  outline: none;
  cursor: zoom-out;
}

.image-viewer[data-state='open'] { animation: pn-dialog-fade var(--pn-dur-expressive) var(--pn-ease-in); }
.image-viewer[data-state='closed'] { animation: pn-fade-out calc(var(--pn-dur-expressive) * 0.7) var(--pn-ease-out) forwards; }

/* 「减少动态效果」时照样淡入淡出（位移改淡入，淡入不取消），时长用不归零的那份 */
@media (prefers-reduced-motion: reduce) {
  .image-viewer__overlay[data-state='open'],
  .image-viewer[data-state='open'] { animation-duration: var(--pn-dur-fade-expressive); }

  .image-viewer__overlay[data-state='closed'],
  .image-viewer[data-state='closed'] { animation: pn-fade-out calc(var(--pn-dur-fade-expressive) * 0.7) var(--pn-ease-out) forwards; }
}

.image-viewer__title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.image-viewer__close {
  position: absolute;
  top: var(--pn-space-12);
  left: var(--pn-space-16);
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-button-lg);
  height: var(--pn-size-button-lg);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-md);
  background: var(--pn-lightbox-button);
  color: var(--pn-text1);
  cursor: pointer;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.image-viewer__close:hover { background: var(--pn-lightbox-button-hover); }
.image-viewer__close:active { background: var(--pn-lightbox-button-press); }

/* 能放下的最大：宽不超过窗口（留边）、高不超过顶栏与底栏之间、也不超过原图本身 */
.image-viewer__frame {
  display: flex;
  width: min(
    var(--viewer-cap, 100vw),
    calc(100vw - 2 * var(--pn-space-56)),
    calc((100vh - var(--pn-size-lightbox-top) - var(--pn-size-lightbox-bottom)) * var(--viewer-w) / var(--viewer-h))
  );
  aspect-ratio: var(--viewer-w) / var(--viewer-h);
  overflow: hidden;
  border-radius: var(--pn-radius-sm);
}

.image-viewer__bottom {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: var(--pn-size-lightbox-bottom);
  padding: 0 var(--pn-space-20);
  box-sizing: border-box;
}

.image-viewer__name {
  overflow: hidden;
  font-weight: var(--pn-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-viewer__meta { color: var(--pn-text3); font-size: var(--pn-text-footnote); }
</style>
