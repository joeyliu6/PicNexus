/**
 * 补充备份面板 — 共享工具函数
 */
import { PUBLIC_SERVICES } from '@/config/types';
import type { ServiceType } from '@/config/types';

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

const errorTypeMap: Record<string, { label: string; badgeClass: string }> = {
  download: { label: '下载失败', badgeClass: 'fail-badge--dl' },
  upload:   { label: '上传失败', badgeClass: 'fail-badge--ul' },
};

export function getErrorInfo(errorType?: string) {
  return errorTypeMap[errorType ?? ''] ?? errorTypeMap.upload;
}

export const healthLabels: Record<string, string> = { verified: '可用', error: '异常', pending: '待验证' };
