<script setup lang="ts">
/**
 * 迁移底栏 — migrating / done 双态切换
 * 左槽位：运行状态 pill + MigrateStatsSummary 统计条；右槽位：操作按钮组
 * 暂停按钮三态：暂停 → 正在暂停...（disabled + spinner）→ 继续
 *
 * 运行状态 pill（替代原顶部"正在处理 / 已暂停"指示）：
 *   migrating + running → ● 运行中
 *   migrating + isPausing → ⏳ 正在暂停…
 *   migrating + isPaused → ⏸ 已暂停
 *   done → 无 pill（统计条里已有用时信息）
 */
import { computed, ref } from 'vue';
import Menu from 'primevue/menu';
import MigrateStatsSummary from './MigrateStatsSummary.vue';

interface Props {
  mode: 'migrating' | 'done';
  /** 用户已点暂停 */
  isPaused?: boolean;
  /** 已点暂停但在途条目未落定（正在暂停...） */
  isPausing?: boolean;
}

const props = withDefaults(defineProps<Props>(), { isPaused: false, isPausing: false });

type StatePillTone = 'running' | 'pausing' | 'paused';
interface StatePill { tone: StatePillTone; icon: string; label: string }

const statePill = computed<StatePill | null>(() => {
  if (props.mode !== 'migrating') return null;
  if (props.isPausing) return { tone: 'pausing', icon: 'pi pi-spin pi-spinner', label: '正在暂停…' };
  if (props.isPaused) return { tone: 'paused', icon: 'pi pi-pause-circle', label: '已暂停' };
  return { tone: 'running', icon: '', label: '运行中' };
});
const emit = defineEmits<{
  pause: [];
  resume: [];
  cancel: [];
  done: [];
  restart: [];
  export: [format: 'csv' | 'txt'];
}>();

const exportMenu = ref<InstanceType<typeof Menu> | null>(null);

const exportItems = [
  { label: 'CSV', icon: 'pi pi-file-excel', command: () => emit('export', 'csv') },
  { label: 'TXT', icon: 'pi pi-file', command: () => emit('export', 'txt') },
];

function toggleExportMenu(ev: MouseEvent) {
  exportMenu.value?.toggle(ev);
}
</script>

<template>
  <div class="bm-bottom">
    <div class="bm-left">
      <slot name="pagination" />
      <span
        v-if="statePill"
        class="bm-state-pill"
        :class="`bm-state-pill--${statePill.tone}`"
      >
        <span v-if="statePill.tone === 'running'" class="bm-state-pill__dot" />
        <i v-else :class="statePill.icon" aria-hidden="true" />
        {{ statePill.label }}
      </span>
      <MigrateStatsSummary />
    </div>
    <div class="bottom-actions">
      <template v-if="mode === 'migrating'">
        <button
          v-if="isPausing"
          class="btn-ghost bm-pause-pending"
          type="button"
          disabled
        >
          <i class="pi pi-spin pi-spinner" /> 正在暂停…
        </button>
        <button
          v-else-if="isPaused"
          class="btn-primary"
          type="button"
          @click="emit('resume')"
        >
          <i class="pi pi-play" /> 继续
        </button>
        <button
          v-else
          class="btn-ghost"
          type="button"
          @click="emit('pause')"
        >
          <i class="pi pi-pause" /> 暂停
        </button>
        <button class="btn-danger" type="button" @click="emit('cancel')">
          <i class="pi pi-times" /> 取消迁移
        </button>
      </template>
      <template v-else>
        <button class="btn-ghost" type="button" @click="toggleExportMenu">
          <i class="pi pi-download" /> 导出报告
          <i class="pi pi-angle-down bm-caret" />
        </button>
        <Menu
          ref="exportMenu"
          :model="exportItems"
          popup
          append-to="body"
        />
        <button class="btn-ghost" type="button" @click="emit('done')">
          完成
        </button>
        <button class="btn-primary" type="button" @click="emit('restart')">
          <i class="pi pi-refresh" /> 重新发起迁移
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.bm-bottom {
  margin-top: auto;
  flex-shrink: 0;
  padding-top: var(--space-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-width: 0;
}

.bm-left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.bm-state-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-xs-sm);
  border-radius: var(--radius-sm);
  font-size: var(--text-2xs);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  flex-shrink: 0;
}
.bm-state-pill i { font-size: var(--text-2xs); }

.bm-state-pill--running {
  background: var(--success-alpha-10);
  color: var(--success);
}

.bm-state-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--success);
  animation: bm-pulse var(--duration-breathe) ease-in-out infinite;
}

.bm-state-pill--pausing {
  background: var(--state-warn-bg-soft);
  color: var(--state-warn-text);
}

.bm-state-pill--paused {
  background: var(--bg-input);
  color: var(--text-muted);
}

@keyframes bm-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.bm-caret { font-size: var(--text-2xs); opacity: 0.7; }

.bm-pause-pending {
  /* 让 "正在暂停..." 外观与普通 btn-ghost 统一，只靠 disabled 降不透明度 */
  cursor: progress;
}
</style>
