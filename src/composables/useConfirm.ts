// 确认对话框 Composable
// 画面在 PnConfirmHost（统一对话框规格）；这里保留旧的调用方式。
// 能撤销的操作不弹确认框（交接说明第 4 节）——只给真正不可逆的操作用。

import { requestConfirm, dismissCurrentConfirm, type ConfirmTone } from '@/components/pn/confirmStore';
import { UI_COPY } from '@/constants/uiCopy';

export interface ConfirmOptions {
  /** 对话框标题 */
  header?: string;

  /** 消息内容 */
  message: string;

  /** 确认按钮文本 */
  acceptLabel?: string;

  /** 取消按钮文本 */
  rejectLabel?: string;

  /** 确认回调 */
  accept?: () => void;

  /** 取消回调 */
  reject?: () => void;

  /** 图标块色调：danger = 红色图标块 + 红色确认按钮（不可逆的危险操作）；不给按 warning（琥珀） */
  tone?: ConfirmTone;
}

/** 异步确认选项 */
export interface ConfirmAsyncOptions {
  header?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  tone?: ConfirmTone;
  /** 正文下面等宽显示的一行（地址、路径） */
  code?: string;
}

interface RequireOptions {
  header: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
  tone?: ConfirmTone;
  code?: string;
}

function require(options: RequireOptions) {
  return requestConfirm({
    title: options.header,
    message: options.message,
    acceptLabel: options.acceptLabel,
    rejectLabel: options.rejectLabel,
    code: options.code,
    tone: options.tone ?? 'warning',
    danger: options.tone === 'danger',
  });
}

/**
 * 确认对话框 Composable（不依赖 inject，任何地方都能调用）
 */
export function useConfirm() {
  const confirmDefaults = UI_COPY.confirm.defaults;
  const warnDefaults = UI_COPY.confirm.warn;

  /** 显示确认对话框（回调式） */
  const showConfirm = (options: ConfirmOptions) => {
    void require({
      header: options.header || confirmDefaults.header,
      message: options.message,
      acceptLabel: options.acceptLabel || confirmDefaults.acceptLabel,
      rejectLabel: options.rejectLabel || confirmDefaults.rejectLabel,
      tone: options.tone,
    }).then((result) => {
      // Esc / 点遮罩（dismiss）两个回调都不调，与按「取消」区分开
      if (result === 'accept') options.accept?.();
      else if (result === 'reject') options.reject?.();
    });
  };

  /** 显示警告确认对话框 */
  const confirmWarn = (message: string, onConfirm: () => void) => {
    void require({
      header: warnDefaults.header,
      message,
      acceptLabel: warnDefaults.acceptLabel,
      rejectLabel: warnDefaults.rejectLabel,
      tone: 'warning',
    }).then((result) => { if (result === 'accept') onConfirm(); });
  };

  /** 关闭当前确认框（等价于按 Esc） */
  const close = () => {
    dismissCurrentConfirm();
  };

  /**
   * 异步确认对话框
   * @returns Promise<boolean> 用户是否确认
   */
  const confirmAsync = async (
    message: string,
    headerOrOptions?: string | ConfirmAsyncOptions
  ): Promise<boolean> => {
    const opts = typeof headerOrOptions === 'string'
      ? { header: headerOrOptions }
      : headerOrOptions || {};

    const result = await require({
      header: opts.header || confirmDefaults.header,
      message,
      acceptLabel: opts.acceptLabel || confirmDefaults.acceptLabel,
      rejectLabel: opts.rejectLabel || confirmDefaults.rejectLabel,
      tone: opts.tone,
      code: opts.code,
    });
    return result === 'accept';
  };

  return {
    showConfirm,
    confirmWarn,
    close,
    confirm: confirmAsync,  // 别名，用于 async/await
  };
}
