<script setup lang="ts">
// 文档修复 idle 态的「上次修复」记录卡（纯信息展示，不提供操作入口）
// 仅当 localStorage 有 lastRepair 记录时显示，可手动关闭

import Button from 'primevue/button';
import {
  useLastRepair,
  clearLastRepair,
} from '../../../../composables/md-rescue/useMdRescueLastRepair';
import { formatRelativeTime } from '../../../../utils/formatters';

const { record } = useLastRepair();

function handleDismiss() {
  clearLastRepair();
}
</script>

<template>
  <section v-if="record" class="last-repair" aria-label="上次修复">
    <div class="last-repair__icon"><i class="pi pi-history" /></div>

    <div class="last-repair__body">
      <span class="last-repair__title">
        上次修复 · {{ formatRelativeTime(record.date) }}
      </span>
      <span class="last-repair__detail">
        成功 {{ record.linksFixed }} 张，覆盖 {{ record.filesFixed }} 个文件
      </span>
    </div>

    <div class="last-repair__actions">
      <Button
        icon="pi pi-times"
        size="small"
        severity="secondary"
        text
        rounded
        aria-label="关闭"
        @click="handleDismiss"
      />
    </div>
  </section>
</template>

<style scoped>
.last-repair {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
  padding: var(--space-md) var(--space-lg);
  background: var(--state-info-bg, var(--primary-alpha-5));
  border: 1px solid var(--primary-alpha-15);
  border-radius: var(--radius-md);
}

.last-repair__icon {
  color: var(--primary);
  font-size: var(--text-lg);
  flex-shrink: 0;
}

.last-repair__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  flex: 1;
  min-width: 0;
}

.last-repair__title {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-main);
}

.last-repair__detail {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.last-repair__actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
}
</style>
