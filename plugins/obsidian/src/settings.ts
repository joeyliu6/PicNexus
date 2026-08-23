import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  debounce,
  type Debouncer,
  type SettingDefinitionBase,
  type SettingDefinitionItem,
  type SettingNumberControl,
  type SettingToggleControl,
} from 'obsidian';
import type PicNexusPlugin from './main';
import {
  DEFAULT_SETTINGS,
  PORT_MAX,
  PORT_MIN,
  validatePort,
  type PicNexusSettings,
} from './types';

type SettingKey = keyof PicNexusSettings;
type ToggleKey = Exclude<SettingKey, 'port'>;

const TOGGLE_KEYS: ToggleKey[] = ['autoUploadOnPaste', 'autoUploadOnDrop', 'showNotifications'];
const SETTING_KEYS: SettingKey[] = ['port', ...TOGGLE_KEYS];

/** 端口输入逐字符触发，落盘防抖窗口（毫秒）。 */
const PORT_SAVE_DEBOUNCE_MS = 400;

function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as string[]).includes(key);
}

function isToggleKey(key: string): key is ToggleKey {
  return (TOGGLE_KEYS as string[]).includes(key);
}

/**
 * 本插件实际用到的控件类型。
 * 刻意收窄成两种：display() 的回退适配器对这个联合做穷尽检查，
 * 将来往定义里加第三种控件却忘了更新适配器时会直接编译失败。
 */
type PicNexusControl = SettingToggleControl<SettingKey> | SettingNumberControl<SettingKey>;

/**
 * 一条设置定义。`actionLabel` 是本插件自加的字段：
 * 1.13+ 由 Obsidian 把整行渲染成可点击行（用 name 作标签），
 * 老版本回退路径需要一个按钮文案，放进定义里才不会和适配器两处失配。
 */
type PicNexusDefinition =
  | (SettingDefinitionBase & { control: PicNexusControl; action?: never; actionLabel?: never })
  | (SettingDefinitionBase & {
      control?: never;
      action: (el: HTMLElement, index: number) => void;
      actionLabel: string;
    });

interface PicNexusGroup {
  type: 'group';
  heading: string;
  items: PicNexusDefinition[];
}

type PicNexusItem = PicNexusDefinition | PicNexusGroup;

export class PicNexusSettingTab extends PluginSettingTab {
  plugin: PicNexusPlugin;

  /** 端口已写入内存、尚未落盘。hide() 据此冲刷。 */
  private portSavePending = false;

  private readonly flushPortSave: Debouncer<[], void> = debounce(
    () => {
      this.portSavePending = false;
      void this.plugin.saveSettings();
    },
    PORT_SAVE_DEBOUNCE_MS,
    true,
  );

  constructor(app: App, plugin: PicNexusPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ---------------------------------------------------------------------------
  // 声明式 API（Obsidian 1.13+）：设置项的唯一真相源，同时供设置搜索建立索引
  // ---------------------------------------------------------------------------

  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.definitions();
  }

  private definitions(): PicNexusItem[] {
    return [
      {
        name: '端口',
        desc: `PicNexus HTTP 服务的监听端口（默认 ${DEFAULT_SETTINGS.port}）`,
        aliases: ['port', 'http'],
        control: {
          type: 'number',
          key: 'port',
          defaultValue: DEFAULT_SETTINGS.port,
          placeholder: String(DEFAULT_SETTINGS.port),
          min: PORT_MIN,
          max: PORT_MAX,
          step: 1,
          validate: validatePort,
        },
      },
      {
        name: '测试连接',
        desc: '检查 PicNexus 服务是否可用',
        actionLabel: '测试',
        action: () => {
          void this.runConnectionTest();
        },
      },
      {
        type: 'group',
        heading: '上传行为',
        items: [
          {
            name: '粘贴时自动上传',
            desc: '粘贴图片时自动上传到图床',
            control: {
              type: 'toggle',
              key: 'autoUploadOnPaste',
              defaultValue: DEFAULT_SETTINGS.autoUploadOnPaste,
            },
          },
          {
            name: '拖拽时自动上传',
            desc: '拖拽图片到编辑器时自动上传',
            control: {
              type: 'toggle',
              key: 'autoUploadOnDrop',
              defaultValue: DEFAULT_SETTINGS.autoUploadOnDrop,
            },
          },
          {
            // 文案只覆盖成功：失败通知在 main.ts 里无条件弹出，不受本开关约束。
            name: '上传通知',
            desc: '上传成功时显示通知',
            control: {
              type: 'toggle',
              key: 'showNotifications',
              defaultValue: DEFAULT_SETTINGS.showNotifications,
            },
          },
        ],
      },
    ];
  }

