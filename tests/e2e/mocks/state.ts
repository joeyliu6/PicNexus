type E2ECall =
  | { type: 'invoke'; command: string; args?: unknown }
  | { type: 'dialog.open'; options?: unknown }
  | { type: 'dialog.save'; options?: unknown }
  | { type: 'clipboard.readText' }
  | { type: 'clipboard.writeText'; text: string }
  | { type: 'fs.readFile'; path: string }
  | { type: 'fs.readTextFile'; path: string }
  | { type: 'fs.writeTextFile'; path: string; contents: string }
  | { type: 'event.emit'; event: string; payload?: unknown }
  | { type: 'tray.setMenu'; items: unknown[] }
  | { type: 'tray.closeMenu'; rid: number }
  | { type: 'tray.setIcon' };

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
  /**
   * 按参数取值分别返回（如 scan_md_folder 按 dir 给不同文件夹的扫描结果）；没列到的走 result。
   * key 可写点路径（'request.method'）；给数组时几个取值用空格连起来查（webdav_request 按「方法 地址」）
   */
  byArg?: { key: string | string[]; results: Record<string, unknown> };
  /** 以这个值本身失败（结构化的 AppError，如 { type: 'WEBDAV_LAN_HTTP_UNCONFIRMED', data: { message } }） */
  errorValue?: unknown;
  /** 过这么多毫秒（页面时钟）再返回：测试连接的耗时写成固定值 */
  delayMs?: number;
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
  /** 绑定参数里带这个值的查询一直不返回（摆出「修复到一半」：读到这张图的记录时停住） */
  sqlHangFor?: string;
  /** 内存文件表的初始内容（文档文件夹里的 Markdown） */
  files?: Record<string, string>;
  /** 写这些文件时以给定消息失败一次（文档写不成） */
  failWriteTextFile?: Record<string, string>;
  /** 检查更新的结果（不给 = 已是最新）：发现的版本、下载到哪、停在哪一步、哪一步失败 */
  update?: UpdatePlan;
}

export interface UpdatePlan {
  version?: string;
  body?: string;
  /** 安装包总字节、已下字节 */
  total?: number;
  downloaded?: number;
  hang?: 'check' | 'download' | 'install';
  checkError?: string;
  downloadError?: string;
}

interface E2EState {
  calls: E2ECall[];
  files: Record<string, string>;
  clipboardText: string;
  dialogOpenResult: string[] | string | null;
  failWriteTextFile: Record<string, string>;
  historyRows: Array<Record<string, unknown>>;
  invokeOverrides: Record<string, InvokeOverride>;
  update?: UpdatePlan;
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
      ...seed.files,
    },
    clipboardText: '',
    dialogOpenResult: seed.dialogOpenResult ?? null,
    failWriteTextFile: { ...seed.failWriteTextFile },
    historyRows: seed.historyRows ?? [],
    invokeOverrides: seed.invokeOverrides ?? {},
    update: seed.update,
  };
  return globalThis.__PICNEXUS_E2E__;
}

export function record(call: E2ECall): void {
  getState().calls.push(call);
}

export function makeUnlisten(): () => void {
  return () => undefined;
}
