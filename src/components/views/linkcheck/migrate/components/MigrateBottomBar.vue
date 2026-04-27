<script setup lang="ts">
/**
 * 迁移底栏 — migrating / done 双态切换
 * 左槽位：分页；右槽位：操作按钮组
 */
import { ref } from 'vue';
import Menu from 'primevue/menu';
import StatePill, { type StatePill as StatePillType } from '../../common/StatePill.vue';

interface Props {
  mode: 'migrating' | 'done';
  /** 用户已点暂停 */
  isPaused?: boolean;
  /** 已点暂停但在途条目未落定（正在暂停...） */
  isPausing?: boolean;
  /** 已点取消但 finalizeResult 尚未触发（正在取消...） */
  isCancelling?: boolean;
  statePill?: StatePillType | null;
  /** done 态：是否有失败项可重试（由父组件判定） */
  canRetryAll?: boolean;
  /** done 态：正在重试的条目数（>0 时禁用按钮 + 显 spinner） */
  retryingCount?: number;
}

withDefaults(defineProps<Props>(), {
  isPaused: false,
  isPausing: false,
  isCancelling: false,
  statePill: null,
  canRetryAll: false,
  retryingCount: 0,
});

const emit = defineEmits<{
  pause: [];
  resume: [];
  cancel: [];
  done: [];
  restart: [];
  retryAll: [];
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
      <StatePill :pill="statePill" />
    </div>
    <div class="bottom-actions">
      <template v-if="mode === 'migrating'">
        <!-- 暂停/继续：取消进行中时整体禁用；正在暂停中显 spinner -->
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
          :disabled="isCancelling"
          @click="emit('resume')"
        >
          <i class="pi pi-play" /> 继续
        </button>
        <button
          v-else
          class="btn-ghost"
          type="button"
          :disabled="isCancelling"
          @click="emit('pause')"
        >
          <i class="pi pi-pause" /> 暂停
        </button>
        <!-- 取消按钮：点击后切换为 disabled 的 "正在取消…" 占位（对齐 isPausing 交互） -->
        <button
          v-if="isCancelling"
          class="btn-danger bm-cancel-pending"
          type="button"
          disabled
        >
          <i class="pi pi-spin pi-spinner" /> 正在取消…
        </button>
        <button v-else class="btn-danger" type="button" @click="emit('cancel')">
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
        <button
          v-if="canRetryAll"
          class="btn-ghost"
          type="button"
          :disabled="retryingCount > 0"
          @click="emit('retryAll')"
        >
          <i v-if="retryingCount > 0" class="pi pi-spin pi-spinner" />
          <i v-else class="pi pi-refresh" />
          全部重试
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
  flex-shrink: 0;
  padding-right: var(--space-xl);
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

.bm-caret { font-size: var(--text-2xs); opacity: 0.7; }

.bm-pause-pending,
.bm-cancel-pending {
  /* 让 "正在暂停/取消..." 外观与原按钮统一，只靠 disabled 降不透明度 */
  cursor: progress;
}

</style>
