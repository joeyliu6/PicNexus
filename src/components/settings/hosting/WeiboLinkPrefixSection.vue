<script setup lang="ts">
import { computed } from 'vue';
import InputText from 'primevue/inputtext';
import Checkbox from 'primevue/checkbox';
import RadioButton from 'primevue/radiobutton';
import Button from 'primevue/button';

interface Props {
  linkPrefixEnabled: boolean;
  prefixList: string[];
  selectedPrefixIndex: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:linkPrefixEnabled': [enabled: boolean];
  'update:prefixList': [list: string[]];
  'update:selectedPrefixIndex': [index: number];
  save: [];
  addPrefix: [];
  removePrefix: [index: number];
  resetToDefault: [];
}>();

const localLinkPrefixEnabled = computed({
  get: () => props.linkPrefixEnabled,
  set: (val) => emit('update:linkPrefixEnabled', val)
});

const localSelectedPrefixIndex = computed({
  get: () => props.selectedPrefixIndex,
  set: (val) => emit('update:selectedPrefixIndex', val)
});

function handlePrefixChange(index: number, value: string) {
  const newList = [...props.prefixList];
  newList[index] = value;
  emit('update:prefixList', newList);
}
</script>

<template>
  <div class="card-subsection">
    <label class="subsection-title">链接前缀</label>
    <p class="subsection-hint">为微博图片添加代理前缀以绕过防盗链限制。</p>

    <div class="flex items-center gap-2 mb-3">
      <Checkbox
        v-model="localLinkPrefixEnabled"
        :binary="true"
        inputId="prefix-enable"
        @change="emit('save')"
      />
      <label for="prefix-enable" class="font-medium cursor-pointer">启用链接前缀</label>
    </div>

    <div v-if="linkPrefixEnabled" class="prefix-list">
      <div v-for="(prefix, idx) in prefixList" :key="idx" class="prefix-row">
        <RadioButton
          v-model="localSelectedPrefixIndex"
          :value="idx"
          :inputId="'p-' + idx"
          @change="emit('save')"
        />
        <InputText
          :modelValue="prefix"
          @update:modelValue="(val) => handlePrefixChange(idx, val as string)"
          @blur="emit('save')"
          class="flex-1"
        />
        <Button
          icon="pi pi-trash"
          @click="emit('removePrefix', idx)"
          text
          severity="danger"
          :disabled="prefixList.length <= 1"
        />
      </div>
      <div class="flex gap-2 mt-2">
        <Button
          label="添加新前缀"
          icon="pi pi-plus"
          @click="emit('addPrefix')"
          outlined
          size="small"
        />
        <Button
          label="恢复默认前缀"
          icon="pi pi-refresh"
          @click="emit('resetToDefault')"
          outlined
          severity="secondary"
          size="small"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '../../../styles/settings-shared.css';

.prefix-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prefix-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
