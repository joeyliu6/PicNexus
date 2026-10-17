// 链接健康的「健康模型」（交接说明 8.3 / 13.4）：检测行 → 每张图的状态、失效原因、改用哪一份、
// 两组清单、状态栏那句说明。纯函数，无 Vue 依赖；页面与通知里的数字都从这里来。

import type { CheckLinkResult, LinkCheckRow } from '@/types/linkCheck';
import { joinCjk as cat } from '@/utils/cjkSpacing';
import { formatCount } from '@/utils/formatters';

/** 一份链接的状态：正常 / 三种失效 / 可能受限 / 尚未检测 */
export type CopyStatus = 'ok' | 'gone' | 'denied' | 'timeout' | 'limited' | 'unchecked';
/** 失效原因（筛选与行上那句话） */
export type DeadReason = 'gone' | 'denied' | 'timeout';
/** 一张图：尚未检测 / 正常 / 可能受限 / 失效但能改用备份 / 失效且无可用备份 */
export type ImageState = 'unchecked' | 'ok' | 'limited' | 'fixable' | 'unfixable';

export interface HealthCopy {
  host: string;
  status: CopyStatus;
  /** 最近一次检测的响应时间（毫秒） */
  latencyMs?: number;
  row: LinkCheckRow;
}

export interface HealthImage {
  id: string;
  name: string;
  uploadedAt: number;
  /** 「复制时使用」的图床 */
  copyHost: string;
  /** 复制时使用的那份排第一，其余按记录顺序 */
  copies: HealthCopy[];
  state: ImageState;
  reason?: DeadReason;
  /** 改用哪一份：可访问的副本里最近一次响应最快的 */
  fixTo?: string;
  /** 没被查出失效的副本只剩 1 份（尚未检测的当作可用）：补充备份的范围 */
  singleCopy: boolean;
  /** 每一份都是「图片已不存在」：「清理找不回的图片」只认这种 */
  lostForGood: boolean;
}

/**
 * 检测进行中：复制时使用的那份若属于这一轮、且检测时间早于这一轮开始，先当作待查（L02「边查边出现」）；
 * 备份照旧用上一次的结果，查出失效的图才知道能不能改用
 */
export interface PendingRun {
  keys: ReadonlySet<string>;
  startedAt: number;
}

export const REASON_TEXT: Record<DeadReason | 'limited', string> = {
  gone: '图片已不存在',
  denied: '拒绝访问',
  timeout: '连接超时',
  limited: '可能受限',
};

const DEAD: ReadonlySet<CopyStatus> = new Set(['gone', 'denied', 'timeout']);

export function isDead(status: CopyStatus): status is DeadReason {
  return DEAD.has(status);
}

/**
 * 检测结果 → 一份链接的状态。防盗链 / 跳转：浏览器里多半能看，算「可能受限」不算失效；
 * 404 / 410 才是「图片已不存在」（超时之类带着旧状态码的不算）；连接类与图床 5xx 归「连接超时」，其余归「拒绝访问」。
 */
export function copyStatus(result: CheckLinkResult | undefined): CopyStatus {
  if (!result) return 'unchecked';
  if (result.is_valid) return 'ok';
  if (result.error_type === 'redirect' || result.browser_might_work) return 'limited';
  if (result.error_type === 'http_4xx' && (result.status_code === 404 || result.status_code === 410)) return 'gone';
  if (result.error_type === 'timeout' || result.error_type === 'network' || result.error_type === 'http_5xx') return 'timeout';
  return 'denied';
}

function rowKey(row: LinkCheckRow): string {
  return `${row.historyId}::${row.serviceId}`;
}

/** 行的当前结果（检测进行中，本轮还没查到的当作待查） */
function resultOf(row: LinkCheckRow, pending?: PendingRun): CheckLinkResult | undefined {
  if (pending && pending.keys.has(rowKey(row)) && (row.checkedAt ?? 0) < pending.startedAt) return undefined;
  return row.checkResult;
}

