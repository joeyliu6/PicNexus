<script setup lang="ts">
// 拖放悬停遮罩（HomeScreen.dc.html H07）：盖住主栏，侧栏保持可见（表示「还在当前页」）。
// 夹带的非图片文件提前说明会被跳过；没有可用图床时写「先启用一个图床」，不上传。
import { computed } from 'vue';
import { useUploadController } from '@/composables/upload/useUploadController';
import type { DropOverlayState } from './useGlobalUploadInput';

const props = defineProps<{ state: DropOverlayState }>();

const upload = useUploadController();
const selected = computed(() => upload.hosts.value.filter((h) => h.selected).map((h) => h.name));
const noHost = computed(() => selected.value.length === 0);
const compressionText = computed(() => (upload.compression.value.enabled ? upload.activePreset.value.name : '关'));
const count = computed(() => Math.max(props.state.imageCount, 1));
</script>

<template>
  <div v-if="state.active" class="drop-overlay" aria-live="polite">
    <div class="drop-overlay__zone">
      <div class="drop-overlay__art" aria-hidden="true">
        <div class="drop-overlay__photo drop-overlay__photo--back">
          <div class="drop-overlay__scene drop-overlay__scene--sunset">
            <span class="drop-overlay__sun" />
            <span class="drop-overlay__hill drop-overlay__hill--far" />
            <span class="drop-overlay__hill drop-overlay__hill--near" />
          </div>
        </div>
        <div class="drop-overlay__photo drop-overlay__photo--front">
          <div class="drop-overlay__scene drop-overlay__scene--day">
            <span class="drop-overlay__sun" />
            <span class="drop-overlay__hill drop-overlay__hill--far" />
            <span class="drop-overlay__hill drop-overlay__hill--near" />
          </div>
        </div>
        <span class="drop-overlay__count">{{ count }}</span>
      </div>
      <template v-if="noHost">
        <div class="drop-overlay__title">先启用一个图床</div>
        <div class="drop-overlay__desc">在「上传到」里勾选一个图床后再拖入</div>
      </template>
      <template v-else-if="state.imageCount === 0">
        <div class="drop-overlay__title">没有可上传的图片</div>
        <div class="drop-overlay__desc">{{ state.skippedText }}</div>
      </template>
      <template v-else>
        <div class="drop-overlay__title">松开上传</div>
        <div class="drop-overlay__desc">上传到 {{ selected.join('、') }} · 压缩：{{ compressionText }}</div>
        <div v-if="state.skippedText" class="drop-overlay__note">{{ state.skippedText }}</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: var(--pn-z-drop-overlay);
  display: flex;
  padding: var(--pn-space-toast-left);
  background: var(--pn-drag-veil);
}

.drop-overlay__zone {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--pn-space-toast-left);
  border: var(--pn-ring-width) dashed var(--pn-brand);
  border-radius: var(--pn-radius-panel);
  background: var(--pn-brand-soft);
}

.drop-overlay__art { position: relative; width: var(--pn-size-drop-art-w); height: var(--pn-size-drop-art-h); }

.drop-overlay__photo {
  position: absolute;
  width: var(--pn-size-drop-photo-w);
  height: var(--pn-size-drop-photo-h);
  box-sizing: border-box;
  padding: var(--pn-space-4);
  border-radius: var(--pn-radius-md);
  background: var(--pn-drop-photo-frame);
  box-shadow: var(--pn-e3);
}

.drop-overlay__photo--back { top: var(--pn-space-drop-back-top); left: var(--pn-space-16); transform: rotate(-10deg); }
.drop-overlay__photo--front { top: var(--pn-space-8); left: var(--pn-space-drop-front-left); transform: rotate(6deg); }

.drop-overlay__scene { position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: var(--pn-radius-xs); }
.drop-overlay__scene--sunset { background: var(--pn-drop-sky-sunset); }
.drop-overlay__scene--day { background: var(--pn-drop-sky-day); }

.drop-overlay__sun {
  position: absolute;
  top: 16%;
  right: 16%;
  width: var(--pn-size-drop-sun);
  height: var(--pn-size-drop-sun);
  border-radius: 50%;
}

.drop-overlay__scene--sunset .drop-overlay__sun { background: var(--pn-drop-sun-sunset); }
.drop-overlay__scene--day .drop-overlay__sun { background: var(--pn-drop-sun-day); }

.drop-overlay__hill { position: absolute; bottom: 0; width: 80%; }
.drop-overlay__hill--far { left: -12%; height: 62%; clip-path: polygon(0 100%, 48% 8%, 100% 100%); }
.drop-overlay__hill--near { left: 34%; height: 46%; clip-path: polygon(0 100%, 50% 0, 100% 100%); }
.drop-overlay__scene--sunset .drop-overlay__hill--far { background: var(--pn-drop-hill-sunset-far); }
.drop-overlay__scene--sunset .drop-overlay__hill--near { background: var(--pn-drop-hill-sunset-near); }
.drop-overlay__scene--day .drop-overlay__hill--far { background: var(--pn-drop-hill-day-far); }
.drop-overlay__scene--day .drop-overlay__hill--near { background: var(--pn-drop-hill-day-near); }

.drop-overlay__count {
  position: absolute;
  top: calc(-1 * var(--pn-space-2));
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: var(--pn-size-drop-count);
  height: var(--pn-size-drop-count);
  box-sizing: border-box;
  padding: 0 var(--pn-space-drop-count-x);
  border-radius: var(--pn-size-drop-count);
  background: var(--pn-button);
  color: var(--pn-on-fill);
  font-size: var(--pn-text-footnote);
  font-weight: var(--pn-weight-semibold);
}

.drop-overlay__title {
  font-size: var(--pn-text-title);
  font-weight: var(--pn-weight-semibold);
  line-height: var(--pn-leading-title);
  letter-spacing: var(--pn-tracking-title);
}

.drop-overlay__desc { color: var(--pn-text2); }
.drop-overlay__note { font-size: var(--pn-text-footnote); color: var(--pn-text3); }
</style>
