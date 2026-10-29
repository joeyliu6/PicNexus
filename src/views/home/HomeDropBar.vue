<script setup lang="ts">
// 投放区（HomeScreen.dc.html 常规布局）：60px 虚线条。拖入在窗口任何位置都能触发，这里只是提示与按钮。
// 「选择文件…」与右边的小箭头是一个分体按钮：箭头展开其他上传方式（剪贴板、URL）。不用「⋯」：紧挨着「…」会像重复了一遍。
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import { uiPlatform } from '@/utils/platform';

defineEmits<{
  pick: [];
  paste: [];
  url: [];
}>();

const pasteKeys = uiPlatform() === 'macos' ? '⌘V' : 'Ctrl+V';
</script>

<template>
  <section class="drop-bar" aria-label="投放区">
    <PnIcon name="cloudUpload" :size="18" class="drop-bar__icon" />
    <span class="drop-bar__text">
      拖入图片，或按
      <kbd class="drop-bar__kbd">{{ pasteKeys }}</kbd>
      粘贴
    </span>
    <div class="drop-bar__spacer" />
    <div class="drop-bar__split">
      <button type="button" class="drop-bar__pick" @click="$emit('pick')">选择文件…</button>
      <PnMenu align="end" :width="200">
        <template #trigger>
          <button type="button" class="drop-bar__more" aria-label="其他上传方式" title="上传剪贴板图片 · 从 URL 下载">
            <PnIcon name="chevronDown" :size="12" :stroke="2.2" />
          </button>
        </template>
        <PnMenuItem :hint="pasteKeys" @select="$emit('paste')">上传剪贴板图片</PnMenuItem>
        <PnMenuItem @select="$emit('url')">从 URL 下载…</PnMenuItem>
      </PnMenu>
    </div>
  </section>
</template>

<style scoped>
.drop-bar {
  display: flex;
  align-items: center;
  gap: var(--pn-space-12);
  height: var(--pn-size-drop-bar);
  box-sizing: border-box;
  padding: 0 var(--pn-space-sidebar-x) 0 var(--pn-space-drop-bar-left);
  border: var(--pn-border-dashed) dashed var(--pn-border-strong);
  border-radius: var(--pn-radius-xl);
}

.drop-bar__icon { flex: none; color: var(--pn-brand-text); }

.drop-bar__text { font-weight: var(--pn-weight-medium); }

.drop-bar__kbd {
  padding: var(--pn-space-1) var(--pn-space-6);
  border-radius: var(--pn-radius-kbd);
  background: var(--pn-kbd-bg);
  box-shadow: inset 0 0 0 1px var(--pn-border);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
  font-weight: var(--pn-weight-medium);
}

.drop-bar__spacer { flex: 1; }

.drop-bar__split {
  display: flex;
  align-items: center;
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-secondary-bg);
  box-shadow: var(--pn-secondary-ring);
}

.drop-bar__pick,
.drop-bar__more {
  height: var(--pn-size-button-md);
  border: 0;
  background: transparent;
  font: inherit;
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.drop-bar__pick {
  padding: 0 var(--pn-space-sidebar-x);
  border-radius: var(--pn-radius-button-sm) 0 0 var(--pn-radius-button-sm);
  color: var(--pn-text1);
  font-weight: var(--pn-weight-medium);
}

.drop-bar__more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-button-sm);
  padding: 0;
  border-radius: 0 var(--pn-radius-button-sm) var(--pn-radius-button-sm) 0;
  box-shadow: inset 1px 0 0 var(--pn-border);
  color: var(--pn-text2);
}

/* 白底描边的分体按钮：悬停 / 按下同次按钮；箭头展开时同设计稿的展开态 */
.drop-bar__pick:hover,
.drop-bar__more:hover { background: var(--pn-secondary-hover); }

.drop-bar__pick:active,
.drop-bar__more:active,
.drop-bar__more[data-state='open'] { background: var(--pn-secondary-press); }
</style>
