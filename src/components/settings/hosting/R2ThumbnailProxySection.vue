<script setup lang="ts">
import { computed } from 'vue';
import ToggleSwitch from 'primevue/toggleswitch';

interface Props {
  enabled: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:enabled': [enabled: boolean];
  save: [];
}>();

const localEnabled = computed({
  get: () => props.enabled,
  set: (v) => {
    emit('update:enabled', v);
    emit('save');
  }
});
</script>

<template>
  <div class="card-subsection">
    <div class="subsection-title-row">
      <div class="subsection-title-text">
        <label class="subsection-title">用第三方服务加速缩略图</label>
        <span class="subsection-hint">
          开启后由 wsrv.nl 代为缩图，列表和时间轴加载更快，代价是图片地址会发送给这个第三方服务（代理不可用时会自动回退到原图）；关闭则始终直接加载原图，更私密，但图多时会变慢
        </span>
      </div>
      <ToggleSwitch v-model="localEnabled" />
    </div>
  </div>
</template>

<style scoped>
@import url('../../../styles/settings-shared.css');
</style>
