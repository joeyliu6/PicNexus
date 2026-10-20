<script setup lang="ts">
// 「最近上传」的一行（HomeScreen.dc.html）：44px 缩略图 · 文件名 + 时间 · 第二行（链接 / 原因）· 右侧 120px 操作
// viewable：点缩略图看大图（发 view）
import ThumbnailImage from '@/components/common/ThumbnailImage.vue';
import PnIcon from '@/components/pn/PnIcon.vue';

withDefaults(defineProps<{
  name: string;
  /** 文件名过长被截断时，悬停看全名 */
  fullName?: string;
  time: string;
  thumbSrcs?: readonly string[];
  /** 一组多张：缩略图画成叠放的三块 */
  stacked?: boolean;
  confirmedHttpHosts?: ReadonlySet<string>;
  viewable?: boolean;
}>(), { fullName: undefined, thumbSrcs: () => [], stacked: false, confirmedHttpHosts: undefined, viewable: false });

defineEmits<{ view: [] }>();
</script>

<template>
  <div class="recent-row">
    <div v-if="stacked" class="recent-row__stack" aria-hidden="true">
      <span class="recent-row__stack-card recent-row__stack-card--back" />
      <span class="recent-row__stack-card recent-row__stack-card--mid" />
      <span class="recent-row__stack-card recent-row__stack-card--front">
        <ThumbnailImage v-if="thumbSrcs.length" :srcs="[...thumbSrcs]" alt="" :confirmed-http-hosts="confirmedHttpHosts" />
      </span>
    </div>
    <button v-else-if="viewable && thumbSrcs.length" type="button" class="recent-row__thumb recent-row__thumb--button" :aria-label="`查看大图：${fullName ?? name}`" @click="$emit('view')">
      <ThumbnailImage :srcs="[...thumbSrcs]" :alt="name" :confirmed-http-hosts="confirmedHttpHosts" />
    </button>
    <div v-else class="recent-row__thumb">
      <ThumbnailImage v-if="thumbSrcs.length" :srcs="[...thumbSrcs]" :alt="name" :confirmed-http-hosts="confirmedHttpHosts" />
      <PnIcon v-else name="gallery" :size="18" :stroke="1.4" class="recent-row__thumb-empty" />
    </div>
    <div class="recent-row__text">
      <div class="recent-row__title">
        <span class="recent-row__name" :title="fullName">{{ name }}</span>
        <span class="recent-row__time">{{ time }}</span>
      </div>
      <div class="recent-row__second"><slot name="second" /></div>
    </div>
    <div class="recent-row__action" :class="{ 'recent-row__action--swaps': !!$slots.hover }">
      <div class="recent-row__rest"><slot name="action" /></div>
      <!-- 悬停 / 聚焦时盖在状态上；菜单开着时也保持可见，菜单才有地方挂 -->
      <div v-if="$slots.hover" class="recent-row__hover"><slot name="hover" /></div>
    </div>
  </div>
</template>

<style scoped>
.recent-row {
  display: flex;
  align-items: center;
  gap: var(--pn-space-recent-gap);
  height: var(--pn-size-recent-row);
  padding: 0 var(--pn-space-12);
  border-radius: var(--pn-radius-lg);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.recent-row:hover { background: var(--pn-recent-row-hover); }

.recent-row__thumb {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-recent-thumb);
  height: var(--pn-size-recent-thumb);
  overflow: hidden;
  border-radius: var(--pn-radius-md);
  background: var(--pn-subtle);
  box-shadow: 0 0 0 1px var(--pn-hairline);
}

.recent-row__thumb--button {
  padding: 0;
  border: 0;
  cursor: zoom-in;
}

.recent-row__thumb-empty { color: var(--pn-text3); }

.recent-row__stack { position: relative; flex: none; width: var(--pn-size-recent-thumb); height: var(--pn-size-recent-thumb); }

.recent-row__stack-card {
  position: absolute;
  width: var(--pn-size-stack-card);
  height: var(--pn-size-stack-card);
  overflow: hidden;
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-skeleton);
}

.recent-row__stack-card--back { top: 0; left: var(--pn-space-8); opacity: 0.6; }
.recent-row__stack-card--mid { top: var(--pn-space-4); left: var(--pn-space-4); opacity: 0.8; }

.recent-row__stack-card--front {
  top: var(--pn-space-8);
  left: 0;
  box-sizing: border-box;
  border: var(--pn-border-dashed) solid var(--pn-canvas);
  background: var(--pn-subtle);
}

.recent-row__text { display: flex; flex: 1; flex-direction: column; gap: var(--pn-space-recent-line-gap); min-width: 0; }
.recent-row__title { display: flex; align-items: baseline; gap: var(--pn-space-sidebar-x); min-width: 0; }

.recent-row__name {
  overflow: hidden;
  font-weight: var(--pn-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-row__time { flex: none; font-size: var(--pn-text-footnote); color: var(--pn-text3); }

.recent-row__second {
  overflow: hidden;
  font-size: var(--pn-text-footnote);
  color: var(--pn-text3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-row__action {
  position: relative;
  flex: none;
  width: var(--pn-size-recent-action);
}

.recent-row__rest,
.recent-row__hover {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--pn-space-2);
  transition: opacity var(--pn-dur-instant) var(--pn-ease-in);
}

.recent-row__hover {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
}

.recent-row:hover .recent-row__action--swaps .recent-row__hover,
.recent-row:focus-within .recent-row__action--swaps .recent-row__hover,
.recent-row:has([data-state='open']) .recent-row__action--swaps .recent-row__hover {
  opacity: 1;
  pointer-events: auto;
}

.recent-row:hover .recent-row__action--swaps .recent-row__rest,
.recent-row:focus-within .recent-row__action--swaps .recent-row__rest,
.recent-row:has([data-state='open']) .recent-row__action--swaps .recent-row__rest {
  opacity: 0;
}
</style>
