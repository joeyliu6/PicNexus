<script setup lang="ts">
// 补充备份弹窗（HealthScreen.dc.html L15，交接说明第 4 节规则 8）：范围固定为「仅有 1 份的图片」，只问「复制到」哪个图床。
// 单选，每行 HostIcon + 名称 + 已有张数；有警示的（登录过期等）变淡、写原因、不可选。
// 不推荐图床：按配置顺序列出；默认选能复制过去最多张的那个可选图床（那 1 份就在它上面的图选了也是跳过），一样多取靠前的。
import { computed, ref, watch } from 'vue';
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui';
import HostIcon from '@/components/biz/HostIcon.vue';
import PnButton from '@/components/pn/PnButton.vue';
import PnDialog from '@/components/pn/PnDialog.vue';
import { formatCount } from '@/utils/formatters';
import { minutesText } from './healthModel';
import { BACKUP_SECONDS_PER_IMAGE } from './useSupplementBackup';

export interface BackupTarget {
  id: string;
  name: string;
  /** 这个图床上已有几张 */
  count: number;
  /** 不可选的原因（「登录已过期，暂不可选」）；可选时为空 */
  blocked: string | null;
  /** 「仅有 1 份」的图里，在这个图床上已有一份（含失效的那份）的张数：选它时这些会被跳过 */
  holds: number;
}

const open = defineModel<boolean>('open', { required: true });

const props = defineProps<{
  /** 仅有 1 份的图片数 */
  total: number;
  targets: readonly BackupTarget[];
}>();

const emit = defineEmits<{ start: [hostId: string] }>();

const picked = ref('');
watch(open, (isOpen) => {
  if (!isOpen) return;
  let best: BackupTarget | null = null;
  for (const t of props.targets) if (!t.blocked && (!best || t.holds < best.holds)) best = t;
  picked.value = best?.id ?? '';
}, { immediate: true });

/** 预计时间按选中的图床真正要复制的张数算（那 1 份已在它上面的会被跳过） */
const estimate = computed(() => {
  const holds = props.targets.find((t) => t.id === picked.value)?.holds ?? 0;
  return minutesText(Math.max(0, props.total - holds) * BACKUP_SECONDS_PER_IMAGE);
});

function start(): void {
  if (!picked.value) return;
  open.value = false;
  emit('start', picked.value);
}
</script>

<template>
  <PnDialog v-model:open="open" title="补充备份" :eyebrow="`${formatCount(total)} 张图片仅有 1 份`" icon="backupCopy">
    <span>将这些图片复制到另一个图床。仅复制，不删除或修改原图；目标图床上已有的图片自动跳过。</span>
    <div class="backup-dialog__section">
      <span class="backup-dialog__label">复制到</span>
      <RadioGroupRoot v-model="picked" class="backup-dialog__box" aria-label="复制到">
        <div class="backup-dialog__scroll">
          <RadioGroupItem
            v-for="target in targets"
            :key="target.id"
            :value="target.id"
            :disabled="!!target.blocked"
            class="backup-dialog__target"
          >
            <span class="backup-dialog__plate"><HostIcon :host="target.id" :size="18" /></span>
            <span class="backup-dialog__text">
              <span class="backup-dialog__name">{{ target.name }}</span>
              <span class="backup-dialog__sub" :class="{ 'backup-dialog__sub--warning': target.blocked }">{{ target.blocked ?? `已有 ${formatCount(target.count)} 张` }}</span>
            </span>
            <span class="backup-dialog__radio"><RadioGroupIndicator class="backup-dialog__dot" /></span>
          </RadioGroupItem>
        </div>
      </RadioGroupRoot>
    </div>
    <span class="backup-dialog__note">预计 {{ estimate }}，在后台进行；进度显示在本页和传输中心。</span>

    <template #footer>
      <PnButton variant="secondary" size="dialog" @click="open = false">取消</PnButton>
      <PnButton variant="primary" size="dialog" :disabled="!picked" @click="start">开始备份</PnButton>
    </template>
  </PnDialog>
</template>

<style scoped>
.backup-dialog__section { display: flex; flex-direction: column; gap: var(--pn-space-6); }
.backup-dialog__label { font-size: var(--pn-text-footnote); font-weight: var(--pn-weight-medium); color: var(--pn-text2); }

.backup-dialog__box {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--pn-radius-lg);
  box-shadow: 0 0 0 1px var(--pn-border);
}

.backup-dialog__scroll { max-height: var(--pn-size-dialog-list-max); overflow-y: auto; }

.backup-dialog__target {
  display: flex;
  gap: var(--pn-space-12);
  align-items: center;
  width: 100%;
  min-height: var(--pn-size-dialog-list-row);
  box-sizing: border-box;
  padding: var(--pn-space-target-row);
  border: 0;
  background: transparent;
  color: var(--pn-text1);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.backup-dialog__target + .backup-dialog__target { box-shadow: inset 0 1px 0 var(--pn-border); }
.backup-dialog__target[data-disabled] { opacity: var(--pn-opacity-target-disabled); cursor: default; }

.backup-dialog__target:focus-visible {
  outline: var(--pn-ring-width) solid var(--pn-ring);
  outline-offset: calc(-1 * var(--pn-ring-width));
}

.backup-dialog__plate {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-target-plate);
  height: var(--pn-size-target-plate);
  border-radius: var(--pn-radius-button-sm);
  background: var(--pn-subtle);
  box-shadow: 0 0 0 1px var(--pn-hairline);
}

.backup-dialog__text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.backup-dialog__name { font-weight: var(--pn-weight-medium); }
.backup-dialog__sub { font-size: var(--pn-text-footnote); color: var(--pn-text3); }
.backup-dialog__sub--warning { color: var(--pn-warning); }

.backup-dialog__radio {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--pn-size-radio-lg);
  height: var(--pn-size-radio-lg);
  box-sizing: border-box;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1.5px var(--pn-border-strong);
}

.backup-dialog__target[data-state="checked"] .backup-dialog__radio { background: var(--pn-brand); box-shadow: none; }

.backup-dialog__dot {
  width: var(--pn-size-radio-lg-dot);
  height: var(--pn-size-radio-lg-dot);
  border-radius: 50%;
  background: var(--pn-on-fill);
}

.backup-dialog__note { font-size: var(--pn-text-footnote); color: var(--pn-text3); }
</style>
