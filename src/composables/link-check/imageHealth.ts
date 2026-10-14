// 链接检测按图片聚合
//
// 一张图在几个图床各有一份链接（一份 = 一个 LinkCheckRow）。用户要的答案是「这张图还能不能看、
// 坏了能不能救」，所以列表按图片一行，这一行的状态由它的几份链接在这里推出来。
// 纯函数，无 Vue 依赖。

import type { CheckLinkResult, LinkCheckRow } from '@/types/linkCheck';
import { statusWord } from './useLinkStatusDisplay';

/** 单条链接的判定：只分用户能据此行动的几类 */
export type LinkVerdict =
  | 'unchecked'
  | 'ok'
  /** 防盗链 / 跳转：检测器拿不到图，但浏览器里多半能看 */
  | 'limited'
  /** 图床明确说图不在了（404 / 410） */
  | 'gone'
  /** 打不开，但原因可能是暂时的，或说不清图还在不在（超时、连不上、图床故障、限流、拒绝访问……） */
  | 'failing';

export function linkVerdict(result: CheckLinkResult | undefined): LinkVerdict {
  if (!result) return 'unchecked';
  if (result.is_valid) return 'ok';
  if (result.error_type === 'redirect' || result.browser_might_work) return 'limited';
  // 必须是图床真的回了 HTTP 4xx：超时 / 连不上之类结果若带着旧状态码，不能当成「不在了」——清理记录靠它把关
  if (result.error_type === 'http_4xx' && (result.status_code === 404 || result.status_code === 410)) return 'gone';
  return 'failing';
}

/** 一张图的整体状态 */
export type ImageKind =
  | 'unchecked'
  | 'ok'
  /** 主链接打不开，但有能用的备份：一键改用 */
  | 'fixable'
  /** 主链接打不开，也没有能用的备份 */
  | 'broken'
  /** 主链接受限（防盗链 / 跳转），浏览器里多半能看 */
  | 'limited'
  /** 主链接正常，但有备份坏了：不影响显示，只是少了一层保险 */
  | 'backup-broken';

export interface ImageEntry {
  historyId: string;
  fileName: string;
  /** 主链接排第一，其余按记录顺序 */
  rows: LinkCheckRow[];
}

type ResultOf = (row: LinkCheckRow) => CheckLinkResult | undefined;

/** 已落定的结果：列表归类、排序、计数都用它，单条重检的动画期间行不会跳走 */
const committedResult: ResultOf = (row) => row.checkResult;

/** 最新结果（含单条重检刚拿到、还在动画里的那份）：行上显示什么、能不能改用，看它 */
export const effectiveResult: ResultOf = (row) => row.recheckResult ?? row.checkResult;

export function groupRowsByImage(rows: readonly LinkCheckRow[]): ImageEntry[] {
  const byId = new Map<string, ImageEntry>();
  const entries: ImageEntry[] = [];
  for (const row of rows) {
    let entry = byId.get(row.historyId);
    if (!entry) {
      entry = { historyId: row.historyId, fileName: row.fileName, rows: [] };
      byId.set(row.historyId, entry);
      entries.push(entry);
    }
    if (row.isPrimary && !entry.rows[0]?.isPrimary) entry.rows.unshift(row);
    else entry.rows.push(row);
  }
  return entries;
}

function isFailed(verdict: LinkVerdict): boolean {
  return verdict === 'gone' || verdict === 'failing';
}

export function imageKind(entry: ImageEntry, resultOf: ResultOf = committedResult): ImageKind {
  const [primary, ...backups] = entry.rows;
  const verdict = linkVerdict(primary ? resultOf(primary) : undefined);
  if (verdict === 'unchecked') return 'unchecked';
  if (verdict === 'limited') return 'limited';
  if (verdict === 'ok') {
    return backups.some((b) => isFailed(linkVerdict(resultOf(b)))) ? 'backup-broken' : 'ok';
  }
  return backups.some((b) => linkVerdict(resultOf(b)) === 'ok') ? 'fixable' : 'broken';
}

/**
 * 主链接打不开时，可以顶上来的那份备份（按记录顺序第一份能用的）
 *
 * 防盗链 / 跳转不算打不开，不建议换：浏览器里多半能看，换了反而可能换到更慢的图床。
 */
export function promoteTarget(entry: ImageEntry, resultOf: ResultOf = effectiveResult): LinkCheckRow | undefined {
  const [primary, ...backups] = entry.rows;
  if (!primary || !isFailed(linkVerdict(resultOf(primary)))) return undefined;
  return backups.find((b) => linkVerdict(resultOf(b)) === 'ok');
}

/** 每一份都明确不在了（404 / 410）：只有这种才敢建议「清理记录」 */
export function isLostForGood(entry: ImageEntry, resultOf: ResultOf = committedResult): boolean {
  return entry.rows.length > 0 && entry.rows.every((r) => linkVerdict(resultOf(r)) === 'gone');
}

const CJK = /[一-鿿]/;
const LATIN = /[A-Za-z0-9]/;

/**
 * 拼句子：交界处一边是中文、一边是英文或数字，就补一个空格（「Cloudflare R2 连接超时」）
 *
 * 只看片段交界，不碰片段内部：图床名可能是用户自己起的（「家里NAS盘」），不能被改写。
 */
