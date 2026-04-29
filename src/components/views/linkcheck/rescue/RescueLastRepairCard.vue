<script setup lang="ts">
// 文档修复 idle 态的「上次修复」记录卡
// 仅当 localStorage 有 lastRepair 记录时显示，可手动关闭

import { ref, watch } from 'vue';
import Button from 'primevue/button';
import {
  useLastRepair,
  clearLastRepair,
  saveLastRepair,
  undoLastRepair,
  isLastRepairRestorable,
} from '../../../../composables/md-rescue/useMdRescueLastRepair';
import { useToast } from '../../../../composables/useToast';
import { formatRelativeTime } from '../../../../utils/formatters';

const { record } = useLastRepair();
const toast = useToast();

const isCheckingRestorable = ref(false);
const isRestorable = ref(false);
const isUndoing = ref(false);
let restorableCheckSeq = 0;

watch(record, async (next) => {
  const seq = ++restorableCheckSeq;
  isRestorable.value = false;
  if (!next) {
    isCheckingRestorable.value = false;
    return;
  }

  isCheckingRestorable.value = true;
  const ok = await isLastRepairRestorable(next);
  if (seq !== restorableCheckSeq) return;
  isRestorable.value = ok;
  isCheckingRestorable.value = false;
}, { immediate: true });

function handleDismiss() {
  clearLastRepair();
}

async function handleUndo() {
  const current = record.value;
  if (!current || isUndoing.value) return;

  isUndoing.value = true;
  try {
    const result = await undoLastRepair(current);
    if (result.failed === 0) {
      clearLastRepair();
      toast.success(
        '已撤销上次修复',
        result.restored > 0 ? `已恢复 ${result.restored} 个文件` : '没有需要恢复的文件',
      );
    } else if (result.restored > 0) {
      saveLastRepair({
        ...current,
        filesFixed: result.failedPairs.length,
        fileBackupMap: result.failedPairs,
      });
      toast.warn('部分撤销失败', `已恢复 ${result.restored} 个，${result.failed} 个失败`);
    } else {
      toast.error('撤销失败', `${result.failed} 个文件恢复失败`);
    }
  } catch (err) {
    toast.error('撤销失败', String(err));
  } finally {
    isUndoing.value = false;
  }
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
        label="撤销"
        icon="pi pi-undo"
        size="small"
        severity="secondary"
        outlined
        :loading="isUndoing"
        :disabled="isCheckingRestorable || !isRestorable"
        @click="handleUndo"
      />
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
