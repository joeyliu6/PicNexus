/**
 * 批量迁移面板 — 共享工具函数
 */
import { PUBLIC_SERVICES } from '../../../../config/types';
import type { ServiceType } from '../../../../config/types';

export function formatTime(ms: number | null): string {
  if (!ms || ms <= 0) return '--';
  // 精确到秒的表达更直观，避免早期出现"< 1 分钟"的无信息量提示
  if (ms < 60_000) {
    const s = Math.max(1, Math.round(ms / 1000));
    return `${s} 秒`;
  }
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  if (minutes < 60) {
    const sec = totalSec % 60;
    return sec > 0 ? `${minutes} 分 ${sec} 秒` : `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  return `~${hours}h ${minutes % 60}m`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '--';
  const mb = bytesPerSec / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bytesPerSec / 1024;
  return `${kb.toFixed(0)} KB/s`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function isPublicService(serviceId: string): boolean {
  return PUBLIC_SERVICES.includes(serviceId as ServiceType);
}

/** 确认页基于数量的粗略时间估算（每张约 2 秒） */
const SECONDS_PER_IMAGE = 2;

export function estimateTime(count: number): string {
  if (count <= 0) return '--';
  const totalSec = count * SECONDS_PER_IMAGE;
  if (totalSec < 60) return '< 1 分钟';
  const minutes = Math.round(totalSec / 60);
  if (minutes < 60) return `~${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return `~${hours}h ${minutes % 60}m`;
}

const errorTypeMap: Record<string, { label: string; badgeClass: string }> = {
  download: { label: '下载失败', badgeClass: 'fail-badge--dl' },
  upload:   { label: '上传失败', badgeClass: 'fail-badge--ul' },
};

export function getErrorInfo(errorType?: string) {
  return errorTypeMap[errorType ?? ''] ?? errorTypeMap.upload;
}

export const filterThresholds = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 999, label: '全部' },
];

/**
 * 上传时间范围预设：value 是"距今多少毫秒"，null 表示不限
 * Popover 组件使用时将 value 转为绝对时间戳：Date.now() - value
 */
const DAY_MS = 86400_000;
export const timestampRangePresets: Array<{ value: number | null; label: string }> = [
  { value: null, label: '全部时间' },
  { value: 7 * DAY_MS, label: '最近 7 天' },
  { value: 30 * DAY_MS, label: '最近 30 天' },
  { value: 90 * DAY_MS, label: '最近 3 个月' },
  { value: 365 * DAY_MS, label: '最近 1 年' },
];

/** 文件流最大显示条数 */
export const MAX_VISIBLE_FILES = 50;

export const healthLabels: Record<string, string> = { verified: '可用', error: '异常', pending: '待验证' };
