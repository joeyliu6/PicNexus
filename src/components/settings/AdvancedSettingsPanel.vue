<script setup lang="ts">
import Divider from 'primevue/divider';
import ImageCompressionPanel from './ImageCompressionPanel.vue';
import ExternalEditorPanel from './ExternalEditorPanel.vue';
import type { ImageCompressionConfig, EditorServerConfig } from '../../config/types';

interface EditorApplyFeedbackState {
  status: 'idle' | 'applying' | 'applied' | 'error';
  message?: string;
  updatedAt?: number;
}

interface Props {
  imageCompression: ImageCompressionConfig;
  editorServer: EditorServerConfig;
  executablePath?: string;
  editorApplyState?: EditorApplyFeedbackState;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:imageCompression', v: ImageCompressionConfig): void;
  (e: 'update:editorServer', v: EditorServerConfig): void;
  (e: 'save'): void;
  (e: 'retryEditorApply'): void;
  (e: 'navigateHosting'): void;
}>();
</script>

<template>
  <div class="advanced-settings-panel">
    <div class="section-header">
      <h2>高级设置</h2>
      <p class="section-desc">配置图片处理与编辑器集成环境，定制你的工作流。</p>
    </div>

    <div class="form-group">
      <ImageCompressionPanel
        :image-compression="props.imageCompression"
        @update:image-compression="(v: ImageCompressionConfig) => emit('update:imageCompression', v)"
      />
    </div>

    <Divider />

    <div class="form-group">
      <label class="group-label">外部编辑器</label>
      <p class="helper-text">在常用编辑器中粘贴图片时，自动上传到图床。</p>
      <ExternalEditorPanel
        embedded
        :editor-server="props.editorServer"
        :executable-path="props.executablePath"
        :apply-state="props.editorApplyState"
        @update:editor-server="(v: EditorServerConfig) => emit('update:editorServer', v)"
        @retry-apply="emit('retryEditorApply')"
        @navigate-hosting="emit('navigateHosting')"
        @save="emit('save')"
      />
    </div>
  </div>
</template>

<style scoped>
@import '../../styles/settings-shared.css';

.advanced-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.advanced-settings-panel .section-desc {
  max-width: 680px;
}
</style>
