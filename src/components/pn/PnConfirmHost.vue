<script setup lang="ts">
// 全局确认框：画 confirmStore 队首的那一个（useConfirm 的所有调用都走这里）
import { computed } from 'vue';
import PnButton from './PnButton.vue';
import PnCheckbox from './PnCheckbox.vue';
import PnDialog from './PnDialog.vue';
import { currentConfirm, settleConfirm, type ConfirmResult } from './confirmStore';

const request = currentConfirm;

const open = computed({
  get: () => request.value !== null,
  set: (value: boolean) => { if (!value) finish('dismiss'); },
});

function finish(result: ConfirmResult) {
  if (request.value) settleConfirm(request.value.id, result);
}

const icon = computed(() => (request.value?.tone === 'brand' ? 'info' : 'warning'));
</script>

<template>
  <PnDialog
    v-if="request"
    v-model:open="open"
    :title="request.title"
    :tone="request.tone"
    :icon="icon"
  >
    <span class="pn-confirm__message">{{ request.message }}</span>
    <PnCheckbox v-if="request.clearOptOut" v-model="request.clearOptOut.checked">
      本次运行内不再提示（重启后恢复）
    </PnCheckbox>
    <template #footer>
      <PnButton variant="secondary" size="dialog" :data-autofocus="request.danger ? '' : undefined" @click="finish('reject')">
        {{ request.rejectLabel }}
      </PnButton>
      <PnButton :variant="request.danger ? 'danger' : 'primary'" size="dialog" @click="finish('accept')">
        {{ request.acceptLabel }}
      </PnButton>
    </template>
  </PnDialog>
</template>

<style>
.pn-confirm__message { white-space: pre-line; }
</style>
