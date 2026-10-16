<script setup lang="ts">
// 背景装饰（BgDecor.dc.html）：浅色 = 小花瓣光晕，深色 = 极光。只用在首页（快传）和空状态
// （图库无图、链接健康从未检测、引导欢迎页）。整块铺满父元素，顶部按 fadeFrom→fadeTo 渐隐。
import { useId } from 'vue';

withDefaults(defineProps<{
  fadeFrom?: string;
  fadeTo?: string;
}>(), { fadeFrom: '0px', fadeTo: '48px' });

// 五片光晕花瓣：位置、角度、缩放、浓淡照抄设计稿（pa = 0.10，pb = 0.06）
const PETALS = [
  { transform: 'translate(1090 170) rotate(-30 64 64) scale(0.5)', strong: true },
  { transform: 'translate(930 150) rotate(60 64 64) scale(0.35)', strong: false },
  { transform: 'translate(170 760) rotate(40 64 64) scale(0.45)', strong: false },
  { transform: 'translate(20 520) rotate(75 64 64) scale(0.3)', strong: false },
  { transform: 'translate(1060 690) rotate(-50 64 64) scale(0.55)', strong: true },
] as const;

// 极光里的星点：坐标、半径、亮度档（a / b / c）照抄设计稿
const STARS = [
  [731, 414, 0.8, 'b'], [901, 212, 0.8, 'a'], [166, 302, 1, 'b'], [644, 345, 0.8, 'c'], [281, 225, 1.5, 'a'],
  [886, 139, 1.5, 'a'], [187, 509, 0.8, 'a'], [899, 504, 1, 'a'], [361, 504, 1, 'a'], [1084, 393, 1.5, 'b'],
  [64, 280, 1, 'b'], [112, 234, 0.8, 'c'], [793, 249, 1.2, 'b'], [949, 307, 1.2, 'a'], [574, 399, 0.8, 'b'],
  [1122, 119, 1.2, 'b'], [60, 433, 1.2, 'b'], [682, 114, 0.8, 'c'], [241, 502, 1, 'a'], [879, 491, 1.5, 'b'],
  [609, 476, 1.2, 'b'], [160, 417, 1.2, 'b'],
] as const;

const gradientId = `pn-bg-decor-${useId()}`;
</script>

<template>
  <div class="bg-decor" aria-hidden="true" :style="{ '--bg-decor-fade-from': fadeFrom, '--bg-decor-fade-to': fadeTo }">
    <div class="bg-decor__bloom" />
    <div class="bg-decor__aurora">
      <div class="bg-decor__shade" />
      <div class="bg-decor__glow bg-decor__glow--1" />
      <div class="bg-decor__glow bg-decor__glow--2" />
      <div class="bg-decor__glow bg-decor__glow--3" />
      <div class="bg-decor__glow bg-decor__glow--4" />
    </div>
    <svg class="bg-decor__art" width="100%" height="100%" viewBox="0 0 1192 900" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" class="bg-decor__stop-a" />
          <stop offset="1" class="bg-decor__stop-b" />
        </linearGradient>
      </defs>
      <g class="bg-decor__petals">
        <path
          v-for="(petal, i) in PETALS"
          :key="i"
          d="M64 58L44 29Q40 22 45 16L57 4Q64 -2 71 4L83 16Q88 22 84 29Z"
          :fill="`url(#${gradientId})`"
          :class="petal.strong ? 'bg-decor__petal--strong' : 'bg-decor__petal--soft'"
          :transform="petal.transform"
        />
      </g>
      <g class="bg-decor__stars">
        <circle v-for="(star, i) in STARS" :key="i" :cx="star[0]" :cy="star[1]" :r="star[2]" :class="`bg-decor__star--${star[3]}`" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.bg-decor {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  mask-image: linear-gradient(180deg, transparent 0, transparent var(--bg-decor-fade-from), var(--pn-mask-solid) var(--bg-decor-fade-to));
}

.bg-decor__bloom,
.bg-decor__aurora,
.bg-decor__shade,
.bg-decor__art { position: absolute; inset: 0; }

.bg-decor__bloom { background: var(--pn-decor-bloom); }

.bg-decor__aurora,
.bg-decor__stars { display: none; }

.bg-decor__shade { background: var(--pn-decor-aurora-shade); }

.bg-decor__glow { position: absolute; border-radius: 50%; }
.bg-decor__glow--1 { left: -12%; top: 53%; width: 70%; height: 46%; background: var(--pn-decor-aurora-1); transform: rotate(-14deg); filter: blur(var(--pn-decor-blur-1)); }
.bg-decor__glow--2 { left: 30%; top: 59%; width: 60%; height: 40%; background: var(--pn-decor-aurora-2); transform: rotate(-8deg); filter: blur(var(--pn-decor-blur-2)); }
.bg-decor__glow--3 { left: 62%; top: 46%; width: 50%; height: 34%; background: var(--pn-decor-aurora-3); transform: rotate(-20deg); filter: blur(var(--pn-decor-blur-3)); }
.bg-decor__glow--4 { left: 10%; top: 65%; width: 52%; height: 10%; background: var(--pn-decor-aurora-4); transform: rotate(-12deg); filter: blur(var(--pn-decor-blur-4)); }

.bg-decor__stop-a { stop-color: var(--pn-grad-a); }
.bg-decor__stop-b { stop-color: var(--pn-grad-b); }

.bg-decor__petal--strong { opacity: var(--pn-decor-petal-strong); }
.bg-decor__petal--soft { opacity: var(--pn-decor-petal-soft); }

.bg-decor__stars circle { fill: var(--pn-decor-star); }
.bg-decor__star--a { opacity: var(--pn-decor-star-a); }
.bg-decor__star--b { opacity: var(--pn-decor-star-b); }
.bg-decor__star--c { opacity: var(--pn-decor-star-c); }

/* 深色：花瓣光晕换成极光 + 星点 */
:root[data-theme='dark'] .bg-decor__bloom,
:root[data-theme='dark'] .bg-decor__petals { display: none; }

:root[data-theme='dark'] .bg-decor__aurora,
:root[data-theme='dark'] .bg-decor__stars { display: block; }
</style>
