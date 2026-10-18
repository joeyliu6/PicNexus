// Toast 通知 Composable - 增强版
// 画面与计时在 PnToaster / toastStore（右下角、最多 3 条）；这里保留去重、全局静默与旧的调用方式。
// 主窗口不在屏（隐藏到托盘 / 最小化）时，普通通知改发系统通知（appPresence）。

import { pushToast, clearToasts, type ToastAction, type ToastKind } from '@/components/pn/toastStore';
import type { ToastMessageConfig } from '@/constants/toastMessages';
import { isAppOnScreen, notifySystem } from '@/composables/appPresence';
import { createLogger } from '@/utils/logger';

const log = createLogger('Toast');

// 全局静默开关（批量操作时抑制所有 Toast）
let globalSuppressed = false;

export function suppressToasts(suppress: boolean): void {
  globalSuppressed = suppress;
}

// Toast去重机制
const recentToasts = new Map<string, number>();
const DUPLICATE_WINDOW = 2000; // 2秒防抖窗口

const CACHE_SIZE_LIMIT = 50; // 缓存大小限制
const CACHE_EXPIRE_TIME = 5000; // 缓存过期时间

/**
 * 检查是否为重复提示
 * @param severity 严重程度
 * @param summary 标题
 * @param detail 详细信息
 * @returns true表示重复，应该阻止显示
 */
function isDuplicate(severity: string, summary: string, detail?: string): boolean {
  const fingerprint = `${severity}:${summary}:${detail || ''}`;
  const now = Date.now();
  const lastTime = recentToasts.get(fingerprint);

  // 2秒内重复 → 阻止
  if (lastTime && now - lastTime < DUPLICATE_WINDOW) {
    log.debug(`防重复: 阻止重复提示 ${summary}`);
    return true;
  }

  // 记录本次提示
  recentToasts.set(fingerprint, now);

  // 清理过期缓存
  if (recentToasts.size > CACHE_SIZE_LIMIT) {
    const expiredKeys: string[] = [];
    recentToasts.forEach((time, key) => {
      if (now - time > CACHE_EXPIRE_TIME) {
        expiredKeys.push(key);
      }
    });
    expiredKeys.forEach(key => recentToasts.delete(key));
  }

  return false;
}

/**
 * `useToast()` 的返回值类型：模块级函数以参数形式接收通知能力时使用（便于测试替换）
 */
export type ToastApi = ReturnType<typeof useToast>;

/** 带一个动作按钮的通知（「撤销」「重试」「去登录」）的额外选项 */
export interface ToastActionOptions {
  /** 停留毫秒数 */
  life?: number;
  /** 底部倒计时细线（「撤销」类，默认停留 6 秒） */
  countdown?: boolean;
  /** 到时间自然消失时调用（没点动作按钮） */
  onExpire?: () => void;
}

/**
 * Toast 通知 Composable
 * 不依赖 inject，任何地方都能调用
 */
export function useToast() {
  type Severity = ToastKind;

  function addToast(severity: Severity, summary: string, detail?: string, life?: number): void {
    if (globalSuppressed) return;
    if (isDuplicate(severity, summary, detail)) return;
    // 主窗口隐藏到托盘或最小化时，应用内通知没人看得到：改发系统通知（托盘、全局快捷键发起的上传靠它告知结果）
    if (!isAppOnScreen()) {
      void notifySystem(summary, detail);
      return;
    }
    pushToast({ kind: severity, title: summary, desc: detail, life });
  }

  /**
   * 带动作按钮的通知；不走去重（每次撤销 / 重试都是新的一次操作）。
   * 动作只能在应用里点，所以主窗口不在屏时也留在应用内
   * @returns 通知 id；静默期间返回 null
   */
  function withAction(severity: Severity, summary: string, detail: string | undefined, action: ToastAction, options: ToastActionOptions = {}): number | null {
    if (globalSuppressed) return null;
    return pushToast({ kind: severity, title: summary, desc: detail, action, ...options });
  }

  const success = (summary: string, detail?: string, life?: number) => addToast('success', summary, detail, life);
  const error = (summary: string, detail?: string, life?: number) => addToast('error', summary, detail, life);
  const warn = (summary: string, detail?: string, life?: number) => addToast('warn', summary, detail, life);
  const info = (summary: string, detail?: string, life?: number) => addToast('info', summary, detail, life);
  const show = (severity: Severity, summary: string, detail?: string, life?: number) => addToast(severity, summary, detail, life);
  const clear = () => clearToasts();

  const showConfig = (severity: Severity, config: ToastMessageConfig) => {
    addToast(severity, config.summary, config.detail, config.life);
  };

  /**
   * 静默日志（仅记录日志，不显示通知）
   * @param level 日志级别
   * @param summary 标题
   * @param detail 详细信息
   */
  const silent = (level: 'log' | 'error', summary: string, detail?: string) => {
    const icon = level === 'log' ? '✓' : '✗';
    const message = `[静默] ${icon} ${summary}`;
    if (level === 'error') {
      log.error(message, { detail });
    } else {
      log.info(message, { detail });
    }
  };

  return {
    success,
    error,
    warn,
    info,
    show,
    clear,
    showConfig,
    silent,
    withAction,
  };
}
