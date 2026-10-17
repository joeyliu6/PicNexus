// 图库的筛选（交接说明 8.2 + GalleryScreen.dc.html）：图床 / ★ 收藏 / 状态 / 时间，加上文件名搜索。
// 只做纯计算：按钮上的字、可单独移除的小标签、右上角计数、交给数据库的筛选条件。

import type { DayStatsFilter, GalleryStatusFilter } from '@/services/database/types';
import { formatCount } from '@/utils/formatters';

export type GalleryTimePreset = 'all' | 'week' | 'month' | 'year';

export interface GalleryFilters {
  /** 存有一份的图床；null = 不限 */
  host: string | null;
  favoritesOnly: boolean;
  status: readonly GalleryStatusFilter[];
  time: GalleryTimePreset;
  search: string;
}

export const EMPTY_FILTERS: GalleryFilters = { host: null, favoritesOnly: false, status: [], time: 'all', search: '' };

export const STATUS_LABELS: Record<GalleryStatusFilter, string> = {
  dead: '失效',
  limited: '可能受限',
  single: '仅 1 份',
  unchecked: '尚未检测',
};

export const TIME_LABELS: Record<GalleryTimePreset, string> = {
  all: '不限',
  week: '最近 7 天',
  month: '最近 30 天',
  year: '今年',
};

export interface FilterChip {
  label: string;
  remove: (filters: GalleryFilters) => GalleryFilters;
}

export interface FilterButton {
  key: 'host' | 'favorites' | 'status' | 'time';
  label: string;
  active: boolean;
}

type HostName = (hostId: string) => string;

export function hasActiveFilters(filters: GalleryFilters): boolean {
  return !!filters.host || filters.favoritesOnly || filters.status.length > 0 || filters.time !== 'all' || !!filters.search.trim();
}

/** 生效的条件逐个成为小标签（顺序同设计稿：搜索词、图床、收藏、状态、时间） */
export function filterChips(filters: GalleryFilters, hostName: HostName): FilterChip[] {
  const chips: FilterChip[] = [];
  const search = filters.search.trim();
  if (search) chips.push({ label: `「${search}」`, remove: (f) => ({ ...f, search: '' }) });
  if (filters.host) chips.push({ label: `图床：${hostName(filters.host)}`, remove: (f) => ({ ...f, host: null }) });
  if (filters.favoritesOnly) chips.push({ label: '收藏', remove: (f) => ({ ...f, favoritesOnly: false }) });
  if (filters.status.length) {
    chips.push({ label: `状态：${filters.status.map((s) => STATUS_LABELS[s]).join('、')}`, remove: (f) => ({ ...f, status: [] }) });
  }
  if (filters.time !== 'all') chips.push({ label: `时间：${TIME_LABELS[filters.time]}`, remove: (f) => ({ ...f, time: 'all' }) });
  return chips;
}

/** 工具栏的四个筛选按钮：生效时写出取值（多选的状态写「2 项」） */
export function filterButtons(filters: GalleryFilters, hostName: HostName): FilterButton[] {
  const status = filters.status.length === 1 ? STATUS_LABELS[filters.status[0]] : `${filters.status.length} 项`;
  return [
    { key: 'host', label: filters.host ? `图床 · ${hostName(filters.host)}` : '图床', active: !!filters.host },
    { key: 'favorites', label: '★ 收藏', active: filters.favoritesOnly },
    { key: 'status', label: filters.status.length ? `状态 · ${status}` : '状态', active: filters.status.length > 0 },
    { key: 'time', label: filters.time !== 'all' ? `时间 · ${TIME_LABELS[filters.time]}` : '时间', active: filters.time !== 'all' },
  ];
}

export function countText(filters: GalleryFilters, count: number, loading: boolean): string {
  if (loading) return '正在读取…';
  const n = formatCount(count);
  return hasActiveFilters(filters) ? `找到 ${n} 张` : `共 ${n} 张`;
}

const DAY = 86_400_000;

function sinceOf(time: GalleryTimePreset, now: number): number | undefined {
  if (time === 'week') return now - 7 * DAY;
  if (time === 'month') return now - 30 * DAY;
  if (time === 'year') return new Date(new Date(now).getFullYear(), 0, 1).getTime();
  return undefined;
}

export function toQueryFilter(filters: GalleryFilters, now: number = Date.now()): DayStatsFilter {
  return {
    hostFilter: filters.host ?? undefined,
    favoritesOnly: filters.favoritesOnly,
    statusFilter: filters.status,
    since: sinceOf(filters.time, now),
    searchTerm: filters.search.trim(),
  };
}