function toImage(rows: LinkCheckRow[], pending?: PendingRun): HealthImage {
  const inUse = rows.find((r) => r.isPrimary) ?? rows[0];
  const ordered = [inUse, ...rows.filter((r) => r !== inUse)];
  const copies: HealthCopy[] = ordered.map((row, i) => {
    const result = i === 0 ? resultOf(row, pending) : row.checkResult;
    return { host: row.serviceId, status: copyStatus(result), latencyMs: result?.response_time, row };
  });
  const [current, ...backups] = copies;
  let state: ImageState;
  let reason: DeadReason | undefined;
  let fixTo: string | undefined;
  if (isDead(current.status)) {
    reason = current.status;
    const usable = backups
      .map((copy, order) => ({ copy, order }))
      .filter(({ copy }) => copy.status === 'ok')
      .sort((a, b) => (a.copy.latencyMs ?? Infinity) - (b.copy.latencyMs ?? Infinity) || a.order - b.order);
    fixTo = usable[0]?.copy.host;
    state = fixTo ? 'fixable' : 'unfixable';
  } else {
    state = current.status;
  }
  return {
    id: inUse.historyId,
    name: inUse.fileName,
    uploadedAt: inUse.uploadedAt,
    copyHost: inUse.serviceId,
    copies,
    state,
    reason,
    fixTo,
    singleCopy: copies.filter((c) => !isDead(c.status)).length === 1,
    lostForGood: copies.every((c) => c.status === 'gone'),
  };
}

/** 检测行 → 每张图一条，新到旧 */
export function buildHealthImages(rows: readonly LinkCheckRow[], pending?: PendingRun): HealthImage[] {
  const byId = new Map<string, LinkCheckRow[]>();
  for (const row of rows) {
    const list = byId.get(row.historyId);
    if (list) list.push(row);
    else byId.set(row.historyId, [row]);
  }
  return [...byId.values()].map((list) => toImage(list, pending)).sort((a, b) => b.uploadedAt - a.uploadedAt);
}

export interface HealthSummary {
  total: number;
  dead: number;
  fixable: number;
  unfixable: number;
  limited: number;
  singleCopy: number;
  lostForGood: number;
  /** 有没有任何一份检测过：没有就是「尚未检测」 */
  everChecked: boolean;
  /**
   * 上一次全量检测：全部检测结果里最旧的那条的时间（每轮全量检测会把每一份都查一遍）。
   * 不取最新的一条：单行「重试」、「仅重新检测失效图片」只查几份，不该让「上次检测」与自动检测的计时归零
   */
  lastFullCheckAt: number | null;
  links: number;
}

export function summarize(images: readonly HealthImage[]): HealthSummary {
  const s: HealthSummary = { total: images.length, dead: 0, fixable: 0, unfixable: 0, limited: 0, singleCopy: 0, lostForGood: 0, everChecked: false, lastFullCheckAt: null, links: 0 };
  for (const image of images) {
    if (image.state === 'fixable') s.fixable++;
    if (image.state === 'unfixable') s.unfixable++;
    if (image.state === 'limited') s.limited++;
    if (image.singleCopy) s.singleCopy++;
    if (image.lostForGood) s.lostForGood++;
    for (const copy of image.copies) {
      s.links++;
      const at = copy.row.checkedAt;
      if (copy.row.checkResult) s.everChecked = true;
      if (copy.row.checkResult && at !== undefined && (s.lastFullCheckAt === null || at < s.lastFullCheckAt)) s.lastFullCheckAt = at;
    }
  }
  s.dead = s.fixable + s.unfixable;
  return s;
}

/** 失效的图（复制时使用的那份失效） */
export function deadImages(images: readonly HealthImage[]): HealthImage[] {
  return images.filter((image) => image.state === 'fixable' || image.state === 'unfixable');
}

// ---- 清单筛选 ----

export interface DeadFilters {
  reason: DeadReason | 'limited' | null;
  host: string | null;
  year: number | null;
  /** 点日历上的一天：getDayKey 的格式 */
  day: string | null;
}

export const NO_FILTERS: DeadFilters = { reason: null, host: null, year: null, day: null };

export interface DeadGroup {
  key: 'fixable' | 'unfixable' | 'limited';
  title: string;
  images: HealthImage[];
}

const GROUP_TITLE: Record<DeadGroup['key'], string> = { fixable: '可改用备份', unfixable: '无可用备份', limited: '可能受限' };

/** 清单分组：按「可能受限」筛选时只有一组；其余是「可改用备份 / 无可用备份」两组，空组不出现 */
export function deadGroups(images: readonly HealthImage[], filters: DeadFilters, dayOf: (ts: number) => string): DeadGroup[] {
  const match = (image: HealthImage) =>
    (filters.host === null || image.copyHost === filters.host)
    && (filters.year === null || new Date(image.uploadedAt).getFullYear() === filters.year)
    && (filters.day === null || dayOf(image.uploadedAt) === filters.day);
  const keys: DeadGroup['key'][] = filters.reason === 'limited' ? ['limited'] : ['fixable', 'unfixable'];
  return keys
    .map((key) => ({
      key,
      title: GROUP_TITLE[key],
      images: images.filter((image) => image.state === key && match(image)
        && (filters.reason === null || filters.reason === 'limited' || image.reason === filters.reason)),
    }))
    .filter((group) => group.images.length > 0);
}

