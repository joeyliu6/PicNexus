import { describe, expect, it } from 'vitest';
import { mountWithDefaults } from '../helpers/vueMount';
import AdvancedSettingsPanel from '@/components/settings/AdvancedSettingsPanel.vue';
import { DEFAULT_CONFIG } from '@/config/types';

const ImageCompressionStub = {
  props: ['imageCompression'],
  emits: ['update:imageCompression'],
  template: '<div class="compression-stub">图片压缩</div>',
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

const CliCardStub = {
  props: ['editorServer', 'executablePath'],
  emits: ['update:editorServer'],
  template: '<div class="cli-stub">命令行 CLI</div>',
};

describe('AdvancedSettingsPanel', () => {
  const baseProps = {
    imageCompression: { ...DEFAULT_CONFIG.imageCompression! },
    editorServer: { ...DEFAULT_CONFIG.editorServer! },
    executablePath: 'C:/PicNexus/picnexus.exe',
  };

  it('renders the advanced setting categories and page description', () => {
    const wrapper = mountWithDefaults(AdvancedSettingsPanel, {
      props: baseProps,
      global: {
        stubs: {
          ImageCompressionPanel: ImageCompressionStub,
          CliCard: CliCardStub,
          ExternalEditorPanel: ExternalEditorStub,
        },
      },
    });

    expect(wrapper.text()).toContain('高级设置');
    expect(wrapper.text()).toContain('配置上传处理、命令行调用与编辑器自动上传。');
    expect(wrapper.text()).toContain('上传处理');
    expect(wrapper.text()).toContain('控制图片进入图床前的处理方式。');
    expect(wrapper.text()).toContain('图片压缩');
    expect(wrapper.text()).toContain('外部集成');
    expect(wrapper.text()).toContain('让 PicNexus 从终端、脚本或编辑器中触发上传。');
    expect(wrapper.text()).toContain('命令行 CLI');
    expect(wrapper.text()).not.toContain('定制你的工作流');
    expect(wrapper.text()).not.toContain('在终端指定图床上传，适合脚本和外部工具调用。');
    expect(wrapper.text()).not.toContain('外部编辑器');
  });

  it('forwards editor actions to parent events', async () => {
    const wrapper = mountWithDefaults(AdvancedSettingsPanel, {
      props: baseProps,
      global: {
        stubs: {
          ImageCompressionPanel: ImageCompressionStub,
          CliCard: CliCardStub,
          ExternalEditorPanel: ExternalEditorStub,
        },
      },
    });

    await wrapper.get('.navigate-hosting-btn').trigger('click');

    expect(wrapper.emitted('navigateHosting')).toHaveLength(1);
  });

  it('renders upload preprocessing and external entry cards in order', () => {
    const wrapper = mountWithDefaults(AdvancedSettingsPanel, {
      props: baseProps,
      global: {
        stubs: {
          ImageCompressionPanel: ImageCompressionStub,
          CliCard: CliCardStub,
          ExternalEditorPanel: ExternalEditorStub,
        },
      },
    });

    const html = wrapper.html();
    expect(html.indexOf('上传处理')).toBeLessThan(html.indexOf('图片压缩'));
    expect(html.indexOf('图片压缩')).toBeLessThan(html.indexOf('外部集成'));
    expect(html.indexOf('外部集成')).toBeLessThan(html.indexOf('命令行 CLI'));
    expect(html.indexOf('compression-stub')).toBeLessThan(html.indexOf('cli-stub'));
    expect(html.indexOf('cli-stub')).toBeLessThan(html.indexOf('editor-stub'));
  });
});
