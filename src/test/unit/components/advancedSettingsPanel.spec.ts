import { describe, expect, it } from 'vitest';
import { mountWithDefaults } from '../../helpers/vueMount';
import AdvancedSettingsPanel from '../../../components/settings/AdvancedSettingsPanel.vue';
import { DEFAULT_CONFIG } from '../../../config/types';

const ImageCompressionStub = {
  props: ['imageCompression'],
  emits: ['update:imageCompression'],
  template: '<div class="compression-stub" />',
};

const ExternalEditorStub = {
  props: ['editorServer', 'executablePath', 'embedded'],
  emits: ['update:editorServer', 'navigateHosting', 'save'],
  template: `
    <div class="editor-stub">
      <button class="navigate-hosting-btn" @click="$emit('navigateHosting')">nav</button>
      <button class="save-btn" @click="$emit('save')">save</button>
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
    const wrapper = mountWithDefaults(AdvancedSettingsPanel, {
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
    const wrapper = mountWithDefaults(AdvancedSettingsPanel, {
      props: baseProps,
      global: {
        stubs: {
          ImageCompressionPanel: ImageCompressionStub,
          ExternalEditorPanel: ExternalEditorStub,
        },
      },
    });

    await wrapper.get('.navigate-hosting-btn').trigger('click');

    expect(wrapper.emitted('navigateHosting')).toHaveLength(1);
  });
});
