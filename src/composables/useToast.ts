// src/composables/useToast.ts
// Toast 通知 Composable - 增强版

import { useToast as usePrimeToast } from 'primevue/usetoast';
import type { ToastMessageConfig } from '../constants/toastMessages';

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
    console.log(`[Toast防重复] 阻止重复提示: ${summary}`);
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

  /**
   * 显示成功通知
   * @param summary 标题
   * @param detail 详细信息（可选）
   * @param life 显示时长（毫秒），默认 3000
   */
  const success = (summary: string, detail?: string, life = 3000) => {
    if (isDuplicate('success', summary, detail)) return;
    toast.add({
      severity: 'success',
      summary,
      detail,
      life
    });
  };

  /**
   * 显示错误通知
   * @param summary 标题
   * @param detail 详细信息（可选）
   * @param life 显示时长（毫秒），默认 5000
   */
  const error = (summary: string, detail?: string, life = 5000) => {
    if (isDuplicate('error', summary, detail)) return;
    toast.add({
      severity: 'error',
      summary,
      detail,
      life
    });
  };

  /**
   * 显示警告通知
   * @param summary 标题
   * @param detail 详细信息（可选）
   * @param life 显示时长（毫秒），默认 4000
   */
  const warn = (summary: string, detail?: string, life = 4000) => {
    if (isDuplicate('warn', summary, detail)) return;
    toast.add({
      severity: 'warn',
      summary,
      detail,
      life
    });
  };

  /**
   * 显示信息通知
   * @param summary 标题
   * @param detail 详细信息（可选）
   * @param life 显示时长（毫秒），默认 3000
   */
  const info = (summary: string, detail?: string, life = 3000) => {
    if (isDuplicate('info', summary, detail)) return;
    toast.add({
      severity: 'info',
      summary,
      detail,
      life
    });
  };

  /**
   * 显示自定义通知
   * @param severity 严重程度
   * @param summary 标题
   * @param detail 详细信息（可选）
   * @param life 显示时长（毫秒），默认 3000
   */
  const show = (
    severity: 'success' | 'info' | 'warn' | 'error',
    summary: string,
    detail?: string,
    life = 3000
  ) => {
    toast.add({
      severity,
      summary,
      detail,
      life
    });
  };

  /**
   * 清除所有通知
   */
  const clear = () => {
    toast.removeAllGroups();
  };

  /**
   * 使用预定义消息配置显示通知
   * @param severity 严重程度
   * @param config 消息配置对象
   */
  const showConfig = (
    severity: 'success' | 'info' | 'warn' | 'error',
    config: ToastMessageConfig
  ) => {
    const { summary, detail, life } = config;
    const defaultLife = DEFAULT_LIFE[severity] ?? 3000;

    if (isDuplicate(severity, summary, detail)) return;

    toast.add({
      severity,
      summary,
      detail,
      life: life || defaultLife
    });
  };

  /**
   * 静默日志（仅记录日志，不显示通知）
   * @param level 日志级别
   * @param summary 标题
   * @param detail 详细信息
   */
  const silent = (level: 'log' | 'error', summary: string, detail?: string) => {
    const icon = level === 'log' ? '✓' : '✗';
    console[level](`[Toast][静默] ${icon} ${summary}${detail ? `: ${detail}` : ''}`);
  };

  return {
    success,
    error,
    warn,
    info,
    show,
    clear,
    showConfig,
    silent
  };
}
