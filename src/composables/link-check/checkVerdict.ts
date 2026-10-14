// 链接检测顶部的结论卡：先一句话说清现在怎么样，再给一个主按钮
//
// 纯函数：输入汇总数字与运行状态，输出卡片上的全部文字与按钮。用户一打开页面看到的就是它，
// 文案、按钮选哪个都在这里定，组件只负责摆出来。

import { formatRelativeTime } from '@/utils/formatters';
import type { ImageSummary } from './imageHealth';

export type VerdictTone = 'neutral' | 'ok' | 'warning' | 'error' | 'running' | 'paused';

export type VerdictAction =
  | 'check-all'
  | 'check-unchecked'
  | 'promote-all'
  | 'pause'
  | 'resume'
  | 'cancel';

export interface VerdictButton {
  action: VerdictAction;
  label: string;
}

/** 卡片下方的一行提示：在合适的时候把用户引到另外两个页面 */
export interface VerdictHint {
  kind: 'doc-repair' | 'add-backup';
  text: string;
  action: string;
}

export interface CheckVerdict {
  tone: VerdictTone;
  /** 没有结果可看时（没图片 / 没检查过）用大号居中的样子，页面上只剩这一件事 */
  hero: boolean;
  title: string;
  subtitle: string;
  primary: VerdictButton | null;
  secondary: VerdictButton | null;
  hint: VerdictHint | null;
}

export interface VerdictInput {
  summary: ImageSummary;
  running: {
    done: number;
    total: number;
    paused: boolean;
    /** 预计还要多少秒（见 useProgressPace）；还估不出来时为 null */
    etaSeconds?: number | null;
    /** 一阵子没有新结果：卡在慢图床 */
    stalled?: boolean;
  } | null;
  /** 第二批记录还在后台读：此时数字不全，不能抢先下「全部正常」「从没检查过」的结论 */
  loadingRest: boolean;
}

function etaText(seconds: number): string {
  if (seconds < 60) return '预计不到 1 分钟';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `预计还要 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `预计还要 ${hours} 小时 ${rest} 分钟` : `预计还要 ${hours} 小时`;
}

function checkedAgo(timestamp: number): string {
  const relative = formatRelativeTime(timestamp);
  return /\d$/.test(relative) ? `${relative} 检查` : `${relative}检查`;
}

function recheckButtons(uncheckedLinks: number): { first: VerdictButton; all: VerdictButton } {
  return uncheckedLinks > 0
    ? { first: { action: 'check-unchecked', label: `检查剩下的 ${uncheckedLinks} 个` }, all: { action: 'check-all', label: '全部重新检查' } }
    : { first: { action: 'check-all', label: '重新检查' }, all: { action: 'check-all', label: '重新检查' } };
}

export function buildCheckVerdict({ summary, running, loadingRest }: VerdictInput): CheckVerdict {
  const { images, links, uncheckedLinks, kinds, lastCheckedAt } = summary;
  const unreachable = kinds.fixable + kinds.broken;

  if (running) {
    // 检查途中计数里混着上一轮的旧结果，所以说「目前」而不是「本次发现」
    const parts = [unreachable > 0 ? `目前有 ${unreachable} 张图片打不开` : '目前没发现打不开的图片'];
    if (!running.paused) {
      // 卡住时不报时间：那个数是按之前的速度算的，此刻并不可信
      if (running.stalled) parts.push('有些图床响应慢，正在等它们');
      else if (running.etaSeconds != null) parts.push(etaText(running.etaSeconds));
    }
    return {
      tone: running.paused ? 'paused' : 'running',
      hero: false,
      title: running.paused
        ? `已暂停 · ${running.done} / ${running.total}`
        : `正在检查链接 ${running.done} / ${running.total}`,
      subtitle: parts.join(' · '),
      primary: running.paused ? { action: 'resume', label: '继续' } : { action: 'pause', label: '暂停' },
      secondary: { action: 'cancel', label: '停止' },
      hint: null,
    };
  }

  if (images === 0 && !loadingRest) {
    return {
      tone: 'neutral', hero: true, title: '还没有图片可以检查', subtitle: '上传过的图片会出现在这里',
      primary: null, secondary: null, hint: null,
    };
  }

  if (loadingRest && unreachable === 0) {
    return {
      tone: 'neutral', hero: false, title: '正在读取检查记录…', subtitle: `已读取 ${images} 张图片`,
      primary: null, secondary: null, hint: null,
    };
  }

  if (uncheckedLinks === links) {
    const scope = links > images ? `${images} 张图片（${links} 个链接）` : `${images} 张图片`;
    return {
      tone: 'neutral',
      hero: true,
      title: '检查图片还能不能打开',
      subtitle: `逐个访问你上传过的 ${scope}，只读取，不改动任何东西`,
      primary: { action: 'check-all', label: '开始检查' },
      secondary: null,
      hint: null,
    };
  }

  const tail = loadingRest ? '其余记录读取中' : (lastCheckedAt !== null ? checkedAgo(lastCheckedAt) : null);
  const recheck = recheckButtons(uncheckedLinks);

  if (unreachable > 0) {
    // 只说和决定有关的：几张能修、几张没救、什么时候查的。受限的在列表里有自己一段，
    // 没查完的由次按钮「检查剩下的 N 个」交代，再写进来只会让这一行长到没人读
    const parts: string[] = [];
    if (kinds.fixable > 0) parts.push(`${kinds.fixable} 张可以改用备份`);
    if (kinds.broken > 0) parts.push(`${kinds.broken} 张没有能用的备份`);
    if (tail) parts.push(tail);

    const canPromote = kinds.fixable > 0;
    return {
      tone: kinds.broken > 0 ? 'error' : 'warning',
      hero: false,
      title: `${unreachable} 张图片打不开`,
      subtitle: parts.join(' · '),
      primary: canPromote ? { action: 'promote-all', label: `把 ${kinds.fixable} 张改用备份` } : recheck.first,
      secondary: canPromote ? recheck.first : (uncheckedLinks > 0 ? recheck.all : null),
      hint: null,
    };
  }

  const notes: string[] = [];
  if (kinds.limited > 0) notes.push(`${kinds.limited} 张可能受限`);
  if (kinds['backup-broken'] > 0) notes.push(`${kinds['backup-broken']} 张的备份失效了`);
  const allChecked = uncheckedLinks === 0;

  let title = '全部正常';
  if (!allChecked) title = '已检查的图片都能打开';
  else if (notes.length > 0) title = '没有打不开的图片';

  const parts = allChecked && notes.length === 0 ? [`${images} 张图片都能打开`] : notes;
  if (!allChecked) parts.push(`还有 ${uncheckedLinks} 个链接没检查`);
  if (tail) parts.push(tail);

  // 只用一个图床的人（所有图都只有一份）不反复劝补备份；已经在用备份、但有图漏了，才值得提
  let hint: VerdictHint | null = null;
  if (kinds['backup-broken'] > 0) {
    hint = { kind: 'doc-repair', text: '文档里如果还用着失效的旧链接，可以一键换掉', action: '去文档修复' };
  } else if (summary.singleCopy > 0 && summary.singleCopy < images) {
    hint = { kind: 'add-backup', text: `${summary.singleCopy} 张图片只存在一个图床，那个图床出问题就找不回了`, action: '去补充备份' };
  }

  return {
    tone: 'ok',
    hero: false,
    title,
    subtitle: parts.join(' · '),
    primary: allChecked ? null : recheck.first,
    secondary: allChecked ? recheck.first : recheck.all,
    hint,
  };
}
