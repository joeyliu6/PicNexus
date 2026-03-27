import { Plugin, Notice, Editor, MarkdownView, TFile } from 'obsidian';
import { PicNexusUploader } from './uploader';
import { PicNexusSettingTab } from './settings';
import { DEFAULT_SETTINGS, type PicNexusSettings } from './types';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'avif'];

export default class PicNexusPlugin extends Plugin {
  settings: PicNexusSettings = { ...DEFAULT_SETTINGS };
  uploader: PicNexusUploader = new PicNexusUploader(DEFAULT_SETTINGS.port);
  private statusBarEl: HTMLElement | null = null;
  private statusCheckInterval: ReturnType<typeof setInterval> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.uploader = new PicNexusUploader(this.settings.port);

    this.addSettingTab(new PicNexusSettingTab(this.app, this));

    // 状态栏
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.setText('PicNexus: ...');
    this.statusBarEl.addClass('picnexus-status');
    this.checkConnection();
    this.statusCheckInterval = setInterval(() => this.checkConnection(), 30_000);

    // 粘贴事件
    this.registerEvent(
      this.app.workspace.on('editor-paste', (evt: ClipboardEvent, editor: Editor) => {
        if (!this.settings.autoUploadOnPaste) return;
        const files = evt.clipboardData?.files;
        if (!files || files.length === 0) return;
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        evt.preventDefault();
        this.handleImageUpload(imageFiles, editor);
      })
    );

    // 拖拽事件
    this.registerEvent(
      this.app.workspace.on('editor-drop', (evt: DragEvent, editor: Editor) => {
        if (!this.settings.autoUploadOnDrop) return;
        const files = evt.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        evt.preventDefault();
        this.handleImageUpload(imageFiles, editor);
      })
    );

    // 命令：上传当前笔记中的所有本地图片
    this.addCommand({
      id: 'upload-all-local-images',
      name: '上传当前笔记中的所有本地图片',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.uploadAllLocalImages(editor, view);
      },
    });

    // 命令：测试连接
    this.addCommand({
      id: 'test-connection',
      name: '测试 PicNexus 连接',
      callback: async () => {
        try {
          const status = await this.uploader.checkStatus();
          new Notice(status.ready
            ? `PicNexus v${status.version} 已连接，图床: ${status.serviceName}`
            : 'PicNexus 已连接，但未配置图床');
        } catch {
          new Notice('无法连接 PicNexus');
        }
      },
    });
  }

  onunload(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async checkConnection(): Promise<void> {
    if (!this.statusBarEl) return;
    try {
      const status = await this.uploader.checkStatus();
      this.statusBarEl.setText(status.ready
        ? `PicNexus: ${status.serviceName || '已连接'}`
        : 'PicNexus: 未配置图床');
      this.statusBarEl.removeClass('picnexus-disconnected');
      this.statusBarEl.addClass('picnexus-connected');
    } catch {
      this.statusBarEl.setText('PicNexus: 未连接');
      this.statusBarEl.removeClass('picnexus-connected');
      this.statusBarEl.addClass('picnexus-disconnected');
    }
  }

  private async handleImageUpload(files: File[], editor: Editor): Promise<void> {
    for (const file of files) {
      const placeholder = `![Uploading ${file.name}...]()`;
      editor.replaceSelection(placeholder);

      try {
        const buffer = await file.arrayBuffer();
        const resp = await this.uploader.uploadByContent(buffer, file.name, file.type);

        if (resp.success && resp.result && resp.result.length > 0) {
          const url = resp.result[0];
          const imageLink = this.formatImageLink(file.name, url);

          const content = editor.getValue();
          const newContent = content.replace(placeholder, imageLink);
          editor.setValue(newContent);

          if (this.settings.showNotifications) {
            new Notice(`上传成功: ${file.name}`);
          }
        } else {
          const content = editor.getValue();
          editor.setValue(content.replace(placeholder, `![${file.name}]()`));
          new Notice(`上传失败: ${resp.message || '未知错误'}`);
        }
      } catch (err) {
        const content = editor.getValue();
        editor.setValue(content.replace(placeholder, `![${file.name}]()`));
        new Notice(`上传失败: ${err instanceof Error ? err.message : '连接 PicNexus 失败'}`);
      }
    }
  }

  private formatImageLink(name: string, url: string): string {
    if (this.settings.imageFormat === 'wiki') {
      return `![[${url}]]`;
    }
    return `![${name}](${url})`;
  }

  private async uploadAllLocalImages(editor: Editor, view: MarkdownView): Promise<void> {
    const file = view.file;
    if (!file) {
      new Notice('无法获取当前文件');
      return;
    }

    const content = editor.getValue();
    // 匹配 ![alt](local-path) 格式的本地图片
    const localImageRegex = /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g;
    const matches = [...content.matchAll(localImageRegex)];

    if (matches.length === 0) {
      new Notice('当前笔记中没有本地图片');
      return;
    }

    new Notice(`找到 ${matches.length} 张本地图片，开始上传...`);

    let newContent = content;
    let uploadedCount = 0;

    for (const match of matches) {
      const [fullMatch, alt, localPath] = match;
      const resolvedPath = this.resolveImagePath(localPath, file);
      if (!resolvedPath) continue;

      const imgFile = this.app.vault.getAbstractFileByPath(resolvedPath);
      if (!(imgFile instanceof TFile)) continue;

      const ext = imgFile.extension.toLowerCase();
      if (!IMAGE_EXTS.includes(ext)) continue;

      try {
        const buffer = await this.app.vault.readBinary(imgFile);
        const resp = await this.uploader.uploadByContent(
          buffer,
          imgFile.name,
          `image/${ext === 'jpg' ? 'jpeg' : ext}`
        );

        if (resp.success && resp.result && resp.result.length > 0) {
          const url = resp.result[0];
          const imageLink = this.formatImageLink(alt || imgFile.name, url);
          newContent = newContent.replace(fullMatch, imageLink);
          uploadedCount++;
        }
      } catch {
        // 跳过失败的，继续处理其他
      }
    }

    if (uploadedCount > 0) {
      editor.setValue(newContent);
      new Notice(`成功上传 ${uploadedCount}/${matches.length} 张图片`);
    } else {
      new Notice('没有成功上传任何图片');
    }
  }

  private resolveImagePath(localPath: string, currentFile: TFile): string | null {
    if (localPath.startsWith('./') || localPath.startsWith('../')) {
      const dir = currentFile.parent?.path || '';
      const parts = [...dir.split('/'), ...localPath.split('/')];
      const resolved: string[] = [];
      for (const part of parts) {
        if (part === '.' || part === '') continue;
        if (part === '..') { resolved.pop(); continue; }
        resolved.push(part);
      }
      return resolved.join('/');
    }
    return localPath;
  }
}
