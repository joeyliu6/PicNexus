<script setup lang="ts">
// 全局确认框：画 confirmStore 队首的那一个（useConfirm 的所有调用都走这里）
import { computed } from 'vue';
import PnButton from './PnButton.vue';
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
    <span v-if="request.code" class="pn-confirm__code">{{ request.code }}</span>
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

/* HostsScreen.dc.html 的 P12：浅灰底、圆角 8、内边距 8/10、12px 等宽 */
.pn-confirm__code {
  padding: var(--pn-space-8) var(--pn-space-code-x);
  border-radius: var(--pn-radius-md);
  background: var(--pn-subtle);
  font-family: var(--pn-font-mono);
  font-size: var(--pn-text-mono);
  overflow-wrap: anywhere;
  white-space: pre-line;
}
</style>
