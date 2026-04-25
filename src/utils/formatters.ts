/**
 * 通用格式化工具函数
 */

import type { HistoryItem } from '../config/types';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** 格式化时间戳为本地日期时间字符串 */
export function formatTime(timestamp: number): string {
  return dateFormatter.format(new Date(timestamp));
}

/** 从历史记录项提取上传成功的图床 ID 列表 */
export function getSuccessfulServices(item: HistoryItem): string[] {
  return item.results.filter(r => r.status === 'success').map(r => r.serviceId);
}

/** 截断过长文件名（保留头尾 + 扩展名） */
export function truncateMiddle(name: string, maxLen = 42): string {
  if (name.length <= maxLen) return name;
  const extIdx = name.lastIndexOf('.');
  const ext = extIdx > 0 ? name.slice(extIdx) : '';
  const base = extIdx > 0 ? name.slice(0, extIdx) : name;
  const keep = maxLen - ext.length - 3;
  if (keep <= 0) return name.slice(0, maxLen - 3) + '...';
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return base.slice(0, head) + '...' + base.slice(-tail) + ext;
}

/**
 * 格式化相对时间（中文）
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/**
 * 格式化文件大小
 * @param bytes 字节数
 * @param options.emptyText 0 字节时显示的文本，默认 '0 B'
 */
export function formatFileSize(bytes: number, options?: { emptyText?: string }): string {
  if (bytes === 0) return options?.emptyText ?? '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 时间戳 → dayKey（如 "2026-3-25"）
 * 注意：month 是 0-11，与 Date.getMonth() 一致；用作 Map key 而非展示文本。
 * 必须保持此格式以与 DayStats / TimelineData 内部约定兼容。
 */
export function getDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 完整时间戳 "YYYY-MM-DD HH:mm:ss"，用于日志/同步标记 */
export function formatTimestampFull(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** 紧凑时间戳 "YYYYMMDD_HHmmss"，可用于安全文件名 */
export function formatTimestampCompact(date: Date = new Date()): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}_${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