// ---- 行上的文字 ----

/** 「微博：图片已不存在」 */
export function reasonLine(image: HealthImage, hostName: (id: string) => string): string {
  const word = image.state === 'limited' ? REASON_TEXT.limited : image.reason ? REASON_TEXT[image.reason] : '';
  return `${hostName(image.copyHost)}：${word}`;
}

/** 备份情况（灰字）：「京东有备份」「无备份」「备份也已失效」… */
export function backupLine(image: HealthImage, hostName: (id: string) => string): string {
  const backups = image.copies.slice(1);
  if (backups.length === 0) return '无备份';
  const ok = image.fixTo ?? backups.find((c) => c.status === 'ok')?.host;
  if (ok) return cat(hostName(ok), '有备份');
  if (backups.some((c) => c.status === 'unchecked')) return '备份尚未检测';
  if (backups.some((c) => c.status === 'limited')) return '备份可能受限';
  return '备份也已失效';
}

// ---- 状态栏那句说明 ----

/**
 * 「集中在 2020–2023 年上传到微博的图片」：年份跨度不超过 6 年才写年份；某个图床占失效的八成以上才写图床；
 * 两样都不成立返回 null
 */
export function concentration(dead: readonly HealthImage[], hostName: (id: string) => string): string | null {
  if (dead.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const image of dead) {
    const year = new Date(image.uploadedAt).getFullYear();
    if (year < min) min = year;
    if (year > max) max = year;
  }
  const yearPart = max - min + 1 > 6 ? '' : min === max ? `${min} 年` : `${min}–${max} 年`;
  const counts = new Map<string, number>();
  for (const image of dead) counts.set(image.copyHost, (counts.get(image.copyHost) ?? 0) + 1);
  const [topHost, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const hostPart = topCount / dead.length >= 0.8 ? hostName(topHost) : '';
  if (!yearPart && !hostPart) return null;
  const lead = yearPart ? `集中在 ${yearPart}` : '集中在';
  return hostPart ? cat(lead, '上传到', hostPart, '的图片') : `${lead}上传的图片`;
}

/** 有失效时状态栏的说明（L04 / L11） */
export function problemSubline(summary: HealthSummary, dead: readonly HealthImage[], fixedThisSession: number, hostName: (id: string) => string): string {
  if (summary.fixable === 0) {
    return ['均无可用备份', fixedThisSession > 0 ? `${formatCount(fixedThisSession)} 张已修复` : '']
      .filter(Boolean).join(' · ');
  }
  return [
    concentration(dead, hostName) ?? '',
    `${formatCount(summary.fixable)} 张可用备份修复`,
    summary.limited > 0 ? `另有 ${formatCount(summary.limited)} 张可能受限` : '',
  ].filter(Boolean).join(' · ');
}

/**
 * 补充备份到 hostId 的范围：「仅有 1 份」、且这个图床上还没有它的任何一份。
 * 已有一份失效的也不算：记录里已有这个图床，迁移管线会按「目标上已有」跳过，补不上
 */
export function backupScope(images: readonly HealthImage[], hostId: string): HealthImage[] {
  return images.filter((image) => image.singleCopy && !image.copies.some((c) => c.host === hostId));
}

/** 缩略图先试能打开的那份：正常 > 受限 > 尚未检测 > 失效（「图片已不存在」最后） */
const THUMB_RANK: Record<CopyStatus, number> = { ok: 0, limited: 1, unchecked: 2, timeout: 3, denied: 3, gone: 4 };

export function thumbCopies(image: HealthImage): Array<{ serviceId: string; url: string; fileKey?: string }> {
  return [...image.copies]
    .sort((a, b) => THUMB_RANK[a.status] - THUMB_RANK[b.status])
    .map((c) => ({ serviceId: c.host, url: c.row.rawUrl, fileKey: c.row.fileKey }));
}

/** 时长说成「15 分钟」「不到 1 分钟」「1 小时 30 分钟」 */
export function minutesText(seconds: number): string {
  if (seconds < 60) return '不到 1 分钟';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} 小时 ${rest} 分钟` : `${Math.floor(minutes / 60)} 小时`;
}

/** 全量检测大约要多久：每条链接约 0.035 秒（并发 10、单图床 3） */
export const CHECK_SECONDS_PER_LINK = 0.035;

/** 「2023年5月22日」 */
export function fullDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
