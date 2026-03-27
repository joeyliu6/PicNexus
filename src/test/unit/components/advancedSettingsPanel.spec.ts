import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import AdvancedSettingsPanel from '../../../components/settings/AdvancedSettingsPanel.vue';
import { DEFAULT_CONFIG } from '../../../config/types';

const ImageCompressionStub = {
  props: ['imageCompression'],
  emits: ['update:imageCompression'],
  template: '<div class="compression-stub" />',
};

const ExternalEditorStub = {
  props: ['editorServer', 'executablePath', 'applyState', 'embedded'],
  emits: ['update:editorServer', 'retryApply', 'navigateHosting'],
  template: `
    <div class="editor-stub">
      <button class="retry-apply-btn" @click="$emit('retryApply')">retry</button>
      <button class="navigate-hosting-btn" @click="$emit('navigateHosting')">nav</button>
    </div>
  `,
};

describe('AdvancedSettingsPanel', () => {
  const baseProps = {
    imageCompression: { ...DEFAULT_CONFIG.imageCompression! },
    editorServer: { ...DEFAULT_CONFIG.editorServer! },
    executablePath: 'C:/PicNexus/picnexus.exe',
  };

  it('renders title and description', () => {
    const wrapper = mount(AdvancedSettingsPanel, {
      props: baseProps,
      global: {
        stubs: {
          ImageCompressionPanel: ImageCompressionStub,
          ExternalEditorPanel: ExternalEditorStub,
        },
      },
    });

    expect(wrapper.text()).toContain('高级设置');
    expect(wrapper.text()).toContain('定制你的工作流');
  });

  it('forwards editor actions to parent events', async () => {
    const wrapper = mount(AdvancedSettingsPanel, {
      props: baseProps,
      global: {
        stubs: {
          ImageCompressionPanel: ImageCompressionStub,
          ExternalEditorPanel: ExternalEditorStub,
        },
      },
    });

    await wrapper.get('.retry-apply-btn').trigger('click');
    await wrapper.get('.navigate-hosting-btn').trigger('click');

    expect(wrapper.emitted('retryEditorApply')).toHaveLength(1);
    expect(wrapper.emitted('navigateHosting')).toHaveLength(1);
  });
});