function cat(...parts: string[]): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    const prev = out[out.length - 1] ?? '';
    if ((CJK.test(prev) && LATIN.test(part[0])) || (LATIN.test(prev) && CJK.test(part[0]))) out += ' ';
    out += part;
  }
  return out;
}

/** 「微博上的图已不存在」「Cloudflare R2 连接超时」：只说这一份出了什么事 */
function problemPhrase(host: string, result: CheckLinkResult | undefined): string {
  if (!result) return cat(host, '上打不开');
  const verdict = linkVerdict(result);
  if (verdict === 'gone') return cat(host, '上的图已不存在');
  if (verdict === 'limited') return cat(host, result.error_type === 'redirect' ? '的链接会跳转' : '限制了外站引用');
  switch (result.error_type) {
    case 'timeout': return cat(host, '连接超时');
    case 'network': return cat(host, '连不上');
    case 'blocked': return cat(host, '的链接被安全策略拦下');
    case 'suspicious': return cat(host, '返回的不像是图片');
    case 'http_5xx': return cat(host, '图床出故障了');
  }
  if (result.status_code === 429) return cat(host, '限制了访问次数');
  if (result.status_code === 401) return cat(host, '要登录才能看');
  if (result.status_code === 403) return cat(host, '拒绝访问');
  return cat(host, '上打不开');
}

function hostList(names: string[]): string {
  if (names.length <= 3) return names.join('、');
  return cat(names[0], `等 ${names.length} 个图床`);
}

export interface ImageDescription {
  kind: ImageKind;
  /** 一句白话：这张图怎么了、还有没有救 */
  text: string;
  /** 悬停详情：逐份列出状态 */
  detail: string;
}

/** 行上显示的那句话（用最新结果） */
export function describeImage(entry: ImageEntry, nameOf: (serviceId: string) => string): ImageDescription {
  const kind = imageKind(entry, effectiveResult);
  const [primary, ...backups] = entry.rows;
  if (!primary) return { kind, text: '还没检查', detail: '' };
  const verdictOf = (r: LinkCheckRow) => linkVerdict(effectiveResult(r));
  const primaryPhrase = () => problemPhrase(nameOf(primary.serviceId), effectiveResult(primary));
  let text: string;

  switch (kind) {
    case 'unchecked':
      text = '还没检查';
      break;
    case 'ok':
      text = backups.length === 0
        ? cat('能正常打开 · 只在', nameOf(primary.serviceId), '上有一份')
        : `能正常打开 · ${hostList(entry.rows.map((r) => nameOf(r.serviceId)))}`;
      break;
    case 'backup-broken': {
      const failed = backups.filter((b) => isFailed(verdictOf(b)));
      text = failed.length === 1
        ? cat('能正常打开，', nameOf(failed[0].serviceId), '上的备份已失效')
        : `能正常打开，${failed.length} 个备份已失效`;
      break;
    }
    case 'limited':
      text = `${primaryPhrase()}，浏览器里多半能正常显示`;
      break;
    case 'fixable': {
      // imageKind 与 promoteTarget 同用最新结果，判成 fixable 就一定有备份可顶
      const target = promoteTarget(entry);
      text = target
        ? cat(primaryPhrase(), '，', nameOf(target.serviceId), '上的备份能用')
        : primaryPhrase();
      break;
    }
    case 'broken': {
      const phrase = primaryPhrase();
      let backupNote: string;
      if (backups.length === 0) backupNote = '没有备份';
      else if (backups.some((b) => verdictOf(b) === 'unchecked')) backupNote = '备份还没检查';
      else if (backups.some((b) => verdictOf(b) === 'limited')) backupNote = '备份受限，浏览器里也许能看';
      else backupNote = '备份也打不开';
      text = `${phrase}，${backupNote}`;
      break;
    }
  }

  const detail = entry.rows
    .map((r) => `${nameOf(r.serviceId)}${r === primary ? '（在用）' : ''}：${statusWord(effectiveResult(r))}`)
    .join('\n');

  return { kind, text, detail };
}

export interface ImageSummary {
  images: number;
  links: number;
  uncheckedLinks: number;
  kinds: Record<ImageKind, number>;
  /** 每一份都明确不在了的图片数（可以建议清理记录） */
  lostForGood: number;
  /** 只存在一个图床的图片数（图床出问题就找不回，可以建议补充备份） */
  singleCopy: number;
  /** 全部链接里最近一次检查的时间；从没检查过为 null */
  lastCheckedAt: number | null;
}

export function summarizeImages(entries: readonly ImageEntry[]): ImageSummary {
  const kinds: Record<ImageKind, number> = {
    unchecked: 0, ok: 0, fixable: 0, broken: 0, limited: 0, 'backup-broken': 0,
  };
  let links = 0;
  let uncheckedLinks = 0;
  let lostForGood = 0;
  let singleCopy = 0;
  let lastCheckedAt: number | null = null;

  for (const entry of entries) {
    kinds[imageKind(entry)]++;
    if (isLostForGood(entry)) lostForGood++;
    if (entry.rows.length === 1) singleCopy++;
    for (const r of entry.rows) {
      links++;
      if (!r.checkResult) uncheckedLinks++;
      if (r.checkedAt !== undefined && (lastCheckedAt === null || r.checkedAt > lastCheckedAt)) lastCheckedAt = r.checkedAt;
    }
  }

  return { images: entries.length, links, uncheckedLinks, kinds, lostForGood, singleCopy, lastCheckedAt };
}
