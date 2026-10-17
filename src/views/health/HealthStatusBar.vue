<script setup lang="ts">
// 状态栏（HealthScreen.dc.html，交接说明 8.3）：与图库工具栏同级，40 高，一句状态 + 操作。
// 有失效：琥珀点；检测中 / 修复中：转圈 + 细进度条；已暂停：暂停符号、进度条变灰。全部正常不加对勾或绿色。
// 「修复 N 张」是全页唯一主按钮；「⋯」里数量为 0 的项不出现。
import { computed } from 'vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnIcon from '@/components/pn/PnIcon.vue';
import PnMenu from '@/components/pn/PnMenu.vue';
import PnMenuItem from '@/components/pn/PnMenuItem.vue';
import PnMenuRadioGroup from '@/components/pn/PnMenuRadioGroup.vue';
import PnMenuSeparator from '@/components/pn/PnMenuSeparator.vue';
import PnMenuSub from '@/components/pn/PnMenuSub.vue';
import { formatCount } from '@/utils/formatters';
import { AUTO_CHECK_OPTIONS } from './autoCheck';
import type { HealthPageState } from './useLinkHealth';

const props = defineProps<{
  state: HealthPageState;
  title: string;
  sub: string;
  /** 0–1：检测 / 修复进度 */
  progress: number;
  total: number;
  dead: number;
  fixable: number;
  lost: number;
  canExport: boolean;
  autoCheckValue: string;
  autoCheckLabel: string;
}>();

const emit = defineEmits<{
  start: [];
  recheck: [];
  recheckDead: [];
  repair: [];
  pause: [];
  resume: [];
  cancel: [];
  export: [];
  cleanLost: [];
  autoCheck: [value: string];
}>();

const autoCheckModel = computed({
  get: () => props.autoCheckValue,
  set: (value: string) => emit('autoCheck', value),
});

const busy = computed(() => props.state === 'checking' || props.state === 'paused' || props.state === 'fixing');
</script>

<template>
  <div class="health-status" :aria-busy="state === 'loading'">
    <span v-if="state === 'problems'" class="health-status__dot" aria-hidden="true" />
    <svg v-if="state === 'checking' || state === 'fixing'" class="health-status__spin" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" class="health-status__spin-track" />
      <circle cx="8" cy="8" r="6" class="health-status__spin-head" transform="rotate(-90 8 8)" />
    </svg>
    <PnIcon v-if="state === 'paused'" name="pause" :size="13" :stroke="2.8" class="health-status__pause" />
    <span class="health-status__title" aria-live="polite">{{ title }}</span>
    <span class="health-status__sub">{{ sub }}</span>
    <div
      v-if="busy"
      class="health-status__bar"
      :class="{ 'health-status__bar--paused': state === 'paused' }"
      role="progressbar"
      aria-label="进度"
      :aria-valuenow="Math.round(progress * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span :style="{ width: `${progress * 100}%` }" />
    </div>
    <div class="health-status__spacer" />

    <template v-if="state === 'never'">
      <PnButton variant="primary" size="md" :disabled="total === 0" @click="emit('start')">开始检测</PnButton>
    </template>
    <template v-else-if="state === 'checking'">
      <PnButton size="md" @click="emit('pause')">暂停</PnButton>
    </template>
    <template v-else-if="state === 'paused'">
      <PnButton size="md" @click="emit('cancel')">取消</PnButton>
      <PnButton variant="primary" size="md" @click="emit('resume')">继续</PnButton>
    </template>
    <template v-else-if="state === 'problems' || state === 'good'">
      <PnButton size="md" @click="emit('recheck')">重新检测</PnButton>
      <PnButton v-if="fixable > 0" variant="primary" size="md" @click="emit('repair')">修复 {{ formatCount(fixable) }} 张</PnButton>
    </template>

    <PnMenu v-if="!busy && state !== 'loading'" :width="280">
      <template #trigger>
        <button type="button" class="health-status__more" aria-label="更多" aria-haspopup="menu">
          <PnIcon name="more" :size="15" :stroke="2" />
        </button>
      </template>
      <PnMenuItem v-if="dead > 0" @select="emit('recheckDead')">仅重新检测 {{ formatCount(dead) }} 张失效图片</PnMenuItem>
      <PnMenuItem v-if="canExport" @select="emit('export')">导出结果（CSV）</PnMenuItem>
      <PnMenuSub label="自动检测" :value="autoCheckLabel" :width="160">
        <PnMenuRadioGroup v-model="autoCheckModel" :options="AUTO_CHECK_OPTIONS" />
      </PnMenuSub>
      <template v-if="lost > 0">
        <PnMenuSeparator />
        <PnMenuItem danger :description="`只含「图片已不存在」的 ${formatCount(lost)} 张，不含超时与拒绝访问`" @select="emit('cleanLost')">清理找不回的图片…</PnMenuItem>
      </template>
    </PnMenu>
  </div>
</template>

<style scoped>
.health-status {
  display: flex;
  gap: var(--pn-space-health-status-gap);
  align-items: center;
  min-width: 0;
  height: var(--pn-size-health-status);
}

.health-status__dot {
  flex: none;
  width: var(--pn-size-health-dot);
  height: var(--pn-size-health-dot);
  border-radius: 50%;
  background: var(--pn-warning-fill);
}

.health-status__spin {
  flex: none;
  width: var(--pn-size-health-spinner);
  height: var(--pn-size-health-spinner);
  color: var(--pn-brand-text);
  animation: k-spin var(--pn-dur-spin) linear infinite;
}

.health-status__spin-track { fill: none; stroke: currentcolor; stroke-opacity: 0.22; stroke-width: 2; }
.health-status__spin-head { fill: none; stroke: currentcolor; stroke-width: 2; stroke-dasharray: 10 37.7; stroke-linecap: round; }
.health-status__pause { flex: none; color: var(--pn-text2); }
.health-status__title { flex: none; font-weight: var(--pn-weight-semibold); white-space: nowrap; }

.health-status__sub {
  min-width: 0;
  overflow: hidden;
  color: var(--pn-text2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-status__bar {
  flex: none;
  width: var(--pn-size-health-progress);
  height: var(--pn-size-progress);
  overflow: hidden;
  border-radius: var(--pn-space-2);
  background: var(--pn-track);
}

.health-status__bar > span {
  display: block;
  height: 100%;
  border-radius: var(--pn-space-2);
  background: var(--pn-brand);
  transition: width var(--pn-dur-standard) var(--pn-ease-in);
}

.health-status__bar--paused > span { background: var(--pn-unknown-fill); }
.health-status__spacer { flex: 1; }

.health-status__more {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-button-md);
  height: var(--pn-size-button-md);
  padding: 0;
  border: 0;
  border-radius: var(--pn-radius-button-sm);
  background: transparent;
  color: var(--pn-text2);
  cursor: pointer;
}

.health-status__more:hover,
.health-status__more[data-state="open"] { background: var(--pn-selected); }

@media (prefers-reduced-motion: reduce) {
  .health-status__spin { animation: none; }
}
</style>
