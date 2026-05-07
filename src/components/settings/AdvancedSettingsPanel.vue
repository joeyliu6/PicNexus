<script setup lang="ts">
import Divider from 'primevue/divider';
import ImageCompressionPanel from './ImageCompressionPanel.vue';
import ExternalEditorPanel from './ExternalEditorPanel.vue';
import CliCard from './external-editor/CliCard.vue';
import type { ImageCompressionConfig, EditorServerConfig } from '../../config/types';

interface Props {
  imageCompression: ImageCompressionConfig;
  editorServer: EditorServerConfig;
  executablePath?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:imageCompression', v: ImageCompressionConfig): void;
  (e: 'update:editorServer', v: EditorServerConfig): void;
  (e: 'save'): void;
  (e: 'navigateHosting'): void;
}>();
</script>

<template>
  <div class="advanced-settings-panel">
    <div class="section-header">
      <h2>高级设置</h2>
      <p class="section-desc">配置上传处理、命令行调用与编辑器自动上传。</p>
    </div>

    <div class="form-group">
      <label class="group-label">上传处理</label>
      <p class="helper-text">控制图片进入图床前的处理方式。</p>
      <ImageCompressionPanel
        :image-compression="props.imageCompression"
        @update:image-compression="(v: ImageCompressionConfig) => emit('update:imageCompression', v)"
      />
    </div>

    <Divider />

    <div class="form-group">
      <label class="group-label">外部集成</label>
      <p class="helper-text">让 PicNexus 从终端、脚本或编辑器中触发上传。</p>
      <div class="advanced-card-stack">
        <CliCard
          :editor-server="props.editorServer"
          :executable-path="props.executablePath"
          @update:editor-server="(v: EditorServerConfig) => emit('update:editorServer', v)"
        />
        <ExternalEditorPanel
          embedded
          :editor-server="props.editorServer"
          :executable-path="props.executablePath"
          @update:editor-server="(v: EditorServerConfig) => emit('update:editorServer', v)"
          @navigate-hosting="emit('navigateHosting')"
          @save="emit('save')"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('../../styles/settings-shared.css');

.advanced-settings-panel {
  width: 100%;
}

.advanced-card-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
</style>
