<script setup lang="ts">
// 渐进提示（HomeScreen.dc.html H18）：第一次用了慢的方法（点按钮选文件）之后，轻轻告诉他更快的路。
// 只出现一次，点「知道了」或 8 秒后消失；以后在命令面板里随时能查。
import { onBeforeUnmount, onMounted } from 'vue';
import { uiPlatform } from '@/utils/platform';

defineProps<{ hotkey: string }>();
const emit = defineEmits<{ dismiss: [] }>();

const AUTO_DISMISS_MS = 8000;
const pasteKeys = uiPlatform() === 'macos' ? '⌘V' : 'Ctrl+V';
let timer: ReturnType<typeof setTimeout> | null = null;

onMounted(() => { timer = setTimeout(() => emit('dismiss'), AUTO_DISMISS_MS); });
onBeforeUnmount(() => { if (timer) clearTimeout(timer); });

</script>

<template>
  <div role="status" class="fast-hint">
    <span class="fast-hint__arrow" aria-hidden="true" />
    <span class="fast-hint__title">截图后按 {{ pasteKeys }} 即可上传</span>
    <span v-if="hotkey" class="fast-hint__desc">窗口在后台时，可使用 {{ hotkey }}。</span>
    <div class="fast-hint__foot">
      <button type="button" class="fast-hint__button" @click="emit('dismiss')">知道了</button>
    </div>
  </div>
</template>

<style scoped>
.fast-hint {
  position: absolute;
  top: var(--pn-space-fast-hint-top);
  left: var(--pn-space-fast-hint-left);
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: var(--pn-space-8);
  width: var(--pn-size-fast-hint);
  box-sizing: border-box;
  padding: var(--pn-space-12) var(--pn-space-toast-left);
  border-radius: var(--pn-radius-hint);
  background: var(--pn-tooltip-bg);
  box-shadow: var(--pn-shadow-hint);
  color: var(--pn-tooltip-fg);
}

.fast-hint__arrow {
  position: absolute;
  top: calc(-1 * var(--pn-space-6));
  left: var(--pn-space-fast-hint-arrow);
  width: var(--pn-space-12);
  height: var(--pn-space-12);
  background: var(--pn-tooltip-bg);
  transform: rotate(45deg);
}

.fast-hint__title { font-weight: var(--pn-weight-semibold); }
.fast-hint__desc { font-size: var(--pn-text-footnote); opacity: 0.8; }
.fast-hint__foot { display: flex; justify-content: flex-end; }

.fast-hint__button {
  height: var(--pn-size-seg-item);
  padding: 0 var(--pn-space-sidebar-x);
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-hint-button-bg);
  color: var(--pn-tooltip-fg);
  font: inherit;
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-medium);
  transition: background-color var(--pn-dur-instant) var(--pn-ease-in);
}

.fast-hint__button:hover { background: var(--pn-hint-button-hover); }
.fast-hint__button:active { background: var(--pn-hint-button-press); }
</style>
