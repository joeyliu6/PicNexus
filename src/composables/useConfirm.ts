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

  /** 图标（旧写法 'pi pi-…'）：含 exclamation 的按「警告」画琥珀图标块 */
  icon?: string;

  /** 确认按钮样式（旧写法 'p-button-danger' / 'p-button-warning'）：danger = 红色危险按钮 */
  acceptClass?: string;
}

/** 由旧的 icon / acceptClass 写法推出新对话框的图标块色调与确认按钮样式 */
export function resolveConfirmTone(icon?: string, acceptClass?: string): { tone: ConfirmTone; danger: boolean } {
  if (acceptClass?.includes('danger')) return { tone: 'danger', danger: true };
  if (acceptClass?.includes('warning') || icon?.includes('exclamation')) return { tone: 'warning', danger: false };
  return { tone: 'brand', danger: false };
}

/** 异步确认选项 */
export interface ConfirmAsyncOptions {
  header?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  acceptClass?: string;
}

/** 三态确认结果 */
export type ConfirmThreeWayResult = 'accept' | 'reject' | 'dismiss';

/** 三态确认选项 */
export interface ConfirmThreeWayOptions {
  /** 对话框标题 */
  header?: string;
  /** 消息内容 */
  message: string;
  /** 确认按钮文本 */
  acceptLabel?: string;
  /** 取消按钮文本 */
  rejectLabel?: string;
  /** 图标 */
  icon?: string;
  /**
   * 「本次运行内不再提示」勾选框的状态容器；不传就不显示这个勾选框
   *
   * 传的是**对象**而不是布尔值：对话框要把用户的选择写回来，
   * 布尔值按值传过去就断了。勾选框画在 `PnConfirmHost.vue` 里。
   *
   * 目前只有清除已保存凭证用它，见 `useSecretClearConfirm`。
   */
  clearOptOut?: { checked: boolean };
}

interface RequireOptions {
  header: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
  icon?: string;
  acceptClass?: string;
  clearOptOut?: { checked: boolean };
}

function require(options: RequireOptions) {
  return requestConfirm({
    title: options.header,
    message: options.message,
    acceptLabel: options.acceptLabel,
    rejectLabel: options.rejectLabel,
    clearOptOut: options.clearOptOut,
    ...resolveConfirmTone(options.icon, options.acceptClass),
  });
}

/**
 * 确认对话框 Composable（不依赖 inject，任何地方都能调用）
 */
export function useConfirm() {
  const confirmDefaults = UI_COPY.confirm.defaults;
  const deleteDefaults = UI_COPY.confirm.delete;
  const warnDefaults = UI_COPY.confirm.warn;

  /** 显示确认对话框（回调式） */
  const showConfirm = (options: ConfirmOptions) => {
    void require({
      header: options.header || confirmDefaults.header,
      message: options.message,
      icon: options.icon || confirmDefaults.icon,
      acceptLabel: options.acceptLabel || confirmDefaults.acceptLabel,
      rejectLabel: options.rejectLabel || confirmDefaults.rejectLabel,
      acceptClass: options.acceptClass,
    }).then((result) => {
      // Esc / 点遮罩（dismiss）两个回调都不调，与按「取消」区分开
      if (result === 'accept') options.accept?.();
      else if (result === 'reject') options.reject?.();
    });
  };

  /** 显示删除确认对话框 */
  const confirmDelete = (message: string, onConfirm: () => void) => {
    void require({
      header: deleteDefaults.header,
      message,
      icon: deleteDefaults.icon,
      acceptLabel: deleteDefaults.acceptLabel,
      rejectLabel: deleteDefaults.rejectLabel,
      acceptClass: deleteDefaults.acceptClass,
    }).then((result) => { if (result === 'accept') onConfirm(); });
  };

  /** 显示警告确认对话框 */
  const confirmWarn = (message: string, onConfirm: () => void) => {
    void require({
      header: warnDefaults.header,
      message,
      icon: warnDefaults.icon,
      acceptLabel: warnDefaults.acceptLabel,
      rejectLabel: warnDefaults.rejectLabel,
      acceptClass: warnDefaults.acceptClass,
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
      icon: confirmDefaults.icon,
      acceptLabel: opts.acceptLabel || confirmDefaults.acceptLabel,
      rejectLabel: opts.rejectLabel || confirmDefaults.rejectLabel,
      acceptClass: opts.acceptClass,
    });
    return result === 'accept';
  };

  /**
   * 三态确认对话框：accept（确认按钮）、reject（取消按钮）、dismiss（Esc / 点遮罩）
   */
  const confirmThreeWay = (options: ConfirmThreeWayOptions): Promise<ConfirmThreeWayResult> => require({
    header: options.header || confirmDefaults.header,
    message: options.message,
    icon: options.icon || confirmDefaults.icon,
    acceptLabel: options.acceptLabel || confirmDefaults.acceptLabel,
    rejectLabel: options.rejectLabel || confirmDefaults.rejectLabel,
    clearOptOut: options.clearOptOut,
  });

  return {
    showConfirm,
    confirmDelete,
    confirmWarn,
    close,
    confirm: confirmAsync,  // 别名，用于 async/await
    confirmThreeWay
  };
}
