type E2ECall =
  | { type: 'invoke'; command: string; args?: unknown }
  | { type: 'dialog.open'; options?: unknown }
  | { type: 'dialog.save'; options?: unknown }
  | { type: 'clipboard.readText' }
  | { type: 'clipboard.writeText'; text: string }
  | { type: 'fs.readFile'; path: string }
  | { type: 'fs.readTextFile'; path: string }
  | { type: 'fs.writeTextFile'; path: string; contents: string }
  | { type: 'event.emit'; event: string; payload?: unknown };

/** 让某个原生命令按需要的方式返回（视觉测试用它摆出上传中 / 部分失败等状态） */
export interface InvokeOverride {
  /** 原样返回这个值 */
  result?: unknown;
  /** 以这条消息失败 */
  error?: string;
  /** 永远不返回（停在「上传中」） */
  hang?: boolean;
  /** 上传命令：返回 `{ url: urlPrefix + 文件名 }` */
  urlPrefix?: string;
  /** 只让这些文件名失败（配合 error），其余照常 */
  failFor?: string[];
}

/**
 * 页面加载前写进 `window.__PICNEXUS_E2E_SEED__` 的初始数据（Playwright 的 addInitScript），
 * 不写就是冒烟测试一直用的默认环境。
 */
export interface E2ESeed {
  /** 按顶层键覆盖默认配置 */
  config?: Record<string, unknown>;
  /** history_items 表里的行（列名同数据库） */
  historyRows?: Array<Record<string, unknown>>;
  invokeOverrides?: Record<string, InvokeOverride>;
  dialogOpenResult?: string[] | string | null;
  /** 图库按天统计的查询一直不返回（冷启动骨架 G12） */
  sqlHangDayStats?: boolean;
}

interface E2EState {
  calls: E2ECall[];
  files: Record<string, string>;
  clipboardText: string;
  dialogOpenResult: string[] | string | null;
  failWriteTextFile: Record<string, string>;
  historyRows: Array<Record<string, unknown>>;
  invokeOverrides: Record<string, InvokeOverride>;
  /** 应用注册的拖放监听；测试调用它来模拟拖入 */
  dragDropHandler?: (event: { payload: unknown }) => void;
}

declare global {
  var __PICNEXUS_E2E__: E2EState | undefined;
  var __PICNEXUS_E2E_SEED__: E2ESeed | undefined;
}

const DEFAULT_CONFIG = {
  enabledServices: ['jd'],
  availableServices: ['jd', 'qiyu'],
  onboardingCompleted: true,
  publicServiceRiskAccepted: true,
  appBehavior: {
    autoStart: false,
    minimizeToTrayOnStart: false,
    closeToTray: true,
  },
  analytics: { enabled: false },
  autoUpdate: { enabled: false },
  globalShortcut: {
    enabled: false,
    uploadClipboard: 'CommandOrControl+Shift+C',
    uploadFromFile: 'CommandOrControl+Shift+O',
  },
};

export function getState(): E2EState {
  const seed = globalThis.__PICNEXUS_E2E_SEED__ ?? {};
  globalThis.__PICNEXUS_E2E__ ??= {
    calls: [],
    files: {
      '/mock/appdata/.settings.dat': JSON.stringify({ config: { ...DEFAULT_CONFIG, ...seed.config } }),
    },
    clipboardText: '',
    dialogOpenResult: seed.dialogOpenResult ?? null,
    failWriteTextFile: {},
    historyRows: seed.historyRows ?? [],
    invokeOverrides: seed.invokeOverrides ?? {},
  };
  return globalThis.__PICNEXUS_E2E__;
}

export function record(call: E2ECall): void {
  getState().calls.push(call);
}

export function makeUnlisten(): () => void {
  return () => undefined;
}