  // ---------------------------------------------------------------------------
  // 读写：声明式路径与回退适配器共用，保证两条渲染路径的持久化语义完全一致
  // ---------------------------------------------------------------------------

  getControlValue(key: string): unknown {
    // 不回退到 super：老版本 Obsidian 的基类根本没有这个方法。
    return isSettingKey(key) ? this.plugin.settings[key] : undefined;
  }

  setControlValue(key: string, value: unknown): void | Promise<void> {
    if (key === 'port') {
      if (typeof value !== 'number' || validatePort(value)) return;
      this.plugin.settings.port = value;
      // 端口即时生效，但落盘防抖：输入框逐字符触发，否则一次改动要写好几次盘。
      this.plugin.uploader.updatePort(value);
      this.portSavePending = true;
      this.flushPortSave();
      return;
    }

    if (isToggleKey(key) && typeof value === 'boolean') {
      this.plugin.settings[key] = value;
      return this.plugin.saveSettings();
    }
  }

  hide(): void {
    this.flushPortSave.cancel();
    if (this.portSavePending) {
      this.portSavePending = false;
      void this.plugin.saveSettings();
    }
    super.hide();
  }

  private async runConnectionTest(): Promise<void> {
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
  }

  // ---------------------------------------------------------------------------
  // 回退渲染（Obsidian 1.4.0–1.12）
  // 1.13+ 下 getSettingDefinitions() 返回非空数组时本方法不会被调用。
  // 这里不手写任何设置项，只把上面那份定义翻译成命令式 Setting，避免两处漂移。
  // ---------------------------------------------------------------------------

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.renderItems(containerEl, this.definitions());
  }

  private renderItems(container: HTMLElement, items: PicNexusItem[]): void {
    for (const item of items) {
      if ('type' in item) {
        new Setting(container).setName(item.heading).setHeading();
        this.renderItems(container, item.items);
        continue;
      }
      this.renderDefinition(container, item);
    }
  }

  private renderDefinition(container: HTMLElement, def: PicNexusDefinition): void {
    const setting = new Setting(container).setName(def.name);
    if (def.desc) setting.setDesc(def.desc);

    if (def.action) {
      const { action, actionLabel } = def;
      setting.addButton(button =>
        button
          .setButtonText(actionLabel)
          .setCta()
          .onClick(() => {
            action(button.buttonEl, 0);
          }),
      );
      return;
    }

    this.renderControl(setting, def.control);
  }

  private renderControl(setting: Setting, control: PicNexusControl): void {
    switch (control.type) {
      case 'toggle': {
        const current = this.getControlValue(control.key);
        setting.addToggle(toggle =>
          toggle
            .setValue(typeof current === 'boolean' ? current : (control.defaultValue ?? false))
            .onChange(value => {
              void this.setControlValue(control.key, value);
            }),
        );
        return;
      }

      case 'number': {
        const current = this.getControlValue(control.key);
        // 老版本没有内联报错 API，自己在描述下方挂一行错误文案。
        const errorEl = setting.descEl.createDiv({ cls: 'picnexus-setting-error' });

        setting.addText(text => {
          text.inputEl.type = 'number';
          if (control.placeholder) text.setPlaceholder(control.placeholder);
          if (control.min !== undefined) text.inputEl.min = String(control.min);
          if (control.max !== undefined) text.inputEl.max = String(control.max);
          if (control.step !== undefined) text.inputEl.step = String(control.step);
          text.setValue(typeof current === 'number' ? String(current) : '');

          text.onChange(raw => {
            const error = this.validateNumberInput(control, raw);
            errorEl.setText(error ?? '');
            if (!error) void this.setControlValue(control.key, Number(raw));
          });
        });
        return;
      }

      default: {
        // 穷尽检查：新增控件类型而没在上面处理时，这里会编译失败。
        const unsupported: never = control;
        throw new Error(`不支持的设置控件类型: ${String(unsupported)}`);
      }
    }
  }

  /** 合法返回 undefined，非法返回错误文案。异步 validate 本插件用不到，一律按通过处理。 */
  private validateNumberInput(
    control: SettingNumberControl<SettingKey>,
    raw: string,
  ): string | undefined {
    const parsed = Number(raw);
    if (raw.trim() === '' || Number.isNaN(parsed)) return '请输入数字';
    const result = control.validate?.(parsed);
    return typeof result === 'string' ? result : undefined;
  }
}
