<script setup lang="ts">
// 图床图标（HostIcons.dc.html / HostIcon.dc.html）：统一的单色 SVG，跟随文字颜色，
// 外面一个固定尺寸的 flex 容器居中。尺寸：16 列表 / 20 标签 / 24 选择面板 / 32 图床页头部 / 44 登录窗口。
// plate = 需要底板时由界面绘制（白底 + 1px 描边），底板尺寸随图标档位走。
// 自定义 S3 与 WebDAV 用通用图标；认不出的图床退回名字的前两个字。
import { computed } from 'vue';
import { getServiceIcon } from '@/utils/icons';
import { isCustomS3Id, isWebDAVId } from '@/config/types';

// 形状照抄 HostIcon.dc.html 的 s3 / webdav 两个通用图标
const GENERIC_S3 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>';
const GENERIC_WEBDAV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3.5" width="18" height="7" rx="2"/><rect x="3" y="13.5" width="18" height="7" rx="2"/><path d="M7 7h.01M7 17h.01"/></svg>';

const PLATE: Record<number, { box: number; radius: number }> = {
  16: { box: 22, radius: 6 },
  20: { box: 28, radius: 7 },
  24: { box: 34, radius: 8 },
  32: { box: 44, radius: 11 },
  44: { box: 60, radius: 14 },
};

const props = withDefaults(defineProps<{
  /** 图床 ID，支持 custom_s3:xxx / webdav:xxx 复合 ID */
  host: string;
  /** 规范档位 16 / 20 / 24 / 32 / 44；首页标签里用到 14、15 */
  size?: number;
  /** 认不出图标时显示的名字（取前两个字） */
  name?: string;
  plate?: boolean;
}>(), { size: 16, name: undefined, plate: false });

const svg = computed(() => {
  if (isCustomS3Id(props.host) || props.host === 's3') return GENERIC_S3;
  if (isWebDAVId(props.host) || props.host === 'webdav') return GENERIC_WEBDAV;
  return getServiceIcon(props.host) ?? null;
});

const mark = computed(() => (props.name ?? props.host).slice(0, 2));
// 规范档位照表取底板；其余尺寸按 16 → 22、圆角约三分之一推算
const plateSize = computed(() => PLATE[props.size] ?? { box: Math.round(props.size * 1.375), radius: Math.round(props.size / 3) });
</script>

<template>
  <span
    class="host-icon"
    :class="{ 'host-icon--plate': plate }"
    :style="plate
      ? { width: `${plateSize.box}px`, height: `${plateSize.box}px`, borderRadius: `${plateSize.radius}px` }
      : { width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  >
    <!-- SVG 来自 src/assets 的构建期静态资源或上面的常量，非用户输入，v-html 无 XSS 面 -->
    <span v-if="svg" class="host-icon__glyph" :style="{ width: `${size}px`, height: `${size}px` }" v-html="svg" />
    <span v-else class="host-icon__mark" :style="{ fontSize: `${Math.round(size * 0.62)}px` }">{{ mark }}</span>
  </span>
</template>

<style scoped>
.host-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  line-height: 0;
}

.host-icon--plate {
  background: var(--pn-canvas);
  box-shadow: 0 0 0 1px var(--pn-hairline);
}

.host-icon__glyph {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
}

.host-icon__glyph :deep(svg) {
  width: 100%;
  height: 100%;
}

.host-icon__mark {
  font-weight: var(--pn-weight-semibold);
  line-height: 1;
}
</style>
