<script setup lang="ts">
// 工具卡的小插画（HealthScreen.dc.html）：文档修复 / 补充备份 / 找不回的图片 / 自动检测，60 × 52。
// 不是渐变底 + 线条图标的图标块（交接说明第 12 节已否决），照源文件画成小场景。
import { useId } from 'vue';

defineProps<{ kind: 'doc' | 'backup' | 'lost' | 'auto' }>();

const gradientId = `pn-tool-art-${useId()}`;
</script>

<template>
  <span class="tool-card-art" aria-hidden="true">
    <svg width="60" height="52" viewBox="0 0 60 52" focusable="false">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" class="tool-card-art__stop-a" />
          <stop offset="1" class="tool-card-art__stop-b" />
        </linearGradient>
      </defs>

      <!-- 文档修复：一页文档，中间一张图，右下角刷新徽章 -->
      <template v-if="kind === 'doc'">
        <rect class="tool-card-art__paper" x="15" y="7" width="30" height="38" rx="4" />
        <rect class="tool-card-art__line" x="19" y="12" width="16" height="2" rx="1" />
        <rect class="tool-card-art__line" x="19" y="17" width="22" height="2" rx="1" />
        <rect x="19" y="23" width="22" height="13" rx="2" :fill="`url(#${gradientId})`" />
        <rect class="tool-card-art__line" x="19" y="39" width="14" height="2" rx="1" />
        <g class="tool-card-art__badge">
          <circle class="tool-card-art__badge-bg" cx="44.5" cy="37.5" r="8.5" />
          <path class="tool-card-art__badge-icon" transform="translate(40 33) scale(0.375)" d="M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5" />
        </g>
      </template>

      <!-- 补充备份：两片亮的花瓣 + 两片虚线花瓣，右下角加号徽章 -->
      <template v-else-if="kind === 'backup'">
        <g transform="translate(14 10) scale(0.25)">
          <path :fill="`url(#${gradientId})`" d="M64 58L44 29Q40 22 45 16L57 4Q64 -2 71 4L83 16Q88 22 84 29Z" />
          <path :fill="`url(#${gradientId})`" d="M70 64L99 44Q106 40 112 45L124 57Q130 64 124 71L112 83Q106 88 99 84Z" />
          <path class="tool-card-art__dashed" d="M64 70L84 99Q88 106 83 112L71 124Q64 130 57 124L45 112Q40 106 44 99Z" />
          <path class="tool-card-art__dashed" d="M58 64L29 84Q22 88 16 83L4 71Q-2 64 4 57L16 45Q22 40 29 44Z" />
        </g>
        <g class="tool-card-art__badge">
          <circle class="tool-card-art__badge-bg" cx="44.5" cy="37.5" r="8.5" />
          <path class="tool-card-art__badge-icon tool-card-art__badge-icon--bold" transform="translate(40 33) scale(0.375)" d="M12 5v14M5 12h14" />
        </g>
      </template>

      <!-- 找不回的图片：一张风景图被一道琥珀斜线划掉 -->
      <template v-else-if="kind === 'lost'">
        <clipPath :id="`${gradientId}-clip`"><rect x="13" y="12" width="34" height="28" rx="5" /></clipPath>
        <rect class="tool-card-art__paper" x="13" y="12" width="34" height="28" rx="5" />
        <g :clip-path="`url(#${gradientId}-clip)`">
          <ellipse class="tool-card-art__line" cx="22" cy="40" rx="13" ry="14" />
          <ellipse class="tool-card-art__line tool-card-art__line--soft" cx="40" cy="40" rx="13" ry="10" />
          <circle class="tool-card-art__line" cx="38" cy="20" r="3" />
        </g>
        <rect class="tool-card-art__slash" x="10" y="25" width="40" height="2" rx="1" transform="rotate(-35 30 26)" />
      </template>

      <!-- 自动检测：钟面 -->
      <template v-else>
        <g transform="translate(14 10)">
          <circle class="tool-card-art__paper tool-card-art__face" cx="16" cy="16" r="13" />
          <path class="tool-card-art__tick" d="M16 5v2M16 25v2M5 16h2M25 16h2" />
          <path class="tool-card-art__hand" d="M16 16V9.5M16 16l4.5 3" />
          <circle class="tool-card-art__pin" cx="16" cy="16" r="1.6" />
        </g>
      </template>
    </svg>
  </span>
</template>

<style scoped>
.tool-card-art {
  display: flex;
  flex: none;
  width: var(--pn-size-tool-art-w);
  height: var(--pn-size-tool-art-h);
  overflow: hidden;
  border-radius: var(--pn-radius-tool-art);
  background: var(--pn-illustration-bg);
}

.tool-card-art__stop-a { stop-color: var(--pn-grad-a); }
.tool-card-art__stop-b { stop-color: var(--pn-grad-b); }

.tool-card-art__paper {
  fill: var(--pn-paper);
  stroke: var(--pn-tool-art-paper-ring);
  stroke-width: 0.5;
  filter: var(--pn-tool-art-paper-shadow);
}

.tool-card-art__face { stroke: var(--pn-paper-line); stroke-width: 1; filter: none; }
.tool-card-art__line { fill: var(--pn-paper-line); }
.tool-card-art__line--soft { opacity: 0.7; }
.tool-card-art__slash { fill: var(--pn-warning-fill); }
.tool-card-art__badge { filter: var(--pn-tool-art-badge-shadow); }
.tool-card-art__badge-bg { fill: var(--pn-paper); }

.tool-card-art__badge-icon {
  fill: none;
  stroke: var(--pn-brand);
  stroke-width: 3.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tool-card-art__badge-icon--bold { stroke-width: 3.6; }

.tool-card-art__dashed {
  fill: none;
  stroke: var(--pn-border-strong);
  stroke-width: 5;
  stroke-dasharray: 9 7;
}

.tool-card-art__tick { fill: none; stroke: var(--pn-paper-line); stroke-width: 1.6; stroke-linecap: round; }
.tool-card-art__hand { fill: none; stroke: var(--pn-brand); stroke-width: 2; stroke-linecap: round; }
.tool-card-art__pin { fill: var(--pn-brand); }
</style>
