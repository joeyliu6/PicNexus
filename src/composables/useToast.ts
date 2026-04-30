// Toast 通知 Composable - 增强版

import { useToast as usePrimeToast } from 'primevue/usetoast';
import type { ToastMessageConfig } from '../constants/toastMessages';
import { createLogger } from '../utils/logger';

const log = createLogger('Toast');

// 全局静默开关（批量操作时抑制所有 Toast）
let globalSuppressed = false;

export function suppressToasts(suppress: boolean): void {
  globalSuppressed = suppress;
}

// Toast去重机制
const recentToasts = new Map<string, number>();
const DUPLICATE_WINDOW = 2000; // 2秒防抖窗口

// 默认显示时长映射
const DEFAULT_LIFE: Record<string, number> = { error: 5000, warn: 4000 };
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
 * Toast 通知 Composable
 * 封装 PrimeVue Toast 服务，提供简化的 API
 */
export function useToast() {
  const toast = usePrimeToast();

  type Severity = 'success' | 'info' | 'warn' | 'error';

  function addToast(severity: Severity, summary: string, detail?: string, life?: number): void {
    if (globalSuppressed) return;
    if (isDuplicate(severity, summary, detail)) return;
    toast.add({ severity, summary, detail, life: life || DEFAULT_LIFE[severity] || 3000 });
  }

  const success = (summary: string, detail?: string, life?: number) => addToast('success', summary, detail, life);
  const error = (summary: string, detail?: string, life?: number) => addToast('error', summary, detail, life);
  const warn = (summary: string, detail?: string, life?: number) => addToast('warn', summary, detail, life);
  const info = (summary: string, detail?: string, life?: number) => addToast('info', summary, detail, life);
  const show = (severity: Severity, summary: string, detail?: string, life?: number) => addToast(severity, summary, detail, life);
  const clear = () => toast.removeAllGroups();

  const showConfig = (severity: Severity, config: ToastMessageConfig) => {
    addToast(severity, config.summary, config.detail, config.life);
  };

  /**
   * 直接转发底层 PrimeVue Toast.add（不走去重 / suppress 检查）
   * 仅供需要自定义模板渲染（带 group）的高级场景使用，例如 useUndoToast。
   */
  const addRaw = (options: Parameters<typeof toast.add>[0]) => {
    if (globalSuppressed) return;
    toast.add(options);
  };
  const removeGroup = (group: string) => toast.removeGroup(group);

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
    addRaw,
    removeGroup,
  };
}
