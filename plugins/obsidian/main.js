var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PicNexusPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/uploader.ts
var import_obsidian = require("obsidian");
var PicNexusUploader = class {
  baseUrl;
  constructor(port) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }
  updatePort(port) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }
  async checkStatus() {
    const resp = await (0, import_obsidian.requestUrl)({
      url: `${this.baseUrl}/status`,
      method: "GET"
    });
    return resp.json;
  }
  async uploadByPath(filePaths) {
    const resp = await (0, import_obsidian.requestUrl)({
      url: `${this.baseUrl}/upload`,
      method: "POST",
      body: JSON.stringify({ list: filePaths }),
      contentType: "application/json"
    });
    return resp.json;
  }
  async uploadByContent(data, filename, contentType) {
    const resp = await (0, import_obsidian.requestUrl)({
      url: `${this.baseUrl}/upload/file`,
      method: "POST",
      body: data,
      headers: {
        "Content-Type": contentType || "image/png",
        "X-Filename": encodeURIComponent(filename)
      }
    });
    return resp.json;
  }
};

// src/settings.ts
var import_obsidian2 = require("obsidian");
var PicNexusSettingTab = class extends import_obsidian2.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian2.Setting(containerEl).setName("\u7AEF\u53E3").setDesc("PicNexus HTTP \u670D\u52A1\u7684\u76D1\u542C\u7AEF\u53E3\uFF08\u9ED8\u8BA4 36799\uFF09").addText(
      (text) => text.setPlaceholder("36799").setValue(String(this.plugin.settings.port)).onChange(async (value) => {
        const port = parseInt(value, 10);
        if (!isNaN(port) && port >= 1024 && port <= 65535) {
          this.plugin.settings.port = port;
          this.plugin.uploader.updatePort(port);
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u6D4B\u8BD5\u8FDE\u63A5").setDesc("\u68C0\u67E5 PicNexus \u670D\u52A1\u662F\u5426\u53EF\u7528").addButton(
      (button) => button.setButtonText("\u6D4B\u8BD5").setCta().onClick(async () => {
        try {
          const status = await this.plugin.uploader.checkStatus();
          if (status.ready) {
            new import_obsidian2.Notice(`PicNexus \u5DF2\u8FDE\u63A5 (v${status.version})\uFF0C\u5F53\u524D\u56FE\u5E8A: ${status.serviceName || "\u672A\u914D\u7F6E"}`);
          } else {
            new import_obsidian2.Notice("PicNexus \u5DF2\u8FDE\u63A5\uFF0C\u4F46\u672A\u914D\u7F6E\u56FE\u5E8A");
          }
        } catch {
          new import_obsidian2.Notice("\u65E0\u6CD5\u8FDE\u63A5 PicNexus\uFF0C\u8BF7\u786E\u8BA4\u670D\u52A1\u5DF2\u542F\u52A8");
        }
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u4E0A\u4F20\u884C\u4E3A").setHeading();
    new import_obsidian2.Setting(containerEl).setName("\u7C98\u8D34\u65F6\u81EA\u52A8\u4E0A\u4F20").setDesc("\u7C98\u8D34\u56FE\u7247\u65F6\u81EA\u52A8\u4E0A\u4F20\u5230\u56FE\u5E8A").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autoUploadOnPaste).onChange(async (value) => {
        this.plugin.settings.autoUploadOnPaste = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u62D6\u62FD\u65F6\u81EA\u52A8\u4E0A\u4F20").setDesc("\u62D6\u62FD\u56FE\u7247\u5230\u7F16\u8F91\u5668\u65F6\u81EA\u52A8\u4E0A\u4F20").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autoUploadOnDrop).onChange(async (value) => {
        this.plugin.settings.autoUploadOnDrop = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u4E0A\u4F20\u901A\u77E5").setDesc("\u4E0A\u4F20\u6210\u529F\u6216\u5931\u8D25\u65F6\u663E\u793A\u901A\u77E5").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showNotifications).onChange(async (value) => {
        this.plugin.settings.showNotifications = value;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/types.ts
var DEFAULT_SETTINGS = {
  port: 36799,
  autoUploadOnPaste: true,
  autoUploadOnDrop: true,
  showNotifications: true
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readBoolean(settings, key) {
  const value = settings[key];
  return typeof value === "boolean" ? value : DEFAULT_SETTINGS[key];
}
function normalizeSettings(value) {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
  const port = typeof value.port === "number" && Number.isInteger(value.port) && value.port >= 1024 && value.port <= 65535 ? value.port : DEFAULT_SETTINGS.port;
  return {
    port,
    autoUploadOnPaste: readBoolean(value, "autoUploadOnPaste"),
    autoUploadOnDrop: readBoolean(value, "autoUploadOnDrop"),
    showNotifications: readBoolean(value, "showNotifications")
  };
}

// src/markdown.ts
function escapeMarkdownText(value) {
  return value.replace(/([\\[\]])/g, "\\$1");
}
function escapeMarkdownUrl(value) {
  return value.replace(/([\\()])/g, "\\$1");
}
function formatMarkdownImage(name, url) {
  return `![${escapeMarkdownText(name)}](${escapeMarkdownUrl(url)})`;
}
function createUploadPlaceholder(fileName, uploadId) {
  return `![Uploading ${escapeMarkdownText(fileName)}...](#picnexus-upload-${uploadId})`;
}
function findPlaceholderRange(content, placeholder) {
  const start = content.indexOf(placeholder);
  return start === -1 ? null : { start, end: start + placeholder.length };
}

// src/main.ts
var IMAGE_CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
  avif: "image/avif"
};
var IMAGE_EXTS = Object.keys(IMAGE_CONTENT_TYPES);
function getImageContentType(fileName) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return IMAGE_CONTENT_TYPES[ext] || "application/octet-stream";
}
var PicNexusPlugin = class extends import_obsidian3.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  uploader = new PicNexusUploader(DEFAULT_SETTINGS.port);
  statusBarEl = null;
  uploadPlaceholderCounter = 0;
  async onload() {
    await this.loadSettings();
    this.uploader = new PicNexusUploader(this.settings.port);
    this.addSettingTab(new PicNexusSettingTab(this.app, this));
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.setText("PicNexus: ...");
    this.statusBarEl.addClass("picnexus-status");
    void this.checkConnection();
    this.registerInterval(window.setInterval(() => {
      void this.checkConnection();
    }, 3e4));
    this.registerEvent(
      this.app.workspace.on("editor-paste", (evt, editor) => {
        if (evt.defaultPrevented || !this.settings.autoUploadOnPaste) return;
        const files = evt.clipboardData?.files;
        if (!files || files.length === 0) return;
        const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
        if (imageFiles.length === 0) return;
        evt.preventDefault();
        void this.handleImageUpload(imageFiles, editor).catch(() => {
          new import_obsidian3.Notice("\u4E0A\u4F20\u56FE\u7247\u5931\u8D25");
        });
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-drop", (evt, editor) => {
        if (evt.defaultPrevented || !this.settings.autoUploadOnDrop) return;
        const files = evt.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
        if (imageFiles.length === 0) return;
        evt.preventDefault();
        void this.handleImageUpload(imageFiles, editor).catch(() => {
          new import_obsidian3.Notice("\u4E0A\u4F20\u56FE\u7247\u5931\u8D25");
        });
      })
    );
    this.addCommand({
      id: "upload-all-local-images",
      name: "\u4E0A\u4F20\u5F53\u524D\u7B14\u8BB0\u4E2D\u7684\u6240\u6709\u672C\u5730\u56FE\u7247",
      editorCallback: (editor, view) => {
        void this.uploadAllLocalImages(editor, view).catch(() => {
          new import_obsidian3.Notice("\u4E0A\u4F20\u5F53\u524D\u7B14\u8BB0\u4E2D\u7684\u672C\u5730\u56FE\u7247\u5931\u8D25");
        });
      }
    });
    this.addCommand({
      id: "test-connection",
      name: "\u6D4B\u8BD5\u8FDE\u63A5",
      callback: async () => {
        try {
          const status = await this.uploader.checkStatus();
          new import_obsidian3.Notice(status.ready ? `PicNexus v${status.version} \u5DF2\u8FDE\u63A5\uFF0C\u56FE\u5E8A: ${status.serviceName}` : "PicNexus \u5DF2\u8FDE\u63A5\uFF0C\u4F46\u672A\u914D\u7F6E\u56FE\u5E8A");
        } catch {
          new import_obsidian3.Notice("\u65E0\u6CD5\u8FDE\u63A5 PicNexus");
        }
      }
    });
  }
  async loadSettings() {
    const savedData = await this.loadData();
    this.settings = normalizeSettings(savedData);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async checkConnection() {
    if (!this.statusBarEl) return;
    try {
      const status = await this.uploader.checkStatus();
      this.statusBarEl.setText(status.ready ? `PicNexus: ${status.serviceName || "\u5DF2\u8FDE\u63A5"}` : "PicNexus: \u672A\u914D\u7F6E\u56FE\u5E8A");
      this.statusBarEl.removeClass("picnexus-disconnected");
      this.statusBarEl.addClass("picnexus-connected");
    } catch {
      this.statusBarEl.setText("PicNexus: \u672A\u8FDE\u63A5");
      this.statusBarEl.removeClass("picnexus-connected");
      this.statusBarEl.addClass("picnexus-disconnected");
    }
  }
  async handleImageUpload(files, editor) {
    for (const file of files) {
      const placeholder = this.createUploadPlaceholder(file.name);
      this.replaceSelection(editor, placeholder);
      try {
        const buffer = await file.arrayBuffer();
        const resp = await this.uploader.uploadByContent(
          buffer,
          file.name,
          file.type || getImageContentType(file.name)
        );
        if (resp.success && resp.result && resp.result.length > 0) {
          const url = resp.result[0];
          const imageLink = this.formatImageLink(file.name, url);
          this.replacePlaceholder(editor, placeholder, imageLink);
          if (this.settings.showNotifications) {
            new import_obsidian3.Notice(`\u4E0A\u4F20\u6210\u529F: ${file.name}`);
          }
        } else {
          this.replacePlaceholder(editor, placeholder, formatMarkdownImage(file.name, ""));
          new import_obsidian3.Notice(`\u4E0A\u4F20\u5931\u8D25: ${resp.message || "\u672A\u77E5\u9519\u8BEF"}`);
        }
      } catch (err) {
        this.replacePlaceholder(editor, placeholder, formatMarkdownImage(file.name, ""));
        new import_obsidian3.Notice(`\u4E0A\u4F20\u5931\u8D25: ${err instanceof Error ? err.message : "\u8FDE\u63A5 PicNexus \u5931\u8D25"}`);
      }
    }
  }
  formatImageLink(name, url) {
    return formatMarkdownImage(name, url);
  }
  createUploadPlaceholder(fileName) {
    const id = `${Date.now()}-${++this.uploadPlaceholderCounter}`;
    return createUploadPlaceholder(fileName, id);
  }
  replaceSelection(editor, replacement) {
    editor.replaceRange(replacement, editor.getCursor("from"), editor.getCursor("to"));
  }
  replacePlaceholder(editor, placeholder, replacement) {
    const range = findPlaceholderRange(editor.getValue(), placeholder);
    if (!range) return false;
    editor.replaceRange(
      replacement,
      editor.offsetToPos(range.start),
      editor.offsetToPos(range.end)
    );
    return true;
  }
  async uploadAllLocalImages(editor, view) {
    const file = view.file;
    if (!file) {
      new import_obsidian3.Notice("\u65E0\u6CD5\u83B7\u53D6\u5F53\u524D\u6587\u4EF6");
      return;
    }
    const content = editor.getValue();
    const localImageRegex = /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g;
    const matches = [...content.matchAll(localImageRegex)];
    if (matches.length === 0) {
      new import_obsidian3.Notice("\u5F53\u524D\u7B14\u8BB0\u4E2D\u6CA1\u6709\u672C\u5730\u56FE\u7247");
      return;
    }
    new import_obsidian3.Notice(`\u627E\u5230 ${matches.length} \u5F20\u672C\u5730\u56FE\u7247\uFF0C\u5F00\u59CB\u4E0A\u4F20...`);
    const uploadTasks = [];
    for (const match of matches) {
      const [original, alt, localPath] = match;
      const resolvedPath = this.resolveImagePath(localPath, file);
      if (!resolvedPath) continue;
      const imgFile = this.app.vault.getAbstractFileByPath(resolvedPath);
      if (!(imgFile instanceof import_obsidian3.TFile) || !IMAGE_EXTS.includes(imgFile.extension.toLowerCase())) continue;
      uploadTasks.push({
        alt,
        file: imgFile,
        original,
        placeholder: this.createUploadPlaceholder(alt || imgFile.name),
        startOffset: match.index ?? 0
      });
    }
    for (const task of [...uploadTasks].reverse()) {
      editor.replaceRange(
        task.placeholder,
        editor.offsetToPos(task.startOffset),
        editor.offsetToPos(task.startOffset + task.original.length)
      );
    }
    let uploadedCount = 0;
    for (const task of uploadTasks) {
      try {
        const buffer = await this.app.vault.readBinary(task.file);
        const resp = await this.uploader.uploadByContent(
          buffer,
          task.file.name,
          getImageContentType(task.file.name)
        );
        if (resp.success && resp.result && resp.result.length > 0) {
          const url = resp.result[0];
          const imageLink = this.formatImageLink(task.alt || task.file.name, url);
          this.replacePlaceholder(editor, task.placeholder, imageLink);
          uploadedCount++;
        } else {
          this.replacePlaceholder(editor, task.placeholder, task.original);
        }
      } catch {
        this.replacePlaceholder(editor, task.placeholder, task.original);
      }
    }
    if (uploadedCount > 0) {
      new import_obsidian3.Notice(`\u6210\u529F\u4E0A\u4F20 ${uploadedCount}/${matches.length} \u5F20\u56FE\u7247`);
    } else {
      new import_obsidian3.Notice("\u6CA1\u6709\u6210\u529F\u4E0A\u4F20\u4EFB\u4F55\u56FE\u7247");
    }
  }
  resolveImagePath(localPath, currentFile) {
    if (localPath.startsWith("./") || localPath.startsWith("../")) {
      const dir = currentFile.parent?.path || "";
      const parts = [...dir.split("/"), ...localPath.split("/")];
      const resolved = [];
      for (const part of parts) {
        if (part === "." || part === "") continue;
        if (part === "..") {
          resolved.pop();
          continue;
        }
        resolved.push(part);
      }
      return resolved.join("/");
    }
    return localPath;
  }
};
