import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type PicNexusPlugin from './main';

export class PicNexusSettingTab extends PluginSettingTab {
  plugin: PicNexusPlugin;

  constructor(app: App, plugin: PicNexusPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 连接配置
    new Setting(containerEl)
      .setName('端口')
      .setDesc('PicNexus HTTP Server 的监听端口（默认 36799）')
      .addText(text =>
        text
          .setPlaceholder('36799')
          .setValue(String(this.plugin.settings.port))
          .onChange(async (value) => {
            const port = parseInt(value, 10);
            if (!isNaN(port) && port >= 1024 && port <= 65535) {
              this.plugin.settings.port = port;
              this.plugin.uploader.updatePort(port);
              await this.plugin.saveSettings();
            }
          })
      );

    // 测试连接
    new Setting(containerEl)
      .setName('测试连接')
      .setDesc('检查 PicNexus 服务是否可用')
      .addButton(button =>
        button
          .setButtonText('测试')
          .setCta()
          .onClick(async () => {
            try {
              const status = await this.plugin.uploader.checkStatus();
              if (status.ready) {
                new Notice(`PicNexus 已连接 (v${status.version})，当前图床: ${status.serviceName || '未配置'}`);
              } else {
                new Notice('PicNexus 已连接，但未配置图床');
              }
            } catch {
              new Notice('无法连接 PicNexus，请确认服务已启动');
            }
          })
      );

    new Setting(containerEl)
      .setName('上传行为')
      .setHeading();

    new Setting(containerEl)
      .setName('粘贴时自动上传')
      .setDesc('粘贴图片时自动上传到图床')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.autoUploadOnPaste)
          .onChange(async (value) => {
            this.plugin.settings.autoUploadOnPaste = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('拖拽时自动上传')
      .setDesc('拖拽图片到编辑器时自动上传')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.autoUploadOnDrop)
          .onChange(async (value) => {
            this.plugin.settings.autoUploadOnDrop = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('上传通知')
      .setDesc('上传成功或失败时显示通知')
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.showNotifications)
          .onChange(async (value) => {
            this.plugin.settings.showNotifications = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('图片链接格式')
      .setDesc('插入图片时使用的格式')
      .addDropdown(dropdown =>
        dropdown
          .addOption('markdown', 'Markdown: ![](url)')
          .addOption('wiki', 'Wiki: ![[url]]')
          .setValue(this.plugin.settings.imageFormat)
          .onChange(async (value) => {
            this.plugin.settings.imageFormat = value as 'markdown' | 'wiki';
            await this.plugin.saveSettings();
          })
      );
  }
}
