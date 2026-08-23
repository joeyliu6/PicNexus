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

// src/types.ts
var DEFAULT_SETTINGS = {
  port: 36799,
  autoUploadOnPaste: true,
  autoUploadOnDrop: true,
  showNotifications: true
};
var PORT_MIN = 1024;
var PORT_MAX = 65535;
function validatePort(value) {
  if (!Number.isInteger(value)) return "\u7AEF\u53E3\u5FC5\u987B\u662F\u6574\u6570";
  if (value < PORT_MIN || value > PORT_MAX) return `\u7AEF\u53E3\u9700\u5728 ${PORT_MIN}\u2013${PORT_MAX} \u4E4B\u95F4`;
  return void 0;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readBoolean(settings, key) {
  const value = settings[key];
  return typeof value === "boolean" ? value : DEFAULT_SETTINGS[key];
}
function normalizeSettings(value) {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
  const port = typeof value.port === "number" && !validatePort(value.port) ? value.port : DEFAULT_SETTINGS.port;
  return {
    port,
    autoUploadOnPaste: readBoolean(value, "autoUploadOnPaste"),
    autoUploadOnDrop: readBoolean(value, "autoUploadOnDrop"),
    showNotifications: readBoolean(value, "showNotifications")
  };
}

// src/settings.ts
var TOGGLE_KEYS = ["autoUploadOnPaste", "autoUploadOnDrop", "showNotifications"];
var SETTING_KEYS = ["port", ...TOGGLE_KEYS];
var PORT_SAVE_DEBOUNCE_MS = 400;
function isSettingKey(key) {
  return SETTING_KEYS.includes(key);
}
function isToggleKey(key) {
  return TOGGLE_KEYS.includes(key);
}
var PicNexusSettingTab = class extends import_obsidian2.PluginSettingTab {
  plugin;
  /** 端口已写入内存、尚未落盘。hide() 据此冲刷。 */
  portSavePending = false;
  flushPortSave = (0, import_obsidian2.debounce)(
    () => {
      this.portSavePending = false;
      void this.plugin.saveSettings();
    },
    PORT_SAVE_DEBOUNCE_MS,
    true
  );
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  // ---------------------------------------------------------------------------
  // 声明式 API（Obsidian 1.13+）：设置项的唯一真相源，同时供设置搜索建立索引
  // ---------------------------------------------------------------------------
  getSettingDefinitions() {
    return this.definitions();
  }
  definitions() {
    return [
      {
        name: "\u7AEF\u53E3",
        desc: `PicNexus HTTP \u670D\u52A1\u7684\u76D1\u542C\u7AEF\u53E3\uFF08\u9ED8\u8BA4 ${DEFAULT_SETTINGS.port}\uFF09`,
        aliases: ["port", "http"],
        control: {
          type: "number",
          key: "port",
          defaultValue: DEFAULT_SETTINGS.port,
          placeholder: String(DEFAULT_SETTINGS.port),
          min: PORT_MIN,
          max: PORT_MAX,
          step: 1,
          validate: validatePort
        }
      },
      {
        name: "\u6D4B\u8BD5\u8FDE\u63A5",
        desc: "\u68C0\u67E5 PicNexus \u670D\u52A1\u662F\u5426\u53EF\u7528",
        actionLabel: "\u6D4B\u8BD5",
        action: () => {
          void this.runConnectionTest();
        }
      },
      {
        type: "group",
        heading: "\u4E0A\u4F20\u884C\u4E3A",
        items: [
          {
            name: "\u7C98\u8D34\u65F6\u81EA\u52A8\u4E0A\u4F20",
            desc: "\u7C98\u8D34\u56FE\u7247\u65F6\u81EA\u52A8\u4E0A\u4F20\u5230\u56FE\u5E8A",
            control: {
              type: "toggle",
              key: "autoUploadOnPaste",
              defaultValue: DEFAULT_SETTINGS.autoUploadOnPaste
            }
          },
          {
            name: "\u62D6\u62FD\u65F6\u81EA\u52A8\u4E0A\u4F20",
            desc: "\u62D6\u62FD\u56FE\u7247\u5230\u7F16\u8F91\u5668\u65F6\u81EA\u52A8\u4E0A\u4F20",
            control: {
              type: "toggle",
              key: "autoUploadOnDrop",
              defaultValue: DEFAULT_SETTINGS.autoUploadOnDrop
            }
          },
          {
            // 文案只覆盖成功：失败通知在 main.ts 里无条件弹出，不受本开关约束。
            name: "\u4E0A\u4F20\u901A\u77E5",
            desc: "\u4E0A\u4F20\u6210\u529F\u65F6\u663E\u793A\u901A\u77E5",
            control: {
              type: "toggle",
              key: "showNotifications",
              defaultValue: DEFAULT_SETTINGS.showNotifications
            }
          }
        ]
      }
    ];
  }
  // ---------------------------------------------------------------------------
  // 读写：声明式路径与回退适配器共用，保证两条渲染路径的持久化语义完全一致
  // ---------------------------------------------------------------------------
  getControlValue(key) {
    return isSettingKey(key) ? this.plugin.settings[key] : void 0;
  }
  setControlValue(key, value) {
    if (key === "port") {
      if (typeof value !== "number" || validatePort(value)) return;
      this.plugin.settings.port = value;
      this.plugin.uploader.updatePort(value);
      this.portSavePending = true;
      this.flushPortSave();
      return;
    }
    if (isToggleKey(key) && typeof value === "boolean") {
      this.plugin.settings[key] = value;
      return this.plugin.saveSettings();
    }
  }
  hide() {
    this.flushPortSave.cancel();
    if (this.portSavePending) {
      this.portSavePending = false;
      void this.plugin.saveSettings();
    }
    super.hide();
  }
  async runConnectionTest() {
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
  }
  // ---------------------------------------------------------------------------
  // 回退渲染（Obsidian 1.4.0–1.12）
  // 1.13+ 下 getSettingDefinitions() 返回非空数组时本方法不会被调用。
  // 这里不手写任何设置项，只把上面那份定义翻译成命令式 Setting，避免两处漂移。
  // ---------------------------------------------------------------------------
  display() {
    const { containerEl } = this;
    containerEl.empty();
    this.renderItems(containerEl, this.definitions());
  }
  renderItems(container, items) {
    for (const item of items) {
      if ("type" in item) {
        new import_obsidian2.Setting(container).setName(item.heading).setHeading();
        this.renderItems(container, item.items);
        continue;
      }
      this.renderDefinition(container, item);
    }
  }
  renderDefinition(container, def) {
    const setting = new import_obsidian2.Setting(container).setName(def.name);
    if (def.desc) setting.setDesc(def.desc);
    if (def.action) {
      const { action, actionLabel } = def;
      setting.addButton(
        (button) => button.setButtonText(actionLabel).setCta().onClick(() => {
          action(button.buttonEl, 0);
        })
      );
      return;
    }
    this.renderControl(setting, def.control);
  }
  renderControl(setting, control) {
    switch (control.type) {
      case "toggle": {
        const current = this.getControlValue(control.key);
        setting.addToggle(
          (toggle) => toggle.setValue(typeof current === "boolean" ? current : control.defaultValue ?? false).onChange((value) => {
            void this.setControlValue(control.key, value);
          })
        );
        return;
      }
      case "number": {
        const current = this.getControlValue(control.key);
        const errorEl = setting.descEl.createDiv({ cls: "picnexus-setting-error" });
        setting.addText((text) => {
          text.inputEl.type = "number";
          if (control.placeholder) text.setPlaceholder(control.placeholder);
          if (control.min !== void 0) text.inputEl.min = String(control.min);
          if (control.max !== void 0) text.inputEl.max = String(control.max);
          if (control.step !== void 0) text.inputEl.step = String(control.step);
          text.setValue(typeof current === "number" ? String(current) : "");
          text.onChange((raw) => {
            const error = this.validateNumberInput(control, raw);
            errorEl.setText(error ?? "");
            if (!error) void this.setControlValue(control.key, Number(raw));
          });
        });
        return;
      }
      default: {
        const unsupported = control;
        throw new Error(`\u4E0D\u652F\u6301\u7684\u8BBE\u7F6E\u63A7\u4EF6\u7C7B\u578B: ${String(unsupported)}`);
      }
    }
  }
  /** 合法返回 undefined，非法返回错误文案。异步 validate 本插件用不到，一律按通过处理。 */
  validateNumberInput(control, raw) {
    const parsed = Number(raw);
    if (raw.trim() === "" || Number.isNaN(parsed)) return "\u8BF7\u8F93\u5165\u6570\u5B57";
    const result = control.validate?.(parsed);
    return typeof result === "string" ? result : void 0;
  }
};

// src/markdown.ts
var PLACEHOLDER_PREFIX = "\u23F3";
function escapeMarkdownText(value) {
  return value.replace(/([\\[\]])/g, "\\$1");
}
function escapeMarkdownUrl(value) {
  return value.replace(/([\\()])/g, "\\$1");
}
function formatMarkdownImage(name, url) {
  return `![${escapeMarkdownText(name)}](${escapeMarkdownUrl(url)})`;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function createUploadPlaceholder(fileName, uploadId) {
  const safeName = escapeMarkdownText(fileName).split(PLACEHOLDER_PREFIX).join("").replace(/[\r\n]+/g, " ");
  return `${PLACEHOLDER_PREFIX} Uploading ${safeName}\u2026 (${uploadId})`;
}
function findPlaceholderRange(content, uploadId) {
  const prefix = escapeRegExp(PLACEHOLDER_PREFIX);
  const pattern = new RegExp(`${prefix}(?:(?!${prefix})[^\\n])*\\(${escapeRegExp(uploadId)}\\)`);
  const match = pattern.exec(content);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
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
var STATUS_POLL_INTERVAL_MS = 3e4;
var STATUS_REFRESH_THROTTLE_MS = 2e3;
function getImageContentType(fileName) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return IMAGE_CONTENT_TYPES[ext] || "application/octet-stream";
}
var PicNexusPlugin = class extends import_obsidian3.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  uploader = new PicNexusUploader(DEFAULT_SETTINGS.port);
  statusBarEl = null;
  lastStatusCheckAt = 0;
  uploadPlaceholderCounter = 0;
  /**
   * 每次加载插件随机生成的短标签，拼进占位符 ID
   *
   * 自增序号只能保证「本次会话内不重复」。若上一次 Obsidian 是在上传途中被关掉的，
   * 笔记里会残留一个孤儿占位符；新会话序号从 1 重新开始，就可能把新图片的链接
   * 替换到那个孤儿身上（它在文档里更靠前）。加个会话标签就避开了，代价是
   * 占位符里多显示三个字符。
   */
  uploadSessionTag = Math.random().toString(36).slice(2, 5);
  async onload() {
    await this.loadSettings();
    this.uploader = new PicNexusUploader(this.settings.port);
    this.addSettingTab(new PicNexusSettingTab(this.app, this));
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.setText("PicNexus: ...");
    this.statusBarEl.addClass("picnexus-status");
    this.statusBarEl.setAttribute("aria-label", "\u70B9\u51FB\u5237\u65B0 PicNexus \u72B6\u6001");
    this.registerDomEvent(this.statusBarEl, "click", () => {
      void this.checkConnection(true);
    });
    this.registerDomEvent(window, "focus", () => {
      void this.checkConnection();
    });
    void this.checkConnection(true);
    this.registerInterval(window.setInterval(() => {
      void this.checkConnection(true);
    }, STATUS_POLL_INTERVAL_MS));
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
  /** force=true 跳过节流：启动、点击刷新和兜底轮询都要必到。 */
  async checkConnection(force = false) {
    if (!this.statusBarEl) return;
    const now = Date.now();
    if (!force && now - this.lastStatusCheckAt < STATUS_REFRESH_THROTTLE_MS) return;
    this.lastStatusCheckAt = now;
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
      this.replaceSelection(editor, placeholder.text);
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
          this.replacePlaceholder(editor, placeholder.id, imageLink);
          if (this.settings.showNotifications) {
            new import_obsidian3.Notice(`\u4E0A\u4F20\u6210\u529F: ${file.name}`);
          }
        } else {
          this.replacePlaceholder(editor, placeholder.id, formatMarkdownImage(file.name, ""));
          new import_obsidian3.Notice(`\u4E0A\u4F20\u5931\u8D25: ${resp.message || "\u672A\u77E5\u9519\u8BEF"}`);
        }
      } catch (err) {
        this.replacePlaceholder(editor, placeholder.id, formatMarkdownImage(file.name, ""));
        new import_obsidian3.Notice(`\u4E0A\u4F20\u5931\u8D25: ${err instanceof Error ? err.message : "\u8FDE\u63A5 PicNexus \u5931\u8D25"}`);
      }
    }
  }
  formatImageLink(name, url) {
    return formatMarkdownImage(name, url);
  }
  /** 返回 `{ id, text }`：`text` 插进文档，`id` 留着替换时定位（可见文本可能被别的插件改写） */
  createUploadPlaceholder(fileName) {
    const id = `${this.uploadSessionTag}${++this.uploadPlaceholderCounter}`;
    return { id, text: createUploadPlaceholder(fileName, id) };
  }
  replaceSelection(editor, replacement) {
    editor.replaceRange(replacement, editor.getCursor("from"), editor.getCursor("to"));
  }
  replacePlaceholder(editor, uploadId, replacement) {
    const range = findPlaceholderRange(editor.getValue(), uploadId);
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
        task.placeholder.text,
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
          this.replacePlaceholder(editor, task.placeholder.id, imageLink);
          uploadedCount++;
        } else {
          this.replacePlaceholder(editor, task.placeholder.id, task.original);
        }
      } catch {
        this.replacePlaceholder(editor, task.placeholder.id, task.original);
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
