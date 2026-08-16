<script setup lang="ts">
// 图床服务 logo
// 只负责「渲染什么」，尺寸与颜色一律由父级 class 决定（单根组件，class 会 fallthrough 到根元素）

import { computed } from 'vue';
import { resolveServiceLogo } from '../../utils/icons';

const props = defineProps<{
  /** 服务 ID，支持 custom_s3:xxx / webdav:xxx 复合 ID */
  serviceId: string;
}>();

const logo = computed(() => resolveServiceLogo(props.serviceId));
</script>

<template>
  <!-- SVG 来自 src/assets 的构建期静态资源，非用户输入，v-html 无 XSS 面 -->
  <!-- logo 恒为装饰性元素（旁边一定有服务名文本或 aria-label），统一对辅助技术隐藏 -->
  <span
    v-if="logo.kind === 'svg'"
    class="service-logo"
    aria-hidden="true"
    v-html="logo.svg"
  ></span>
  <i
    v-else
    class="service-logo service-logo--glyph"
    :class="logo.className"
    aria-hidden="true"
  ></i>
</template>

<style scoped>
.service-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.service-logo :deep(svg) {
  width: 100%;
  height: 100%;
}

/* 字体图标没有内在尺寸，靠 font-size 撑；继承容器高度以对齐相邻的 SVG logo */
.service-logo--glyph {
  font-size: inherit;
  line-height: 1;
}
</style>
